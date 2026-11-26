/**
 * The shared adapter suites against a real Supabase (Postgres, Storage, Auth), plus RLS
 * isolation checks. Needs SUPABASE_TEST_URL, SUPABASE_TEST_PUBLISHABLE_KEY and
 * SUPABASE_TEST_SECRET_KEY; `pnpm test:supabase` starts a local stack and sets them.
 * Without them the file is skipped.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { createSupabaseBackend, FILES_BUCKET, memorySessionStorage, objectPath, type SupabaseBackend } from '../src/adapters/supabase/index.ts';
import { SIGN_IN_MESSAGES } from '../src/adapters/supabase/auth.ts';
import { describeAuth, describeDeviceState, describeProjectStore, fixedClock, sampleRecord } from '../testing/index.ts';

const URL_ = process.env.SUPABASE_TEST_URL;
const KEY = process.env.SUPABASE_TEST_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_TEST_SECRET_KEY;
const enabled = Boolean(URL_ && KEY && SECRET);

if (!enabled) {
  describe.skip('Supabase adapter (set SUPABASE_TEST_URL, SUPABASE_TEST_PUBLISHABLE_KEY and SUPABASE_TEST_SECRET_KEY, or run `pnpm test:supabase`)', () => {
    it('is skipped', () => {});
  });
} else {
  const url = URL_!;
  const key = KEY!;
  const admin: SupabaseClient = createClient(url, SECRET!, { auth: { persistSession: false, autoRefreshToken: false } });
  const PASSWORD = 'correct horse battery staple';
  const users: string[] = [];

  async function newUser(): Promise<{ id: string; email: string }> {
    const email = `test-${crypto.randomUUID()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    users.push(data.user.id);
    return { id: data.user.id, email };
  }

  async function removeUser(id: string): Promise<void> {
    const { data } = await admin.storage.from(FILES_BUCKET).list(id, { limit: 1000 });
    for (const folder of data ?? []) {
      const { data: files } = await admin.storage.from(FILES_BUCKET).list(`${id}/${folder.name}`, { limit: 1000 });
      const paths = (files ?? []).map((f) => `${id}/${folder.name}/${f.name}`);
      if (paths.length) await admin.storage.from(FILES_BUCKET).remove(paths);
    }
    await admin.auth.admin.deleteUser(id);
  }

  async function signedIn(email: string): Promise<SupabaseBackend> {
    const backend = createSupabaseBackend({ url, key, storage: memorySessionStorage(), now: fixedClock() });
    const res = await backend.auth.signIn({ kind: 'password', email, password: PASSWORD });
    if (!res.ok) throw new Error(`sign-in failed: ${res.error}`);
    return backend;
  }

  /** A fresh user per test; `reopen` signs in again as the same user with a new client. */
  function harness() {
    let user: { id: string; email: string } | null = null;
    let backend: SupabaseBackend | null = null;
    return {
      async fresh() {
        user = await newUser();
        backend = await signedIn(user.email);
        return backend;
      },
      async reopen() {
        backend?.close();
        backend = await signedIn(user!.email);
        return backend;
      },
      async cleanup() {
        backend?.close();
        if (user) await removeUser(user.id);
        user = null;
        backend = null;
      },
    };
  }

  afterAll(async () => {
    for (const id of users) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  });

  const h = harness();
  describeProjectStore('supabase', {
    create: async () => (await h.fresh()).store,
    reopen: async () => (await h.reopen()).store,
    cleanup: () => h.cleanup(),
  });

  let authEmail = '';
  describeAuth('supabase', {
    create: async () => {
      const user = await newUser();
      authEmail = user.email;
      return createSupabaseBackend({ url, key, storage: memorySessionStorage() }).auth;
    },
    get validCredentials() {
      return { kind: 'password' as const, email: authEmail, password: PASSWORD };
    },
  });

  describeDeviceState('supabase (in-memory device)', {
    create: async () => createSupabaseBackend({ url, key, storage: memorySessionStorage() }).device,
  });

  describe('Supabase row-level security', () => {
    it("one user can't see or read another user's projects and files", async () => {
      const a = await newUser();
      const b = await newUser();
      const ba = await signedIn(a.email);
      const bb = await signedIn(b.email);
      const rec = sampleRecord({ id: 'shared-id' });
      await ba.store.save(rec);
      const file = await ba.store.files.put(rec.id, { name: 'p.jpg', mimeType: 'image/jpeg', bytes: new Uint8Array([1, 2]) });

      expect(await bb.store.list()).toEqual([]);
      expect(await bb.store.load(rec.id)).toBeNull();
      expect(await bb.store.files.get(rec.id, file.id)).toBeNull();
      const direct = await bb.client.storage.from(FILES_BUCKET).download(objectPath(a.id, rec.id, file.id));
      expect(direct.error).not.toBeNull();

      // The same project id for B is B's own project.
      await bb.store.save(sampleRecord({ id: 'shared-id', name: 'Bravo' }));
      expect((await ba.store.load(rec.id))!.meta.name).toBe('Pool house');
      ba.close();
      bb.close();
      await removeUser(a.id);
      await removeUser(b.id);
    });

    it('a signed-out client can read nothing', async () => {
      const a = await newUser();
      const ba = await signedIn(a.email);
      await ba.store.save(sampleRecord());
      const anon = createClient(url, key, { auth: { persistSession: false } });
      const { data } = await anon.from('projects').select('id');
      expect(data ?? []).toEqual([]);
      ba.close();
      await removeUser(a.id);
    });

    it('a wrong password gives a plain message', async () => {
      const a = await newUser();
      const backend = createSupabaseBackend({ url, key, storage: memorySessionStorage() });
      expect(await backend.auth.signIn({ kind: 'password', email: a.email, password: 'nope' })).toEqual({
        ok: false,
        error: SIGN_IN_MESSAGES.invalidCredentials,
      });
      await removeUser(a.id);
    });

    it('signs in, keeps the session, gives an access token and signs out', async () => {
      const a = await newUser();
      const backend = await signedIn(a.email);
      expect((await backend.auth.currentUser())?.email).toBe(a.email);
      expect(await backend.auth.accessToken()).toMatch(/\./);
      await backend.auth.signOut();
      expect(await backend.auth.currentUser()).toBeNull();
      await removeUser(a.id);
    });
  });
}
