import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createLocalBackend, LOCAL_USER } from '../src/adapters/local/index.ts';
import { StorageError } from '../src/errors.ts';
import { describeAuth, describeDeviceState, describeProjectStore, fixedClock, sampleRecord } from '../testing/index.ts';

/** Each test gets its own in-memory IndexedDB; `reopen` opens a new backend on the same one. */
function localHarness() {
  let factory = new IDBFactory();
  let backend = createLocalBackend({ indexedDB: factory, IDBKeyRange, now: fixedClock() });
  return {
    fresh() {
      factory = new IDBFactory();
      backend = createLocalBackend({ indexedDB: factory, IDBKeyRange, now: fixedClock() });
      return backend;
    },
    reopen() {
      backend.close();
      backend = createLocalBackend({ indexedDB: factory, IDBKeyRange, now: fixedClock() });
      return backend;
    },
    async cleanup() {
      backend.close();
    },
  };
}

const h = localHarness();

describeProjectStore('local (IndexedDB)', {
  create: async () => h.fresh().store,
  reopen: async () => h.reopen().store,
  cleanup: h.cleanup,
});

describeAuth('local', {
  create: async () => h.fresh().auth,
  cleanup: h.cleanup,
});

describeDeviceState('local (IndexedDB)', {
  create: async () => h.fresh().device,
  reopen: async () => h.reopen().device,
  cleanup: h.cleanup,
});

describe('local adapter specifics', () => {
  it('needs no sign-in and its user is "This device"', async () => {
    const { auth, close } = h.fresh();
    expect(auth.requiresSignIn).toBe(false);
    expect(await auth.currentUser()).toEqual(LOCAL_USER);
    expect(await auth.signIn({ kind: 'passkey' })).toEqual({ ok: true, user: LOCAL_USER });
    close();
  });

  it('damaged stored data gives a plain StorageError on load, not a crash', async () => {
    const backend = h.fresh();
    const rec = sampleRecord();
    await backend.store.save(rec);
    await backend.db.bodies.update(rec.id, { project: { ...rec.project, schemaVersion: 'nope' } as never });
    const err = await backend.store.load(rec.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).code).toBe('invalid');
    expect((err as StorageError).message).toMatch(/^The saved project "Pool house" couldn't be opened because its data is damaged\./);
    backend.close();
  });

  it('uses separate databases for separate names', async () => {
    const factory = new IDBFactory();
    const a = createLocalBackend({ indexedDB: factory, IDBKeyRange, dbName: 'a' });
    const b = createLocalBackend({ indexedDB: factory, IDBKeyRange, dbName: 'b' });
    await a.store.save(sampleRecord());
    expect(await b.store.list()).toEqual([]);
    a.close();
    b.close();
  });
});
