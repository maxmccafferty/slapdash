import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { parseKeyholeEvents, type KeyholeEvent } from '@slapdash/agent';
import type { ClaudeParams, ClaudeTransport } from '../src/index.ts';

export const SENTINEL_KEY = 'sk-ant-TEST-SENTINEL-do-not-leak-0123456789';

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** A canned Claude reply as stream events. */
export function cannedEvents(opts: { model?: string; start?: Usage; final?: Usage; text?: string[]; stopReason?: string } = {}): BetaRawMessageStreamEvent[] {
  const start = { input_tokens: 1000, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...opts.start };
  const final = { output_tokens: 500, ...opts.final };
  return [
    {
      type: 'message_start',
      message: { id: 'msg_1', type: 'message', role: 'assistant', model: opts.model ?? 'claude-sonnet-5-5', content: [], stop_reason: null, usage: start },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...(opts.text ?? ['Hello', ' there']).map((text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: opts.stopReason ?? 'end_turn', stop_sequence: null }, usage: final },
    { type: 'message_stop' },
  ] as unknown as BetaRawMessageStreamEvent[];
}

export interface FakeTransport {
  transport: ClaudeTransport;
  calls: ClaudeParams[];
  signals: AbortSignal[];
}

/** A transport that yields the given events, optionally throwing or pausing partway. */
export function fakeTransport(
  events: BetaRawMessageStreamEvent[] = cannedEvents(),
  opts: { throwAfter?: number; error?: unknown; pauseAfter?: number } = {},
): FakeTransport & { release: () => void; paused: Promise<void> } {
  const calls: ClaudeParams[] = [];
  const signals: AbortSignal[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let markPaused!: () => void;
  const paused = new Promise<void>((r) => (markPaused = r));
  const transport: ClaudeTransport = (params, signal) => {
    calls.push(params);
    signals.push(signal);
    return (async function* () {
      for (const [i, e] of events.entries()) {
        if (opts.throwAfter === i) throw opts.error;
        if (opts.pauseAfter === i) {
          markPaused();
          await Promise.race([gate, new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))]);
        }
        yield e;
      }
      if (opts.throwAfter === events.length) throw opts.error;
    })();
  };
  return { transport, calls, signals, release, paused };
}

export async function readEvents(response: Response): Promise<KeyholeEvent[]> {
  const out: KeyholeEvent[] = [];
  for await (const e of parseKeyholeEvents(response.body!)) out.push(e);
  return out;
}
