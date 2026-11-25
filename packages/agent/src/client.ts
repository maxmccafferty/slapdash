/**
 * How the loop reaches Claude: a `KeyholeClient` streams one reply for a list of messages.
 * `fetchKeyholeClient` POSTs to the keyhole (`/api/claude` in the browser). Evals pass a
 * `fetch` that calls an in-process keyhole handler, so no server is needed. `fetch` is
 * typed minimally here so this package needs no DOM types.
 */
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { parseKeyholeEvents, type KeyholeError, type KeyholeEvent, type KeyholeState } from './protocol.ts';

export type KeyholeClient = (messages: BetaMessageParam[], signal?: AbortSignal) => AsyncIterable<KeyholeEvent>;

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  body: ReadableStream<Uint8Array> | null;
}

export interface FetchInitLike {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export type FetchLike = (url: string, init: FetchInitLike) => Promise<FetchResponseLike>;

/** What the keyhole refused with, or a network failure. */
export type KeyholeRequestFailure = KeyholeError | { error: 'internal' } | { error: 'network'; message: string };

/** The keyhole refused the request (no stream), or it could not be reached. */
export class KeyholeRequestError extends Error {
  readonly failure: KeyholeRequestFailure;
  /** The chat state to show. */
  readonly state: KeyholeState;
  readonly status: number;
  constructor(failure: KeyholeRequestFailure, status: number) {
    super(describeFailure(failure));
    this.name = 'KeyholeRequestError';
    this.failure = failure;
    this.status = status;
    this.state = stateOf(failure);
  }
}

export function stateOf(failure: KeyholeRequestFailure): KeyholeState {
  switch (failure.error) {
    case 'budget_capped':
      return 'capped';
    case 'rate_limited':
      return 'rate_limited';
    case 'not_configured':
      return 'not_configured';
    default:
      return 'upstream_error';
  }
}

function describeFailure(f: KeyholeRequestFailure): string {
  switch (f.error) {
    case 'budget_capped':
      return "This month's Claude budget is used up.";
    case 'rate_limited':
      return `Too many requests; try again in ${f.retryAfterSeconds} seconds.`;
    case 'not_configured':
      return 'Claude is not set up on this server.';
    case 'bad_request':
      return `The request was refused: ${f.message}`;
    case 'too_large':
      return 'The conversation is too large to send.';
    case 'forbidden_origin':
      return 'This site is not allowed to use the Claude server.';
    case 'method_not_allowed':
      return 'The Claude server refused the request method.';
    case 'network':
      return `The Claude server could not be reached: ${f.message}`;
    default:
      return 'The Claude server had a problem.';
  }
}

function isKeyholeFailure(value: unknown): value is KeyholeRequestFailure {
  return typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string';
}

export function fetchKeyholeClient(opts: { url?: string; fetch: FetchLike }): KeyholeClient {
  const url = opts.url ?? '/api/claude';
  return async function* keyhole(messages, signal) {
    let res: FetchResponseLike;
    try {
      res = await opts.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ messages }),
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new KeyholeRequestError({ error: 'network', message: e instanceof Error ? e.message : String(e) }, 0);
    }
    if (!res.ok || !res.body) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      if (isKeyholeFailure(body)) {
        // A Retry-After header is the source of truth for the wait when present.
        if (body.error === 'rate_limited') {
          const header = Number(res.headers.get('retry-after'));
          if (Number.isFinite(header) && header > 0) body = { ...body, retryAfterSeconds: header };
        }
        throw new KeyholeRequestError(body as KeyholeRequestFailure, res.status);
      }
      throw new KeyholeRequestError({ error: 'internal' }, res.status);
    }
    yield* parseKeyholeEvents(res.body);
  };
}
