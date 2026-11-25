/**
 * Builds Claude's reply from the keyhole's stream events. Hand-written so the agent package
 * needs only the SDK's types: text, thinking (with its signature), redacted thinking and
 * tool_use with streamed JSON input. Thinking blocks are kept unchanged, because the API
 * needs them back. With eager input streaming the tool JSON may be invalid; such an input is
 * replaced by `{ [INVALID_JSON_KEY]: raw }` so dispatch can say so instead of running it.
 */
import type { BetaContentBlock, BetaStopReason, BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { BudgetStatus, KeyholeDone, KeyholeEvent, KeyholeStreamError } from './protocol.ts';

/** Marks a tool input whose streamed JSON could not be parsed. */
export const INVALID_JSON_KEY = '__slapdash_invalid_json';

/** The keyhole reported an upstream failure mid-stream. */
export class KeyholeStreamFailure extends Error {
  readonly data: KeyholeStreamError;
  constructor(data: KeyholeStreamError) {
    super(data.message);
    this.name = 'KeyholeStreamFailure';
    this.data = data;
  }
}

/** A content block as stored and sent back: the API's own block objects, as plain JSON. */
export type AssistantBlock = BetaContentBlock | (Record<string, unknown> & { type: string });

export interface AccumulatedMessage {
  message: { role: 'assistant'; content: AssistantBlock[] };
  stopReason: BetaStopReason | null;
  usage: Partial<BetaUsage> | null;
  budget: BudgetStatus | null;
  done: KeyholeDone | null;
}

export interface AccumulateCallbacks {
  onTextDelta?: (text: string) => void;
  onBudget?: (budget: BudgetStatus) => void;
}

type Building = Record<string, unknown> & { type: string };

export async function accumulateMessage(events: AsyncIterable<KeyholeEvent>, cb: AccumulateCallbacks = {}): Promise<AccumulatedMessage> {
  const blocks: (Building | undefined)[] = [];
  const json = new Map<number, string>();
  let stopReason: BetaStopReason | null = null;
  let usage: Partial<BetaUsage> | null = null;
  let budget: BudgetStatus | null = null;
  let done: KeyholeDone | null = null;
  let sawStart = false;

  const finishJson = (index: number) => {
    const raw = json.get(index);
    const block = blocks[index];
    if (raw === undefined || !block) return;
    json.delete(index);
    if (raw.trim() === '') {
      block.input = {};
      return;
    }
    try {
      const value: unknown = JSON.parse(raw);
      block.input = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : { [INVALID_JSON_KEY]: raw };
    } catch {
      block.input = { [INVALID_JSON_KEY]: raw };
    }
  };

  for await (const e of events) {
    switch (e.event) {
      case 'budget':
        budget = e.data;
        cb.onBudget?.(e.data);
        break;
      case 'done':
        done = e.data;
        budget = e.data.budget;
        break;
      case 'error':
        throw new KeyholeStreamFailure(e.data);
      case 'anthropic': {
        const ev = e.data;
        switch (ev.type) {
          case 'message_start':
            sawStart = true;
            usage = { ...ev.message.usage };
            break;
          case 'content_block_start': {
            const block = structuredClone(ev.content_block) as unknown as Building;
            if (block.type === 'tool_use' || block.type === 'server_tool_use' || block.type === 'mcp_tool_use') json.set(ev.index, '');
            blocks[ev.index] = block;
            break;
          }
          case 'content_block_delta': {
            const block = blocks[ev.index];
            if (!block) break;
            const d = ev.delta;
            switch (d.type) {
              case 'text_delta':
                block.text = `${typeof block.text === 'string' ? block.text : ''}${d.text}`;
                cb.onTextDelta?.(d.text);
                break;
              case 'thinking_delta':
                block.thinking = `${typeof block.thinking === 'string' ? block.thinking : ''}${d.thinking}`;
                break;
              case 'signature_delta':
                block.signature = d.signature;
                break;
              case 'input_json_delta':
                json.set(ev.index, (json.get(ev.index) ?? '') + d.partial_json);
                break;
              case 'citations_delta': {
                const list = Array.isArray(block.citations) ? (block.citations as unknown[]) : [];
                block.citations = [...list, d.citation];
                break;
              }
              default:
                break;
            }
            break;
          }
          case 'content_block_stop':
            finishJson(ev.index);
            break;
          case 'message_delta':
            stopReason = ev.delta.stop_reason ?? null;
            usage = { ...(usage ?? {}), ...Object.fromEntries(Object.entries(ev.usage).filter(([, v]) => v != null)) };
            break;
          case 'message_stop':
            break;
        }
        break;
      }
    }
  }

  // A stream cut off mid-block: settle any tool input still being streamed.
  for (const index of [...json.keys()]) finishJson(index);
  if (!sawStart && !done) {
    throw new KeyholeStreamFailure({ error: 'upstream', message: 'The reply ended before it started.', retryable: true });
  }
  if (!done) {
    throw new KeyholeStreamFailure({ error: 'upstream', message: 'The reply was cut off before it finished.', retryable: true });
  }
  return {
    message: { role: 'assistant', content: blocks.filter((b): b is Building => b !== undefined) as AssistantBlock[] },
    stopReason: stopReason ?? (done.stopReason as BetaStopReason | null),
    usage,
    budget,
    done,
  };
}
