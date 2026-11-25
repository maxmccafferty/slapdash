import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import type { Auth, AuthResult, StorageBackend, User } from '@slapdash/storage';
import { createLocalBackend } from '@slapdash/storage/local';
import { sampleRecord } from '@slapdash/storage/testing';
import { describe, expect, it, vi } from 'vitest';
import { openBackend, readBackendConfig, userDbName } from '../../src/storage/backend.ts';

const OWNER: User = { id: 'owner-1', displayName: 'max@example.com', email: 'max@example.com' };

/** A stand-in for the Supabase adapter: a local "cloud" store with an auth that needs sign-in. */
function fakeSupabase(opts: { signedIn?: boolean } = {}) {
  let user: User | null = opts.signedIn ? OWNER : null;
  const cloud = createLocalBackend({ indexedDB: new IDBFactory(), IDBKeyRange, dbName: 'cloud' });
  const auth: Auth = {
    requiresSignIn: true,
    currentUser: async () => user,
    signIn: async (): Promise<AuthResult> => {
      user = OWNER;
      return { ok: true, user: OWNER };
    },
    signOut: async () => {
      user = null;
    },
    onChange: () => () => {},
    accessToken: async () => (user ? 'token-123' : null),
  };
  const created: unknown[] = [];
  const remote: StorageBackend = { store: cloud.store, auth, device: cloud.device, close: () => {} };
  const mod = {
    createSupabaseBackend: (o: unknown) => {
      created.push(o);
      return remote;
    },
  };
  return { cloud, auth, created, loadSupabase: async () => mod as never };
}


describe('readBackendConfig', () => {
  it('is local without both Supabase settings', () => {
    expect(readBackendConfig({})).toEqual({ kind: 'local' });
    expect(readBackendConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toEqual({ kind: 'local' });
    expect(readBackendConfig({ VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' })).toEqual({ kind: 'local' });
  });

  it('is Supabase with both', () => {
    expect(readBackendConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co/', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_1' })).toEqual({
      kind: 'supabase',
      url: 'https://x.supabase.co',
      key: 'sb_publishable_1',
    });
  });

  it('this test build has no Supabase settings', () => {
    expect(readBackendConfig().kind).toBe('local');
  });
});

describe('openBackend', () => {
  it('local: no sign-in card, no Supabase chunk, no sync and no token', async () => {
    const showSignIn = vi.fn();
    const loadSupabase = vi.fn();
    const backend = await openBackend({ config: { kind: 'local' }, showSignIn, loadSupabase });

    expect(backend.kind).toBe('local');
    expect(backend.auth.requiresSignIn).toBe(false);
    expect(backend.sync).toBeNull();
    expect(backend.user).toBeNull();
    expect(await backend.accessToken()).toBeNull();
    expect(showSignIn).not.toHaveBeenCalled();
    expect(loadSupabase).not.toHaveBeenCalled();
    backend.close();
  });

  it('Supabase, signed out: the card shows until someone signs in, then a synced per-user store opens', async () => {
    const factory = new IDBFactory();
    const fake = fakeSupabase();
    const showSignIn = vi.fn(async (auth: Auth) => {
      const res = await auth.signIn({ kind: 'password', email: 'max@example.com', password: 'x' });
      if (!res.ok) throw new Error(res.error);
      return res.user;
    });
    const backend = await openBackend({
      config: { kind: 'supabase', url: 'https://x.supabase.co', key: 'pub' },
      showSignIn,
      loadSupabase: fake.loadSupabase,
      localOptions: { indexedDB: factory, IDBKeyRange },
      sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    expect(showSignIn).toHaveBeenCalledTimes(1);
    expect(fake.created).toEqual([{ url: 'https://x.supabase.co', key: 'pub', storage: expect.any(Object) }]);
    expect(backend.kind).toBe('synced');
    expect(backend.user).toEqual(OWNER);
    expect(backend.sync?.status.kind).toBeDefined();
    expect(await backend.accessToken()).toBe('token-123');

    // Saving lands in the per-user database and goes up to the cloud.
    await backend.store.save(sampleRecord({ id: 'p1' }));
    await backend.sync!.idle();
    expect(await fake.cloud.store.load('p1')).not.toBeNull();
    const own = createLocalBackend({ indexedDB: factory, IDBKeyRange, dbName: userDbName(OWNER.id) });
    expect((await own.store.list()).map((s) => s.id)).toEqual(['p1']);
    own.close();
    backend.close();
  });

  it('Supabase, already signed in: no card; projects made before sign-in move into the account once', async () => {
    const factory = new IDBFactory();
    const anonymous = createLocalBackend({ indexedDB: factory, IDBKeyRange });
    await anonymous.store.save(sampleRecord({ id: 'before' }));
    anonymous.close();

    const fake = fakeSupabase({ signedIn: true });
    const deps = {
      config: { kind: 'supabase' as const, url: 'https://x.supabase.co', key: 'pub' },
      showSignIn: vi.fn(),
      loadSupabase: fake.loadSupabase,
      localOptions: { indexedDB: factory, IDBKeyRange },
      sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    };
    const first = await openBackend(deps);
    expect(deps.showSignIn).not.toHaveBeenCalled();
    expect(first.adopted).toBe(1);
    expect((await first.store.list()).map((s) => s.id)).toEqual(['before']);
    await first.sync!.idle();
    expect(await fake.cloud.store.load('before')).not.toBeNull();
    first.close();

    const second = await openBackend(deps);
    expect(second.adopted).toBe(0);
    second.close();
  });
});
