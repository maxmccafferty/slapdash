import { describe, expect, it } from 'vitest';
import { formatSseEvent, parseKeyholeEvents, parseKeyholeRequest, type KeyholeEvent } from '../src/index.ts';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<KeyholeEvent[]> {
  const out: KeyholeEvent[] = [];
  for await (const e of parseKeyholeEvents(stream)) out.push(e);
  return out;
}

const BUDGET = { state: 'ok', spentUsd: 0, capUsd: 10, fraction: 0, month: '2026-11', resetsAt: '2026-12-01T00:00:00.000Z' };

describe('keyhole request', () => {
  it('accepts plain text messages', () => {
    expect(parseKeyholeRequest({ messages: [{ role: 'user', content: 'Build a shed' }] }).ok).toBe(true);
  });

  it('accepts text, image and tool blocks', () => {
    const r = parseKeyholeRequest({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
            { type: 'text', text: 'Like this' },
          ],
        },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'build_wall', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it.each(['model', 'system', 'tools', 'max_tokens', 'thinking'])('rejects a client-set %s', (field) => {
    const r = parseKeyholeRequest({ messages: [{ role: 'user', content: 'hi' }], [field]: 'x' });
    expect(r.ok).toBe(false);
  });

  it('rejects a system role, empty messages and blocks without a type', () => {
    expect(parseKeyholeRequest({ messages: [{ role: 'system', content: 'hi' }] }).ok).toBe(false);
    expect(parseKeyholeRequest({ messages: [] }).ok).toBe(false);
    expect(parseKeyholeRequest({ messages: [{ role: 'user', content: [{ text: 'x' }] }] }).ok).toBe(false);
    expect(parseKeyholeRequest('nope').ok).toBe(false);
  });
});

describe('keyhole event stream', () => {
  it('round-trips formatted events', async () => {
    const text = formatSseEvent('budget', BUDGET) + formatSseEvent('anthropic', { type: 'message_stop' });
    expect(await collect(streamOf([text]))).toEqual([
      { event: 'budget', data: BUDGET },
      { event: 'anthropic', data: { type: 'message_stop' } },
    ]);
  });

  it('handles events split across chunks at every position', async () => {
    const text =
      formatSseEvent('budget', BUDGET) +
      formatSseEvent('anthropic', { type: 'content_block_delta', delta: { text: 'héllo\nthere' } }) +
      formatSseEvent('done', { budget: BUDGET, costUsd: 0.01, model: 'm', stopReason: 'end_turn' });
    const whole = await collect(streamOf([text]));
    expect(whole).toHaveLength(3);
    for (let i = 1; i < text.length; i++) {
      expect(await collect(streamOf([text.slice(0, i), text.slice(i)]))).toEqual(whole);
    }
    expect(await collect(streamOf([...text]))).toEqual(whole);
  });

  it('handles CRLF, comments, multi-line data, unknown events and a missing final blank line', async () => {
    const text = ': keep-alive\r\n\r\nevent: ping\r\ndata: {}\r\n\r\nevent: error\r\ndata: {"error":"upstream",\r\ndata: "message":"x","retryable":true}';
    expect(await collect(streamOf([text]))).toEqual([{ event: 'error', data: { error: 'upstream', message: 'x', retryable: true } }]);
  });
});
