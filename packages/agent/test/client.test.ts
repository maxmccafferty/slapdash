import { describe, expect, it } from 'vitest';
import { fetchKeyholeClient, formatSseEvent, KeyholeRequestError, type FetchLike, type FetchResponseLike, type KeyholeEvent } from '../src/index.ts';
import { BUDGET } from './fixtures/scripted-client.ts';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    json: async () => body,
    body: null,
  };
}

async function drain(it: AsyncIterable<KeyholeEvent>): Promise<KeyholeEvent[]> {
  const out: KeyholeEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('fetchKeyholeClient', () => {
  it('POSTs { messages } to /api/claude and reads the event stream', async () => {
    let seen: { url: string; body: string } | undefined;
    const fetch: FetchLike = async (url, init) => {
      seen = { url, body: init.body };
      return new Response(formatSseEvent('budget', BUDGET)) as unknown as FetchResponseLike;
    };
    const events = await drain(fetchKeyholeClient({ fetch })([{ role: 'user', content: 'hi' }]));
    expect(seen).toEqual({ url: '/api/claude', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
    expect(events).toEqual([{ event: 'budget', data: BUDGET }]);
  });

  it.each([
    [402, { error: 'budget_capped', budget: { ...BUDGET, state: 'capped' } }, 'capped'],
    [429, { error: 'rate_limited', retryAfterSeconds: 30 }, 'rate_limited'],
    [503, { error: 'not_configured' }, 'not_configured'],
    [400, { error: 'bad_request', message: 'x' }, 'upstream_error'],
    [500, { error: 'internal' }, 'upstream_error'],
  ])('maps a %i JSON error to a KeyholeRequestError', async (status, body, state) => {
    const client = fetchKeyholeClient({ fetch: async () => jsonResponse(status, body) });
    const err = await drain(client([{ role: 'user', content: 'hi' }])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyholeRequestError);
    expect(err).toMatchObject({ state, status, failure: body });
  });

  it('prefers the Retry-After header, and reports network failures', async () => {
    const limited = fetchKeyholeClient({ fetch: async () => jsonResponse(429, { error: 'rate_limited', retryAfterSeconds: 5 }, { 'retry-after': '42' }) });
    await expect(drain(limited([{ role: 'user', content: 'hi' }]))).rejects.toMatchObject({ failure: { retryAfterSeconds: 42 } });
    const down = fetchKeyholeClient({
      fetch: async () => {
        throw new Error('offline');
      },
    });
    await expect(drain(down([{ role: 'user', content: 'hi' }]))).rejects.toMatchObject({ state: 'upstream_error', failure: { error: 'network' } });
  });
});
