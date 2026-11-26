/**
 * The scenario API: a scenario seeds a model, runs one or more turns through the real agent
 * loop and lists its expectations. Each check returns a plain-language failure or null, so a
 * scenario reads as a list of what should be true.
 */
import type { ChatPrefs, KeyholeClient, TurnResult, UserInput } from '@slapdash/agent';
import { noBadInput } from './checks.ts';
import { evalSession, type EvalSession, type TurnRecord } from './harness.ts';
import type { SeedCommands } from './seeds.ts';

/** What the model looked like before the first turn, after seeding. */
export interface Baseline {
  /** Undo steps (not counting undone ones). */
  historyLength: number;
  partIds: Set<string>;
  jointCount: number;
}

/** A turn's result with its record (tokens, tool names…). */
export type Turn = TurnResult & { record: TurnRecord };

export interface ScenarioContext {
  session: EvalSession;
  /** Runs one turn, records it and logs the prompt and reply. */
  turn(input: UserInput | string): Promise<Turn>;
  /** Collects failures: null (or an array of nulls) passes. */
  expect(failure: string | null | ReadonlyArray<string | null>): void;
  /** Writes a line to the scenario's log (shown on failure or with --verbose). */
  log(line: string): void;
  baseline: Baseline;
}

export interface Scenario {
  /** kebab-case, used by --only. */
  name: string;
  /** One line, printed by --list. */
  description: string;
  seed?: SeedCommands;
  prefs?: Partial<ChatPrefs>;
  /** A small edit or question: counts towards the "typical turn" cost in the cap check. */
  typical?: boolean;
  /** A full build from nothing: its cost is quoted in the cap check. */
  fullBuild?: boolean;
  /**
   * Turns off the default "no input-parse rejections" check, for scenarios that deliberately feed
   * bad input. The rejections are still counted in the report and the run's summary.
   */
  allowBadInput?: boolean;
  run(ctx: ScenarioContext): Promise<void>;
}

export const defineScenario = (s: Scenario): Scenario => s;

export type ScenarioStatus = 'pass' | 'fail' | 'skip' | 'error';

export interface ScenarioResult {
  name: string;
  status: ScenarioStatus;
  failures: string[];
  turns: TurnRecord[];
  durationMs: number;
  error?: string;
  /** Why it was skipped. */
  skipReason?: string;
  /** The tool-call log, kept for failures and --verbose. */
  log: string[];
  typical: boolean;
  fullBuild: boolean;
}

export function baselineOf(session: EvalSession): Baseline {
  const p = session.bus.project;
  return { historyLength: undoSteps(session), partIds: new Set(Object.keys(p.parts)), jointCount: Object.keys(p.joints).length };
}

/** Undo steps on the bus, not counting undone (redoable) ones. */
export function undoSteps(session: Pick<EvalSession, 'bus'>): number {
  return session.bus.listHistory(Number.MAX_SAFE_INTEGER).filter((h) => !h.isUndone).length;
}

export function skippedResult(s: Scenario, reason: string): ScenarioResult {
  return { name: s.name, status: 'skip', failures: [], turns: [], durationMs: 0, skipReason: reason, log: [], typical: !!s.typical, fullBuild: !!s.fullBuild };
}

/** Builds the session, seeds it, runs the scenario and catches errors (keeping the turns so far, for cost). */
export async function runScenario(scenario: Scenario, client: KeyholeClient, opts: { onLine?: (line: string) => void } = {}): Promise<ScenarioResult> {
  const started = Date.now();
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    opts.onLine?.(line);
  };
  const failures: string[] = [];
  const turns: TurnRecord[] = [];
  const base = { name: scenario.name, failures, turns, log: lines, typical: !!scenario.typical, fullBuild: !!scenario.fullBuild };
  try {
    const session = evalSession(client, {
      ...(scenario.seed ? { seed: scenario.seed } : {}),
      ...(scenario.prefs ? { prefs: scenario.prefs } : {}),
      log,
    });
    const ctx: ScenarioContext = {
      session,
      baseline: baselineOf(session),
      log,
      expect(f) {
        const list = Array.isArray(f) ? f : [f];
        for (const x of list) if (x !== null) failures.push(x);
      },
      async turn(input) {
        const text = typeof input === 'string' ? input : input.text;
        log(`  T${turns.length + 1} "${text}"`);
        let turn;
        try {
          turn = await session.turn(input);
        } catch (e) {
          // An upstream error (e.g. the API refusing the replayed history) ends the scenario as an
          // error, never a pass: say which turn it was.
          const msg = e instanceof Error ? e.message : String(e);
          const status = typeof (e as { status?: unknown })?.status === 'number' ? ` (HTTP ${(e as { status: number }).status})` : '';
          log(`    ✗ error${status}: ${msg}`);
          throw new Error(`T${turns.length + 1} "${text.slice(0, 60)}" ended in an error${status}: ${msg}`, { cause: e });
        }
        const { result, record } = turn;
        turns.push(record);
        log(`    Claude: ${record.text.replace(/\s+/g, ' ').slice(0, 400)}`);
        if (!scenario.allowBadInput) ctx.expect(noBadInput(record, `T${turns.length}`));
        return { ...result, record };
      },
    };
    await scenario.run(ctx);
    return { ...base, status: failures.length === 0 ? 'pass' : 'fail', durationMs: Date.now() - started };
  } catch (e) {
    return { ...base, status: 'error', error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - started };
  }
}
