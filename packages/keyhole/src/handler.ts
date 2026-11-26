/**
 * The keyhole (ADR-0002 §A6): a stateless Web `Request → Response` handler that holds the
 * API key, enforces the rate limit and the monthly budget, and streams Claude's reply.
 * It stores counters only, never anything about the project.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { BetaIterationsUsage, BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  formatSseEvent,
  parseKeyholeRequest,
  type BudgetStatus,
  type KeyholeDone,
  type KeyholeError,
  type KeyholeStatus,
  type KeyholeStreamError,
} from '@slapdash/agent';
import { budgetStatus, monthKey } from './budget.ts';
import { anthropicTransport, buildClaudeParams, type ClaudeTransport } from './claude.ts';
import type { KeyholeConfig } from './config.ts';
import { identifyUser, type Identify } from './identify.ts';
import { costMicroUsd, type TokenUsage } from './pricing.ts';
import { checkRateLimit } from './rate-limit.ts';
import type { UsageStore } from './usage-store.ts';

export interface KeyholeDeps {
  config: KeyholeConfig;
  store: UsageStore;
  /** Defaults to the Anthropic SDK with `config.apiKey`. */
  transport?: ClaudeTransport;
  now?: () => Date;
  identify?: Identify;
  warn?: (message: string) => void;
}

export type KeyholeHandler = (request: Request) => Promise<Response>;

/** An error that is not in the public protocol: the store failed. */
type InternalError = { error: 'internal' };

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function json(status: number, body: KeyholeError | KeyholeStatus | InternalError, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

/** A rough output-token count for a stream cut off before `message_delta` reported one. */
const CHARS_PER_TOKEN = 3;

export function createKeyhole(deps: KeyholeDeps): KeyholeHandler {
  const { config, store } = deps;
  const now = deps.now ?? (() => new Date());
  const identify = deps.identify ?? identifyUser;
  const warn = deps.warn ?? console.warn;
  let transport = deps.transport;
  const getTransport = (apiKey: string) => (transport ??= anthropicTransport(apiKey));

  async function currentBudget(at: Date): Promise<BudgetStatus> {
    return budgetStatus(await store.getSpend(monthKey(at)), config.monthlyBudgetUsd, at);
  }

  function originAllowed(request: Request): boolean {
    const origin = request.headers.get('origin');
    if (origin === null) return true; // same-origin GETs, curl and server-to-server calls
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return false;
    }
    const host = request.headers.get('host') ?? new URL(request.url).host;
    return parsed.host === host || config.allowedOrigins.includes(parsed.origin);
  }

  /** Reads the body up to the limit. Returns undefined when it is too large. */
  async function readBody(request: Request): Promise<string | undefined> {
    if (!request.body) return '';
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > config.maxBodyBytes) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async function post(request: Request): Promise<Response> {
    if (!originAllowed(request)) return json(403, { error: 'forbidden_origin' });
    const apiKey = config.apiKey;
    if (!apiKey) return json(503, { error: 'not_configured' });

    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > config.maxBodyBytes) return json(413, { error: 'too_large' });
    const text = await readBody(request);
    if (text === undefined) return json(413, { error: 'too_large' });

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: 'bad_request', message: 'The request body is not valid JSON.' });
    }
    const parsed = parseKeyholeRequest(body);
    if (!parsed.ok) return json(400, { error: 'bad_request', message: parsed.message });
    if (parsed.request.messages.length > config.maxMessages) {
      return json(400, { error: 'bad_request', message: `Too many messages: at most ${config.maxMessages}.` });
    }

    const at = now();
    const budget = await currentBudget(at);
    if (budget.state === 'capped') return json(402, { error: 'budget_capped', budget });

    const limit = await checkRateLimit(store, await identify(request), config, at);
    if (!limit.ok) {
      return json(429, { error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, { 'Retry-After': String(limit.retryAfterSeconds) });
    }

    const params = buildClaudeParams(config, parsed.request.messages);
    const send = getTransport(apiKey);
    const upstream = new AbortController();
    const onClientAbort = () => upstream.abort();
    if (request.signal.aborted) upstream.abort();
    request.signal.addEventListener('abort', onClientAbort, { once: true });

    const encoder = new TextEncoder();
    let open = true;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (event: string, data: unknown) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(formatSseEvent(event, data)));
          } catch {
            open = false;
          }
        };
        void pump(emit).finally(() => {
          request.signal.removeEventListener('abort', onClientAbort);
          if (open) {
            open = false;
            try {
              controller.close();
            } catch {
              // already cancelled
            }
          }
        });
      },
      cancel() {
        open = false;
        upstream.abort();
      },
    });

    async function pump(emit: (event: string, data: unknown) => void): Promise<void> {
      emit('budget', budget);
      const seen = new UsageTracker(config.model);
      try {
        for await (const event of send(params, upstream.signal)) {
          seen.track(event);
          emit('anthropic', event);
        }
        const recorded = await record(seen);
        const done: KeyholeDone = { budget: recorded.budget, costUsd: recorded.micro / 1e6, model: seen.model, stopReason: seen.stopReason };
        emit('done', done);
      } catch (error) {
        await record(seen);
        if (!upstream.signal.aborted) emit('error', upstreamError(error));
      }
    }

    async function record(seen: UsageTracker): Promise<{ micro: number; budget: BudgetStatus }> {
      const micro = seen.costMicro(warn);
      const at = now();
      try {
        const total = micro > 0 ? await store.addSpend(monthKey(at), micro) : await store.getSpend(monthKey(at));
        return { micro, budget: budgetStatus(total, config.monthlyBudgetUsd, at) };
      } catch (error) {
        warn(`[keyhole] Could not record spend of ${micro} micro-USD: ${(error as Error).message}`);
        return { micro, budget };
      }
    }

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
    });
  }

  return async function keyhole(request) {
    try {
      if (request.method === 'GET') {
        const status: KeyholeStatus = { configured: Boolean(config.apiKey), model: config.model, budget: await currentBudget(now()) };
        return json(200, status);
      }
      if (request.method === 'POST') return await post(request);
      return json(405, { error: 'method_not_allowed' }, { Allow: 'GET, POST' });
    } catch (error) {
      warn(`[keyhole] ${(error as Error).message}`);
      return json(500, { error: 'internal' });
    }
  };
}

/**
 * Follows the usage the stream reports: `message_start` carries input and cache tokens,
 * `message_delta` the cumulative totals. If the stream stops before `message_delta`, output
 * tokens are estimated from the characters streamed so far.
 */
class UsageTracker {
  model: string;
  stopReason: string | null = null;
  #usage: TokenUsage = {};
  #iterations: BetaIterationsUsage | null = null;
  #sawDelta = false;
  #chars = 0;

  constructor(model: string) {
    this.model = model;
  }

  track(event: BetaRawMessageStreamEvent): void {
    switch (event.type) {
      case 'message_start':
        this.model = event.message.model;
        this.#usage = { ...pickUsage(event.message.usage) };
        break;
      case 'message_delta': {
        this.#sawDelta = true;
        for (const [k, v] of Object.entries(pickUsage(event.usage))) {
          if (v != null) this.#usage[k as keyof TokenUsage] = v;
        }
        if (event.usage.iterations) this.#iterations = event.usage.iterations;
        this.stopReason = event.delta.stop_reason ?? null;
        break;
      }
      case 'content_block_delta': {
        const d = event.delta as { text?: string; thinking?: string; partial_json?: string };
        this.#chars += (d.text ?? d.thinking ?? d.partial_json ?? '').length;
        break;
      }
      default:
        break;
    }
  }

  costMicro(warn: (message: string) => void): number {
    // When a fallback model answered, each iteration is priced at its own model's rates.
    if (this.#iterations?.some((i) => i.type === 'fallback_message')) {
      return this.#iterations
        .filter((i) => i.type !== 'compaction')
        .reduce((sum, i) => sum + costMicroUsd(('model' in i && i.model) || this.model, i, warn), 0);
    }
    const usage = { ...this.#usage };
    if (!this.#sawDelta) usage.output_tokens = Math.max(usage.output_tokens ?? 0, Math.ceil(this.#chars / CHARS_PER_TOKEN));
    return costMicroUsd(this.model, usage, warn);
  }
}

function pickUsage(u: TokenUsage): TokenUsage {
  return {
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_creation_input_tokens: u.cache_creation_input_tokens,
    cache_read_input_tokens: u.cache_read_input_tokens,
  };
}

/** Maps SDK errors to a stream error. Never echoes headers or the key. */
export function upstreamError(error: unknown): KeyholeStreamError {
  if (error instanceof Anthropic.RateLimitError) {
    return { error: 'upstream', message: 'Claude is rate limited right now. Try again in a moment.', retryable: true };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { error: 'upstream', message: 'Could not reach Claude. Check the connection and try again.', retryable: true };
  }
  if (error instanceof Anthropic.InternalServerError) {
    return { error: 'upstream', message: `Claude is busy or having trouble (HTTP ${error.status}). Try again shortly.`, retryable: true };
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return { error: 'upstream', message: "The server's Anthropic API key was rejected.", retryable: false };
  }
  if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
    return { error: 'upstream', message: `Claude rejected the request (HTTP ${error.status}).`, retryable: false };
  }
  return { error: 'upstream', message: "Claude's reply failed.", retryable: false };
}
