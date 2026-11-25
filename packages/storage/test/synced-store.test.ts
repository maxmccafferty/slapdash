import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalBackend, LocalSyncJournal } from '../src/adapters/local/index.ts';
import { CLOUD_UNAVAILABLE_MESSAGE, StorageError } from '../src/errors.ts';
import { adoptProjects, CONFLICT_SUFFIX, createSyncedBackend, SyncedProjectStore, type SyncedBackend, type SyncStatus } from '../src/sync/index.ts';
import type { FileRef, NewFile, ProjectFiles, ProjectRecord, ProjectStore, ProjectSummary, StorageBackend, StoredFile } from '../src/types.ts';
import { allBytes, describeProjectStore, fixedClock, sampleRecord, sequentialIds } from '../testing/index.ts';

/** A remote that can be switched off: every call then fails like a paused project. */
class FlakyStore implements ProjectStore {
  down = false;
  readonly files: ProjectFiles;
  readonly inner: ProjectStore;
  constructor(inner: ProjectStore) {
    this.inner = inner;
    this.files = {
      put: (p: string, f: NewFile): Promise<FileRef> => this.#call(() => inner.files.put(p, f)),
      get: (p: string, id: string): Promise<StoredFile | null> => this.#call(() => inner.files.get(p, id)),
      list: (p: string): Promise<FileRef[]> => this.#call(() => inner.files.list(p)),
      delete: (p: string, id: string): Promise<void> => this.#call(() => inner.files.delete(p, id)),
    };
  }
  async #call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.down) throw new StorageError('unavailable', CLOUD_UNAVAILABLE_MESSAGE);
    return fn();
  }
  list(): Promise<ProjectSummary[]> {
    return this.#call(() => this.inner.list());
  }
  load(id: string): Promise<ProjectRecord | null> {
    return this.#call(() => this.inner.load(id));
  }
  save(r: ProjectRecord): Promise<ProjectSummary> {
    return this.#call(() => this.inner.save(r));
  }
  delete(id: string): Promise<void> {
    return this.#call(() => this.inner.delete(id));
  }
}

const quiet = () => {};

/** One shared "cloud" (a local store in its own IndexedDB) and any number of devices. */
function world() {
  const cloudFactory = new IDBFactory();
  const cloud = createLocalBackend({ indexedDB: cloudFactory, IDBKeyRange, dbName: 'cloud', now: fixedClock() });
  const opened: SyncedBackend[] = [];
  let n = 0;

  function device(name = `device-${++n}`) {
    const factory = new IDBFactory();
    const flaky = new FlakyStore(cloud.store);
    const open = () => {
      const local = createLocalBackend({ indexedDB: factory, IDBKeyRange, dbName: name, now: fixedClock() });
      const remote: StorageBackend = { store: flaky, auth: cloud.auth, device: cloud.device, close: () => {} };
      const backend = createSyncedBackend({
        local,
        remote,
        journal: new LocalSyncJournal(local.db),
        newId: sequentialIds(`${name}-copy`),
        retryDelaysMs: [60_000],
        warn: quiet,
      });
      opened.push(backend);
      return backend;
    };
    let backend = open();
    return {
      flaky,
      get backend() {
        return backend;
      },
      get store() {
        return backend.store;
      },
      async reopen() {
        await backend.sync.idle();
        backend.close();
        backend = open();
        return backend;
      },
    };
  }

  return {
    cloud,
    device,
    async close() {
      for (const b of opened) {
        await b.sync.idle();
        b.close();
      }
      cloud.close();
    },
  };
}

let w = world();
let d = w.device();

describeProjectStore('synced (local over a local "cloud")', {
  create: async () => {
    w = world();
    d = w.device();
    return d.store;
  },
  reopen: async () => (await d.reopen()).store,
  cleanup: () => w.close(),
});

describe('sync behaviour', () => {
  let current: ReturnType<typeof world>;
  afterEach(async () => {
    await current.close();
  });

  it('saving offline succeeds, lists locally, says why, and pushes after retry', async () => {
    current = world();
    const a = current.device();
    const seen: SyncStatus[] = [];
    a.backend.sync.onStatus((s) => seen.push(s));
    a.flaky.down = true;

    const rec = sampleRecord({ id: 'p1' });
    await expect(a.store.save(rec)).resolves.toMatchObject({ id: 'p1' });
    await a.backend.sync.idle();
    expect((await a.store.list()).map((s) => s.id)).toEqual(['p1']);
    expect(a.backend.sync.status).toEqual({ kind: 'offline', message: CLOUD_UNAVAILABLE_MESSAGE, pending: 1 });
    expect(seen.some((s) => s.kind === 'offline')).toBe(true);
    expect(await current.cloud.store.load('p1')).toBeNull();

    a.flaky.down = false;
    a.backend.sync.retry();
    await a.backend.sync.idle();
    expect(await current.cloud.store.load('p1')).toEqual(rec);
    expect(a.backend.sync.status).toEqual({ kind: 'synced' });
    const pending = await a.store.pending();
    expect([pending.saves, pending.deletes, pending.files, pending.fileDeletes]).toEqual([[], [], [], []]);
  });

  it('the push queue survives a reload', async () => {
    current = world();
    const a = current.device();
    a.flaky.down = true;
    const rec = sampleRecord({ id: 'p1' });
    await a.store.save(rec);
    await a.store.files.put('p1', { id: 'f1', name: 'photo.jpg', mimeType: 'image/jpeg', bytes: allBytes() });
    await a.backend.sync.idle();

    const reopened = await a.reopen();
    await reopened.sync.idle();
    expect((await reopened.store.pending()).saves).toEqual(['p1']);
    a.flaky.down = false;
    reopened.sync.retry();
    await reopened.sync.idle();
    expect(await current.cloud.store.load('p1')).toEqual(rec);
    expect(Array.from((await current.cloud.store.files.get('p1', 'f1'))!.bytes)).toEqual(Array.from(allBytes()));
  });

  it('a project made on device A opens on device B', async () => {
    current = world();
    const a = current.device('laptop');
    const b = current.device('phone');
    const rec = sampleRecord({ id: 'shed', name: 'Shed' });
    await a.store.save(rec);
    await a.store.files.put('shed', { id: 'thumb', name: 'card.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
    await a.backend.sync.idle();

    expect((await b.store.list()).map((s) => s.name)).toEqual(['Shed']);
    expect(await b.store.load('shed')).toEqual(rec);
    expect(Array.from((await b.store.files.get('shed', 'thumb'))!.bytes)).toEqual([1, 2, 3]);
    // Cached on the phone: it opens offline afterwards.
    b.flaky.down = true;
    expect(await b.store.load('shed')).toEqual(rec);
  });

  it('a project deleted on A disappears from B', async () => {
    current = world();
    const a = current.device();
    const b = current.device();
    await a.store.save(sampleRecord({ id: 'gone' }));
    await a.backend.sync.idle();
    await b.store.load('gone');
    expect((await b.store.list()).map((s) => s.id)).toEqual(['gone']);

    await a.store.delete('gone');
    await a.backend.sync.idle();
    expect(await b.store.list()).toEqual([]);
    expect(await b.store.load('gone')).toBeNull();
  });

  it('remote newer and local unchanged: load returns the remote copy and keeps it', async () => {
    current = world();
    const a = current.device();
    const b = current.device();
    const v1 = sampleRecord({ id: 'p', updatedAt: 1000 });
    await a.store.save(v1);
    await a.backend.sync.idle();
    expect(await b.store.load('p')).toEqual(v1);

    const v2: ProjectRecord = { ...v1, meta: { ...v1.meta, updatedAt: 2000 }, chat: { ...v1.chat, summary: 'edited on A' } };
    await a.store.save(v2);
    await a.backend.sync.idle();
    expect(await b.store.load('p')).toEqual(v2);
    b.flaky.down = true;
    expect(await b.store.load('p')).toEqual(v2);
    expect((await b.store.list())[0]!.updatedAt).toBe(2000);
  });

  it('both devices edit offline: the later push wins and the other edit is kept as a conflict copy', async () => {
    current = world();
    const a = current.device('a');
    const b = current.device('b');
    const v1 = sampleRecord({ id: 'p', name: 'Pool house', updatedAt: 1000 });
    await a.store.save(v1);
    await a.backend.sync.idle();
    await b.store.load('p');

    a.flaky.down = true;
    b.flaky.down = true;
    const onA: ProjectRecord = { ...v1, meta: { ...v1.meta, updatedAt: 2000 }, chat: { ...v1.chat, summary: 'A' } };
    const onB: ProjectRecord = { ...v1, meta: { ...v1.meta, updatedAt: 3000 }, chat: { ...v1.chat, summary: 'B' } };
    await a.store.save(onA);
    await b.store.save(onB);
    await a.backend.sync.idle();
    await b.backend.sync.idle();

    const conflicts: unknown[] = [];
    b.backend.sync.onConflict((c) => conflicts.push(c));
    a.flaky.down = false;
    a.backend.sync.retry();
    await a.backend.sync.idle();
    b.flaky.down = false;
    b.backend.sync.retry();
    await b.backend.sync.idle();

    const cloudList = await current.cloud.store.list();
    expect(cloudList.map((s) => s.name).sort()).toEqual(['Pool house', `Pool house${CONFLICT_SUFFIX}`]);
    expect((await current.cloud.store.load('p'))!.chat.summary).toBe('A');
    const copy = cloudList.find((s) => s.id !== 'p')!;
    expect((await current.cloud.store.load(copy.id))!.chat.summary).toBe('B');
    expect(conflicts).toEqual([{ id: 'p', copyId: copy.id, copyName: `Pool house${CONFLICT_SUFFIX}` }]);
    // B's own copy of "p" is now A's version.
    expect((await b.store.load('p'))!.chat.summary).toBe('A');
  });

  it("a remote that can't be reached for reads falls back to this device's copy", async () => {
    current = world();
    const a = current.device();
    await a.store.save(sampleRecord({ id: 'p' }));
    await a.backend.sync.idle();
    a.flaky.down = true;
    expect((await a.store.list()).map((s) => s.id)).toEqual(['p']);
    expect(await a.store.load('p')).not.toBeNull();
    expect(a.backend.sync.status.kind).toBe('offline');
  });

  it('a project only on this device that was never synced is sent, not dropped', async () => {
    current = world();
    const factory = new IDBFactory();
    const local = createLocalBackend({ indexedDB: factory, IDBKeyRange, dbName: 'x' });
    await local.store.save(sampleRecord({ id: 'old' }));
    const store = new SyncedProjectStore({ local: local.store, remote: current.cloud.store, journal: new LocalSyncJournal(local.db), warn: quiet });
    expect((await store.list()).map((s) => s.id)).toEqual(['old']);
    await store.idle();
    expect(await current.cloud.store.load('old')).not.toBeNull();
    store.close();
    local.close();
  });

  it('adoptProjects copies projects and their files into the synced store', async () => {
    current = world();
    const anon = createLocalBackend({ indexedDB: new IDBFactory(), IDBKeyRange, dbName: 'slapdash' });
    await anon.store.save(sampleRecord({ id: 'mine' }));
    await anon.store.files.put('mine', { id: 'f', name: 'x.png', mimeType: 'image/png', bytes: new Uint8Array([9]) });
    const a = current.device();
    expect(await adoptProjects(anon.store, a.store)).toBe(1);
    await a.backend.sync.idle();
    expect(await current.cloud.store.load('mine')).toEqual(sampleRecord({ id: 'mine' }));
    expect((await current.cloud.store.files.get('mine', 'f'))!.bytes).toEqual(new Uint8Array([9]));
    anon.close();
  });
});
