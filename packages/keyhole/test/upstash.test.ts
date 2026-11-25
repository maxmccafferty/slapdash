import { describe, expect, it } from 'vitest';
import { SPEND_TTL_SECONDS } from '../src/stores/upstash.ts';
import { UpstashUsageStore } from '../src/index.ts';
import { usageStoreContract } from './usage-store.suite.ts';

/** A tiny in-memory Redis that speaks Upstash's `/pipeline` REST shape. */
function fakeUpstash() {
  let now = Date.parse('2026-11-25T00:00:00Z');
  const data = new Map<string, { value: number; expiresAt?: number }>();
  const calls: { url: string; headers: Record<string, string>; commands: (string | number)[][] }[] = [];
  const live = (key: string) => {
    const e = data.get(key);
    if (e?.expiresAt !== undefined && e.expiresAt <= now) data.delete(key);
    return data.get(key);
  };
  const run = ([cmd, key, arg, flag]: (string | number)[]): unknown => {
    const k = String(key);
    switch (cmd) {
      case 'INCR':
      case 'INCRBY': {
        const e = live(k) ?? { value: 0 };
        e.value += cmd === 'INCR' ? 1 : Number(arg);
        data.set(k, e);
        return e.value;
      }
      case 'GET':
        return live(k) ? String(live(k)!.value) : null;
      case 'EXPIRE': {
        const e = live(k);
        if (!e || (flag === 'NX' && e.expiresAt !== undefined)) return 0;
        e.expiresAt = now + Number(arg) * 1000;
        return 1;
      }
      default:
        throw new Error(`unexpected ${cmd}`);
    }
  };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const commands = JSON.parse(String(init.body)) as (string | number)[][];
    calls.push({ url, headers: init.headers as Record<string, string>, commands });
    return new Response(JSON.stringify(commands.map((c) => ({ result: run(c) }))));
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, advance: (ms: number) => (now += ms) };
}

usageStoreContract('upstash', () => {
  const fake = fakeUpstash();
  return { store: new UpstashUsageStore({ url: 'https://kv.example', token: 't' }, fake.fetchImpl), advance: fake.advance };
});

describe('upstash usage store', () => {
  it('sends the exact pipeline commands and bearer token', async () => {
    const fake = fakeUpstash();
    const store = new UpstashUsageStore({ url: 'https://kv.example/', token: 'secret-token' }, fake.fetchImpl);
    await store.incr('rl:m:u:1', 61);
    await store.addSpend('2026-11', 52_000);
    await store.getSpend('2026-11');
    expect(fake.calls.map((c) => c.url)).toEqual(Array(3).fill('https://kv.example/pipeline'));
    expect(fake.calls[0]!.headers.Authorization).toBe('Bearer secret-token');
    expect(fake.calls.map((c) => c.commands)).toEqual([
      [
        ['INCR', 'rl:m:u:1'],
        ['EXPIRE', 'rl:m:u:1', 61, 'NX'],
      ],
      [
        ['INCRBY', 'spend:2026-11', 52_000],
        ['EXPIRE', 'spend:2026-11', SPEND_TTL_SECONDS],
      ],
      [['GET', 'spend:2026-11']],
    ]);
  });

  it('throws on HTTP and command errors', async () => {
    const bad = new UpstashUsageStore({ url: 'https://kv', token: 't' }, (async () => new Response('no', { status: 401 })) as unknown as typeof fetch);
    await expect(bad.getSpend('2026-11')).rejects.toThrow('HTTP 401');
    const err = new UpstashUsageStore(
      { url: 'https://kv', token: 't' },
      (async () => new Response(JSON.stringify([{ error: 'WRONGTYPE' }]))) as unknown as typeof fetch,
    );
    await expect(err.getSpend('2026-11')).rejects.toThrow('WRONGTYPE');
  });
});
