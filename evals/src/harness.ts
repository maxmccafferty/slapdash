/**
 * Runs the agent loop in plain Node: the keyhole handler is called in-process through a
 * `fetch` shim, so no browser and no server are needed. It uses the same config, budget and
 * usage file as `pnpm dev`, so eval spend counts towards the month's cap.
 *
 * Two things differ from the deployed keyhole, on purpose:
 * - Supabase sign-in is off (there is no browser to sign in from);
 * - the rate limits are raised, so a dozen multi-turn scenarios don't hit 30 requests/min.
 *   Set `EVAL_KEEP_RATE_LIMITS=1` to keep the configured ones.
 * Model, effort and budget are left alone, so evals measure what people get.
 */
import { fileURLToPath } from 'node:url';
import {
  AgentMemory,
  fetchKeyholeClient,
  runTurn,
  type AgentEvent,
  type BudgetStatus,
  type ChatPrefs,
  type KeyholeClient,
  type KeyholeStatus,
  type TurnResult,
  type UserInput,
} from '@slapdash/agent';
import { DESIGN_LOAD_TABLE, TIER1_CATALOG } from '@slapdash/catalog';
import { CommandBus, createProject, indexCatalog, type CatalogIndex, type Project, type SiteDefaults } from '@slapdash/core';
import { analyze } from '@slapdash/solver';
import { createKeyholeFromEnv, readConfig, type Env, type KeyholeHandler } from '@slapdash/keyhole';
import { applySeed, type SeedCommands } from './seeds.ts';

const REPO_USAGE_FILE = fileURLToPath(new URL('../../.data/usage.json', import.meta.url));
const KEYHOLE_URL = 'http://localhost/api/claude';

/** Every env name the keyhole reads to turn on Supabase sign-in. */
const SUPABASE_VARS = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'].flatMap((n) => [n, `VITE_${n}`, `NEXT_PUBLIC_${n}`]);

/** The environment the in-process keyhole runs with: no sign-in, roomy rate limits. */
export function evalEnv(env: Env): Env {
  const out: Record<string, string | undefined> = { SLAPDASH_USAGE_FILE: REPO_USAGE_FILE, ...env };
  for (const name of SUPABASE_VARS) delete out[name];
  if (!env.EVAL_KEEP_RATE_LIMITS) {
    out.SLAPDASH_RATE_PER_MINUTE = '600';
    out.SLAPDASH_RATE_PER_DAY = '10000';
  }
  return out;
}

export interface InProcessKeyhole {
  client: KeyholeClient;
  handler: KeyholeHandler;
  model: string;
  effort: string;
}

/** A keyhole client whose requests go straight to an in-process keyhole handler. */
export function inProcessKeyhole(env: Env): InProcessKeyhole {
  const e = evalEnv(env);
  const config = readConfig(e);
  const handler = createKeyholeFromEnv(e);
  const client = fetchKeyholeClient({ url: KEYHOLE_URL, fetch: (url, init) => handler(new Request(url, init)) });
  return { client, handler, model: config.model, effort: config.effort };
}

/** This month's budget, from `GET /api/claude`. */
export async function budgetStatus(handler: KeyholeHandler): Promise<BudgetStatus> {
  const res = await handler(new Request(KEYHOLE_URL, { method: 'GET' }));
  if (!res.ok) throw new Error(`The keyhole status check failed (${res.status}).`);
  return ((await res.json()) as KeyholeStatus).budget;
}

// ── Tokens ──────────────────────────────────────────────────────────────────

export interface TokenTotals {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const zeroTokens = (): TokenTotals => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });

export function addTokens(a: TokenTotals, b: TokenTotals): TokenTotals {
  return { input: a.input + b.input, output: a.output + b.output, cacheWrite: a.cacheWrite + b.cacheWrite, cacheRead: a.cacheRead + b.cacheRead };
}

/** What one request to Claude used. */
export interface RequestUsage {
  tokens: TokenTotals;
  costUsd: number;
  model: string | null;
  /** Thinking blocks in the reply (including redacted ones). */
  thinkingBlocks: number;
}

interface RawUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

function applyUsage(t: TokenTotals, u: RawUsage | undefined | null): void {
  if (!u) return;
  if (typeof u.input_tokens === 'number') t.input = u.input_tokens;
  if (typeof u.output_tokens === 'number') t.output = u.output_tokens;
  if (typeof u.cache_creation_input_tokens === 'number') t.cacheWrite = u.cache_creation_input_tokens;
  if (typeof u.cache_read_input_tokens === 'number') t.cacheRead = u.cache_read_input_tokens;
}

/**
 * Wraps a client so each request's token usage (from the raw Anthropic stream events the
 * keyhole passes through) and cost are pushed into `sink`. Every event is re-yielded unchanged.
 */
export function tapUsage(client: KeyholeClient, sink: (usage: RequestUsage) => void): KeyholeClient {
  return async function* tapped(messages, signal) {
    const tokens = zeroTokens();
    let costUsd = 0;
    let model: string | null = null;
    let thinkingBlocks = 0;
    let seen = false;
    try {
      for await (const e of client(messages, signal)) {
        if (e.event === 'anthropic') {
          const data = e.data as { type: string; message?: { usage?: RawUsage; model?: string }; usage?: RawUsage; content_block?: { type?: string } };
          if (data.type === 'message_start') {
            seen = true;
            applyUsage(tokens, data.message?.usage);
            model = data.message?.model ?? model;
          } else if (data.type === 'message_delta') {
            applyUsage(tokens, data.usage);
          } else if (data.type === 'content_block_start' && /thinking/.test(data.content_block?.type ?? '')) {
            thinkingBlocks++;
          }
        } else if (e.event === 'done') {
          seen = true;
          costUsd = e.data.costUsd;
          model = e.data.model;
        }
        yield e;
      }
    } finally {
      if (seen) sink({ tokens, costUsd, model, thinkingBlocks });
    }
  };
}

// ── Tool errors ─────────────────────────────────────────────────────────────

/**
 * Why a tool call was rejected:
 * - `invalid_input`: Claude's input couldn't be parsed — schema validation (a missing field, the
 *   wrong type, an unknown enum value or field), a length or pitch that couldn't be read, a
 *   number with no unit, or malformed JSON. Always a wasted round trip.
 * - `refusal`: the input was understood and refused on its merits (a clash, a span past any
 *   header, a slab too big…). Some scenarios expect these.
 *
 * The agent only passes the message text through, so this matches the messages the parsers write
 * (`zodIssuesToErrors`, `parseLength`, `parsePitch`, design loads, dispatch's JSON check). Range
 * checks ("must be at least…") count as refusals: the input was read.
 */
export type ToolErrorKind = 'invalid_input' | 'refusal';

const INPUT_PARSE_PATTERNS: readonly RegExp[] = [
  /Couldn't read ".*" as an? /, // length, pitch, thickness, design load
  /has no unit\b/,
  /wasn't valid JSON/,
  /"[^"]*" is required\b/,
  /should be [^,]+, but got /,
  /must be one of .*\(you gave /,
  /^Unknown fields? "/m,
];

export function classifyToolError(content: string): ToolErrorKind {
  return INPUT_PARSE_PATTERNS.some((re) => re.test(content)) ? 'invalid_input' : 'refusal';
}

// ── Sessions ────────────────────────────────────────────────────────────────

/** One turn, as recorded for the report and the results file. */
export interface TurnRecord {
  prompt: string;
  turnId: string;
  costUsd: number;
  tokens: TokenTotals;
  /** Requests to Claude this turn. */
  requests: number;
  models: string[];
  /** Thinking blocks Claude wrote this turn: a later turn replays them, signatures and all. */
  thinking: number;
  /** Tool names in call order. */
  toolCalls: string[];
  /** Error results from tools or the guard, shortened. */
  toolErrors: string[];
  /** The `invalid_input` subset of `toolErrors`: calls rejected because their input couldn't be parsed. */
  badInput: string[];
  refusals: number;
  plan: boolean;
  options: string[] | null;
  capped: string | null;
  budget: BudgetStatus | null;
  text: string;
}

export interface EvalTurn {
  result: TurnResult;
  record: TurnRecord;
}

export interface EvalSession {
  bus: CommandBus;
  memory: AgentMemory;
  catalog: CatalogIndex;
  /** One turn; logs tool calls and returns the result with its record. */
  turn(input: UserInput | string): Promise<EvalTurn>;
}

export interface EvalSessionOptions {
  project?: Project;
  /** Builder commands run on the bus (as the person, one undo step) before any turn. */
  seed?: SeedCommands;
  prefs?: Partial<ChatPrefs>;
  log?: (line: string) => void;
}

export function evalSession(client: KeyholeClient, opts: EvalSessionOptions = {}): EvalSession {
  const siteDefaults: SiteDefaults = { table: DESIGN_LOAD_TABLE };
  const bus = new CommandBus({ project: opts.project ?? createProject({ name: 'Eval' }), catalog: TIER1_CATALOG, siteDefaults: () => siteDefaults });
  if (opts.seed && opts.seed.length > 0) applySeed(bus, opts.seed);
  const catalog = indexCatalog(TIER1_CATALOG);
  const analysis = async (p: Project) => analyze(p, catalog, { siteDefaults });
  const memory = new AgentMemory();
  if (opts.prefs?.confirmBigChanges !== undefined) memory.setPrefs({ confirmBigChanges: opts.prefs.confirmBigChanges });
  const log = opts.log ?? (() => {});

  let usage: RequestUsage[] = [];
  const tapped = tapUsage(client, (u) => usage.push(u));
  let toolCalls: string[] = [];
  let toolErrors: string[] = [];
  let badInput: string[] = [];
  const onEvent = (e: AgentEvent) => {
    if (e.type === 'tool_start') {
      toolCalls.push(e.name);
      log(`    → ${e.name} ${JSON.stringify(e.input).slice(0, 160)}`);
    }
    if (e.type === 'tool_result' && e.isError) {
      const msg = typeof e.content === 'string' ? e.content.slice(0, 200) : '(blocks)';
      const kind = typeof e.content === 'string' ? classifyToolError(e.content) : 'refusal';
      toolErrors.push(`${e.name}: ${msg}`);
      if (kind === 'invalid_input') badInput.push(`${e.name}: ${msg}`);
      log(`      ✗ ${kind === 'invalid_input' ? '(bad input) ' : ''}${msg}`);
    }
  };

  let n = 0;
  return {
    bus,
    memory,
    catalog,
    async turn(input) {
      const ui = typeof input === 'string' ? { text: input } : input;
      usage = [];
      toolCalls = [];
      toolErrors = [];
      badInput = [];
      const result = await runTurn({ bus, memory, client: tapped, onEvent, analysis, siteDefaults, newTurnId: () => `eval-${++n}` }, ui);
      const record: TurnRecord = {
        prompt: ui.text,
        turnId: result.turnId,
        costUsd: result.costUsd,
        tokens: usage.reduce((a, u) => addTokens(a, u.tokens), zeroTokens()),
        requests: usage.length,
        models: [...new Set(usage.map((u) => u.model).filter((m): m is string => m !== null))],
        thinking: usage.reduce((a, u) => a + u.thinkingBlocks, 0),
        toolCalls,
        toolErrors,
        badInput,
        refusals: result.refusals,
        plan: result.plan !== null,
        options: result.options,
        capped: result.capped,
        budget: result.budget,
        text: result.text,
      };
      return { result, record };
    },
  };
}
