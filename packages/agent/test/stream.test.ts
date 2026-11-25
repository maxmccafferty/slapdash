import { describe, expect, it, vi } from 'vitest';
import { accumulateMessage, INVALID_JSON_KEY, KeyholeStreamFailure, type KeyholeEvent } from '../src/index.ts';
import { BUDGET, replyEvents } from '../testing/scripted-client.ts';

async function* from(events: KeyholeEvent[]): AsyncGenerator<KeyholeEvent> {
  for (const e of events) yield e;
}

describe('stream accumulator', () => {
  it('builds text, thinking with its signature, and tool input streamed in pieces', async () => {
    const deltas: string[] = [];
    const onBudget = vi.fn();
    const out = await accumulateMessage(
      from(
        replyEvents({
          content: [
            { type: 'thinking', thinking: 'Slab first.', signature: 'sig-1' },
            { type: 'text', text: 'Pouring the slab.' },
            { type: 'tool_use', id: 't1', name: 'pour_slab', input: { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } } },
          ],
          costUsd: 0.02,
        }),
      ),
      { onTextDelta: (t) => deltas.push(t), onBudget },
    );
    expect(out.message).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Slab first.', signature: 'sig-1' },
        { type: 'text', text: 'Pouring the slab.', citations: null },
        { type: 'tool_use', id: 't1', name: 'pour_slab', input: { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } } },
      ],
    });
    expect(deltas.join('')).toBe('Pouring the slab.');
    expect(onBudget).toHaveBeenCalledWith(BUDGET);
    expect(out.stopReason).toBe('tool_use');
    expect(out.done?.costUsd).toBe(0.02);
    expect(out.usage).toMatchObject({ input_tokens: 10, output_tokens: 20 });
  });

  it('keeps redacted thinking unchanged and treats empty tool input as {}', async () => {
    const events = replyEvents({ content: [{ type: 'tool_use', id: 't1', name: 'undo', input: {}, rawJson: '' }] });
    events.splice(2, 0, { event: 'anthropic', data: { type: 'content_block_start', index: 5, content_block: { type: 'redacted_thinking', data: 'xyz' } } } as KeyholeEvent);
    events.splice(3, 0, { event: 'anthropic', data: { type: 'content_block_stop', index: 5 } } as KeyholeEvent);
    const out = await accumulateMessage(from(events));
    expect(out.message.content).toEqual([
      { type: 'tool_use', id: 't1', name: 'undo', input: {} },
      { type: 'redacted_thinking', data: 'xyz' },
    ]);
  });

  it('marks unparseable tool JSON instead of throwing', async () => {
    const out = await accumulateMessage(from(replyEvents({ content: [{ type: 'tool_use', id: 't1', name: 'build_wall', input: null, rawJson: '{"start": {"x": 0,' }] })));
    expect(out.message.content[0]).toMatchObject({ type: 'tool_use', input: { [INVALID_JSON_KEY]: '{"start": {"x": 0,' } });
  });

  it('throws a KeyholeStreamFailure on an error event, and when the stream stops early', async () => {
    const events = replyEvents({ content: [{ type: 'text', text: 'Hi' }] });
    const failed = [...events.slice(0, 4), { event: 'error', data: { error: 'upstream', message: 'Overloaded', retryable: true } } as KeyholeEvent];
    await expect(accumulateMessage(from(failed))).rejects.toMatchObject({ name: 'KeyholeStreamFailure', data: { error: 'upstream', retryable: true } });
    await expect(accumulateMessage(from(events.slice(0, -1)))).rejects.toBeInstanceOf(KeyholeStreamFailure);
  });
});
