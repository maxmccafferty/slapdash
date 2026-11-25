/**
 * A fake `KeyholeClient` that replays scripted assistant messages as keyhole stream events,
 * the way the real keyhole does: budget, the Anthropic events (tool input streamed as JSON
 * in pieces), then done. It records every message list it was sent.
 */
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { BudgetStatus, KeyholeClient, KeyholeEvent } from '../src/index.ts';

export const BUDGET: BudgetStatus = { state: 'ok', spentUsd: 1, capUsd: 10, fraction: 0.1, month: '2026-11', resetsAt: '2026-12-01T00:00:00.000Z' };

export type ScriptBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'tool_use'; name: string; input: unknown; id?: string; rawJson?: string };

export interface ScriptedReply {
  content: ScriptBlock[];
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';
  costUsd?: number;
}

export type ScriptStep = ScriptedReply | Error | ((messages: BetaMessageParam[]) => ScriptedReply | Error);

/** Shorthands for scripts. */
export const say = (text: string): ScriptedReply => ({ content: [{ type: 'text', text }], stopReason: 'end_turn' });
export const call = (...calls: [name: string, input: unknown][]): ScriptedReply => ({
  content: calls.map(([name, input]) => ({ type: 'tool_use', name, input })),
  stopReason: 'tool_use',
});

let toolIds = 0;

export function replyEvents(reply: ScriptedReply): KeyholeEvent[] {
  const events: KeyholeEvent[] = [{ event: 'budget', data: BUDGET }];
  const a = (data: unknown) => events.push({ event: 'anthropic', data } as KeyholeEvent);
  a({ type: 'message_start', message: { id: 'msg', type: 'message', role: 'assistant', model: 'claude-test', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  reply.content.forEach((b, index) => {
    if (b.type === 'text') {
      a({ type: 'content_block_start', index, content_block: { type: 'text', text: '', citations: null } });
      const mid = Math.floor(b.text.length / 2);
      a({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text.slice(0, mid) } });
      a({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text.slice(mid) } });
    } else if (b.type === 'thinking') {
      a({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      a({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: b.thinking } });
      a({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: b.signature } });
    } else {
      const id = b.id ?? `toolu_${++toolIds}`;
      a({ type: 'content_block_start', index, content_block: { type: 'tool_use', id, name: b.name, input: {} } });
      const json = b.rawJson ?? JSON.stringify(b.input);
      const mid = Math.floor(json.length / 2);
      a({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(0, mid) } });
      a({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(mid) } });
    }
    a({ type: 'content_block_stop', index });
  });
  const stop = reply.stopReason ?? (reply.content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn');
  a({ type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 }, context_management: null });
  a({ type: 'message_stop' });
  events.push({ event: 'done', data: { budget: BUDGET, costUsd: reply.costUsd ?? 0.01, model: 'claude-test', stopReason: stop } });
  return events;
}

export interface ScriptedClient {
  client: KeyholeClient;
  /** Every message list sent, deep-copied at the time. */
  sent: BetaMessageParam[][];
  /** Steps not yet used. */
  remaining(): number;
}

export function scriptedClient(steps: ScriptStep[]): ScriptedClient {
  const queue = [...steps];
  const sent: BetaMessageParam[][] = [];
  const client: KeyholeClient = async function* (messages) {
    sent.push(structuredClone(messages));
    const step = queue.shift();
    if (step === undefined) throw new Error('The script ran out of replies.');
    const reply = typeof step === 'function' ? step(messages) : step;
    if (reply instanceof Error) throw reply;
    yield* replyEvents(reply);
  };
  return { client, sent, remaining: () => queue.length };
}
