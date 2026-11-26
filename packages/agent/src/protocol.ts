/**
 * The wire protocol between the browser and the Claude keyhole (`/api/claude`). Safe for
 * the browser: types only from the Anthropic SDK, nothing that touches the key.
 *
 * GET  /api/claude → 200 `KeyholeStatus`
 * POST /api/claude with a `KeyholeRequest` → 200 `text/event-stream`, or a JSON `KeyholeError`
 *
 * Stream events, in order:
 *   event: budget     data: BudgetStatus               (first, so the chat can show the 80% note)
 *   event: anthropic  data: BetaRawMessageStreamEvent  (passed through unchanged)
 *   event: done       data: KeyholeDone
 *   event: error      data: KeyholeStreamError         (instead of `done` when Claude fails)
 */
import type { BetaMessageParam, BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { z } from 'zod';

export type BudgetState = 'ok' | 'warning' | 'capped';

export interface BudgetStatus {
  state: BudgetState;
  /** Spend this month in dollars. */
  spentUsd: number;
  capUsd: number;
  /** spent / cap, not clamped: it can exceed 1 when concurrent requests overshoot the cap. */
  fraction: number;
  /** UTC month, `YYYY-MM`. */
  month: string;
  /** ISO time the budget resets: the first day of next month, 00:00 UTC. */
  resetsAt: string;
}

/** GET /api/claude */
export interface KeyholeStatus {
  configured: boolean;
  model: string;
  budget: BudgetStatus;
  /** `SLAPDASH_DEFAULT_LOCATION` ("City, ST"), when the server sets one: the default location for design loads. */
  defaultLocation?: string;
}

/** POST /api/claude body. The client cannot choose the model, system prompt, tools or limits. */
export interface KeyholeRequest {
  messages: BetaMessageParam[];
}

export type KeyholeError =
  | { error: 'not_configured' } // 503: no ANTHROPIC_API_KEY on the server
  | { error: 'budget_capped'; budget: BudgetStatus } // 402: Anthropic is not called
  | { error: 'rate_limited'; retryAfterSeconds: number } // 429, with a Retry-After header
  | { error: 'bad_request'; message: string } // 400
  | { error: 'too_large' } // 413
  | { error: 'forbidden_origin' } // 403
  | { error: 'method_not_allowed' } // 405
  | { error: 'sign_in_required' }; // 401: sign-in is on and the request has no valid user token

export interface KeyholeDone {
  budget: BudgetStatus;
  /** What this request cost, in dollars. */
  costUsd: number;
  /** The model that answered (a fallback model if the first one declined). */
  model: string;
  stopReason: string | null;
}

export interface KeyholeStreamError {
  error: 'upstream';
  message: string;
  /** True for overload, rate limit and connection failures: trying again later may work. */
  retryable: boolean;
}

export type KeyholeEvent =
  | { event: 'budget'; data: BudgetStatus }
  | { event: 'anthropic'; data: BetaRawMessageStreamEvent }
  | { event: 'done'; data: KeyholeDone }
  | { event: 'error'; data: KeyholeStreamError };

/** Every state the chat may need to render. */
export type KeyholeState = 'ok' | 'warning' | 'capped' | 'rate_limited' | 'not_configured' | 'upstream_error';

export const KEYHOLE_STATES = [
  'ok',
  'warning',
  'capped',
  'rate_limited',
  'not_configured',
  'upstream_error',
] as const satisfies readonly KeyholeState[];

// ── Request validation ──────────────────────────────────────────────────────

/**
 * A content block. Anthropic validates block shapes; the keyhole only checks that each one is
 * an object with a `type`, so new block types (thinking, tool results, images) pass through.
 */
const zContentBlock = z.looseObject({ type: z.string().min(1) });

const zMessage = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(zContentBlock).min(1)]),
});

/** Strict: a body carrying `model`, `system`, `tools`, `max_tokens` or anything else is rejected. */
export const zKeyholeRequest = z.strictObject({
  messages: z.array(zMessage).min(1),
});

/** Validates a POST body. Returns the typed request or a plain-language message. */
export function parseKeyholeRequest(body: unknown): { ok: true; request: KeyholeRequest } | { ok: false; message: string } {
  const result = zKeyholeRequest.safeParse(body);
  if (result.success) return { ok: true, request: result.data as unknown as KeyholeRequest };
  return { ok: false, message: z.prettifyError(result.error) };
}

// ── Server-sent events ──────────────────────────────────────────────────────

/** Formats one server-sent event. */
export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const KNOWN_EVENTS = new Set(['budget', 'anthropic', 'done', 'error']);

/**
 * Reads a keyhole event stream. Handles events split across chunks, CRLF line endings,
 * multi-line `data:` fields and comment lines. Unknown event names are skipped.
 */
export async function* parseKeyholeEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<KeyholeEvent> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n?/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = parseBlock(block);
        if (event) yield event;
      }
      if (done) break;
    }
    const tail = parseBlock(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): KeyholeEvent | undefined {
  let name = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') name = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0 || !KNOWN_EVENTS.has(name)) return undefined;
  return { event: name, data: JSON.parse(data.join('\n')) } as KeyholeEvent;
}
