import { describe, expect, it, vi } from 'vitest';
import type { KeyholeStatus } from '@slapdash/agent';
import { createKeyhole, createKeyholeFromEnv, MemoryUsageStore, readConfig, supabaseIdentity, bearerToken } from '../src/index.ts';
import { fakeTransport, readEvents, SENTINEL_KEY } from './helpers.ts';

const URL_ = 'http://localhost:5173/api/claude';
const SUPABASE = 'https://abc.supabase.co';
const BODY = JSON.stringify({ messages: [{ role: 'user', content: 'Build a shed' }] });

/** Supabase Auth's GET /auth/v1/user: token "good-<id>" belongs to user <id>. */
function fakeSupabase() {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url: String(url), headers });
    const token = headers.authorization?.replace(/^Bearer /, '') ?? '';
    if (token.startsWith('good-')) return Response.json({ id: token.slice(5), email: 'x@example.com' });
    return Response.json({ code: 401, msg: 'invalid JWT' }, { status: 401 });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const req = (token?: string, method = 'POST') =>
  new Request(URL_, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(method === 'POST' ? { body: BODY } : {}),
  });

describe('supabaseIdentity', () => {
  it('reads the bearer token', () => {
    expect(bearerToken(req('abc'))).toBe('abc');
    expect(bearerToken(req())).toBeNull();
    expect(bearerToken(new Request(URL_, { headers: { authorization: 'Basic x' } }))).toBeNull();
  });

  it('asks Supabase Auth with the publishable key and the token, and caches the answer', async () => {
    const sb = fakeSupabase();
    let t = 0;
    const id = supabaseIdentity({ url: `${SUPABASE}/`, key: 'sb_publishable_x', fetch: sb.fetch, now: () => t });
    expect(await id.verify(req('good-u1'))).toBe('u1');
    expect(sb.calls).toEqual([{ url: `${SUPABASE}/auth/v1/user`, headers: { apikey: 'sb_publishable_x', authorization: 'Bearer good-u1' } }]);
    t = 59_000;
    expect(await id.verify(req('good-u1'))).toBe('u1');
    expect(sb.calls).toHaveLength(1);
    t = 61_000;
    expect(await id.verify(req('good-u1'))).toBe('u1');
    expect(sb.calls).toHaveLength(2);
    expect(await id.identify(req('good-u1'))).toBe('u:u1');
  });

  it('refuses a missing or bad token, and a Supabase that can’t be reached', async () => {
    const sb = fakeSupabase();
    const id = supabaseIdentity({ url: SUPABASE, key: 'k', fetch: sb.fetch });
    expect(await id.verify(req())).toBeNull();
    expect(sb.calls).toHaveLength(0);
    expect(await id.verify(req('bad'))).toBeNull();
    const down = supabaseIdentity({
      url: SUPABASE,
      key: 'k',
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    expect(await down.verify(req('good-u1'))).toBeNull();
  });

  it('keeps at most maxEntries tokens', async () => {
    const sb = fakeSupabase();
    const id = supabaseIdentity({ url: SUPABASE, key: 'k', fetch: sb.fetch, maxEntries: 2 });
    for (const u of ['a', 'b', 'c']) await id.verify(req(`good-${u}`));
    await id.verify(req('good-a'));
    expect(sb.calls).toHaveLength(4);
  });
});

describe('the sign-in gate', () => {
  function setup(env: Record<string, string> = {}) {
    const sb = fakeSupabase();
    const config = readConfig({ ANTHROPIC_API_KEY: SENTINEL_KEY, SLAPDASH_RATE_PER_MINUTE: '2', SLAPDASH_DEFAULT_LOCATION: 'Bend, OR', ...env });
    const store = new MemoryUsageStore(() => Date.parse('2026-11-25T12:00:00Z'));
    const fake = fakeTransport();
    const identity = supabaseIdentity({ url: SUPABASE, key: 'k', fetch: sb.fetch });
    const keyhole = createKeyhole({
      config,
      store,
      transport: fake.transport,
      now: () => new Date('2026-11-25T12:00:00Z'),
      authenticate: identity.verify,
      identify: identity.identify,
      warn: () => {},
    });
    return { keyhole, fake, sb };
  }

  it('POST without a token → 401 sign_in_required, and Claude is never called', async () => {
    const { keyhole, fake } = setup();
    const res = await keyhole(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'sign_in_required' });
    const bad = await keyhole(req('bad'));
    expect(bad.status).toBe(401);
    expect(fake.calls).toHaveLength(0);
  });

  it('POST with a good token streams, and the rate limit counts per user', async () => {
    const { keyhole } = setup();
    for (let i = 0; i < 2; i++) {
      const res = await keyhole(req('good-u1'));
      expect(res.status).toBe(200);
      await readEvents(res);
    }
    expect((await keyhole(req('good-u1'))).status).toBe(429);
    // Another user has their own allowance.
    const other = await keyhole(req('good-u2'));
    expect(other.status).toBe(200);
    await readEvents(other);
  });

  it('GET answers either way, but the default location only goes to a signed-in user', async () => {
    const { keyhole } = setup();
    const anon = (await (await keyhole(req(undefined, 'GET'))).json()) as KeyholeStatus;
    expect(anon.configured).toBe(true);
    expect(anon.defaultLocation).toBeUndefined();
    const signedIn = (await (await keyhole(req('good-u1', 'GET'))).json()) as KeyholeStatus;
    expect(signedIn.defaultLocation).toBe('Bend, OR');
  });

  it('createKeyholeFromEnv turns the gate on only when Supabase is configured', async () => {
    const sb = fakeSupabase();
    const env = { SLAPDASH_USAGE_FILE: '/dev/null/never-written' };
    const open = createKeyholeFromEnv(env);
    expect((await open(req())).status).toBe(503); // not_configured: no gate in front
    const gated = createKeyholeFromEnv({ ...env, SUPABASE_URL: SUPABASE, SUPABASE_PUBLISHABLE_KEY: 'k' }, { fetch: sb.fetch });
    expect((await gated(req())).status).toBe(401);
  });

  it('reads the Supabase settings from the server or the VITE_ names', () => {
    expect(readConfig({}).supabase).toBeUndefined();
    expect(readConfig({ SUPABASE_URL: `${SUPABASE}/`, SUPABASE_ANON_KEY: 'anon' }).supabase).toEqual({ url: SUPABASE, key: 'anon' });
    expect(readConfig({ VITE_SUPABASE_URL: SUPABASE, VITE_SUPABASE_PUBLISHABLE_KEY: 'pub' }).supabase).toEqual({ url: SUPABASE, key: 'pub' });
    expect(readConfig({ SUPABASE_URL: SUPABASE, SUPABASE_SECRET_KEY: 'secret' }).supabase).toBeUndefined();
  });
});
