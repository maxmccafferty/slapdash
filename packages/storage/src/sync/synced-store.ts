/**
 * A ProjectStore that keeps everything on the device and mirrors it to a remote store
 * (ADR-0001 §10). No backend SDK here: `local` and `remote` are any two ProjectStores.
 *
 * - Writes go to `local` first and return as soon as that's done; a push queue (the
 *   journal) then sends them to `remote`. Offline or with the remote paused, the app keeps
 *   working and the queue retries with backoff.
 * - Reads merge both: the newer `meta.updatedAt` wins. A project only the remote has is
 *   listed and fetched on `load`.
 * - Conflicts (both sides changed since the last sync) are last-writer-wins on the remote,
 *   but the losing local edit is kept as a new project "<name> (conflict, this device)", so
 *   no work is dropped.
 */
import { CLOUD_UNAVAILABLE_MESSAGE, StorageError, describeError } from '../errors.ts';
import { newId as defaultNewId } from '../ids.ts';
import type { FileRef, NewFile, ProjectFiles, ProjectRecord, ProjectStore, ProjectSummary, StoredFile } from '../types.ts';
import { pendingCount, type Pending, type PendingFile, type SyncJournal } from './journal.ts';

export type SyncStatus =
  | { kind: 'synced' }
  | { kind: 'syncing'; pending: number }
  | { kind: 'offline'; message: string; pending: number };

/** A conflict the push loop resolved: `id` now holds the other device's version, `copyId` ours. */
export interface SyncConflict {
  id: string;
  copyId: string;
  copyName: string;
}

export interface SyncedStoreOptions {
  local: ProjectStore;
  remote: ProjectStore;
  journal: SyncJournal;
  /** How long a read waits for the remote before using the local copy. Default 5000 ms. */
  remoteTimeoutMs?: number;
  /** Retry delays after a failed push, in ms; the last repeats. Default 5 s doubling to 5 min. */
  retryDelaysMs?: readonly number[];
  newId?: () => string;
  /** Problems that aren't about reachability (a record the remote refused). Default console.warn. */
  warn?: (message: string) => void;
}

export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000];

export const CONFLICT_SUFFIX = ' (conflict, this device)';

const fileKey = (f: PendingFile) => `${f.projectId}\u0000${f.fileId}`;
const sameFile = (a: PendingFile) => (b: PendingFile) => a.projectId === b.projectId && a.fileId === b.fileId;

function addUnique<T>(list: T[], item: T, same: (a: T) => (b: T) => boolean = (a) => (b) => a === b): void {
  if (!list.some(same(item))) list.push(item);
}

function isUnavailable(e: unknown): boolean {
  return !(e instanceof StorageError) || e.code === 'unavailable' || e.code === 'not_found';
}

function byCreated(a: FileRef, b: FileRef): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function byNewest(a: ProjectSummary, b: ProjectSummary): number {
  return b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

type Item =
  | { kind: 'delete'; id: string }
  | { kind: 'save'; id: string }
  | { kind: 'file'; file: PendingFile }
  | { kind: 'fileDelete'; file: PendingFile };

function itemKey(item: Item): string {
  switch (item.kind) {
    case 'delete':
    case 'save':
      return `${item.kind}:${item.id}`;
    default:
      return `${item.kind}:${fileKey(item.file)}`;
  }
}

/** Deletes first, then saves, then files: a file can be stored before its project. */
function nextItem(p: Pending, skip: ReadonlySet<string>): Item | null {
  const items: Item[] = [
    ...p.deletes.map((id): Item => ({ kind: 'delete', id })),
    ...p.saves.map((id): Item => ({ kind: 'save', id })),
    ...p.files.map((file): Item => ({ kind: 'file', file })),
    ...p.fileDeletes.map((file): Item => ({ kind: 'fileDelete', file })),
  ];
  return items.find((i) => !skip.has(itemKey(i))) ?? null;
}

function removeItem(p: Pending, item: Item): void {
  switch (item.kind) {
    case 'delete':
      p.deletes = p.deletes.filter((id) => id !== item.id);
      break;
    case 'save':
      p.saves = p.saves.filter((id) => id !== item.id);
      break;
    case 'file':
      p.files = p.files.filter((f) => !sameFile(item.file)(f));
      break;
    case 'fileDelete':
      p.fileDeletes = p.fileDeletes.filter((f) => !sameFile(item.file)(f));
      break;
  }
}

export class SyncedProjectStore implements ProjectStore {
  readonly files: ProjectFiles;
  readonly #local: ProjectStore;
  readonly #remote: ProjectStore;
  readonly #journal: SyncJournal;
  readonly #timeoutMs: number;
  readonly #delays: readonly number[];
  readonly #newId: () => string;
  readonly #warn: (message: string) => void;

  #pending: Pending | null = null;
  /** Journal changes run one at a time, so none is lost. */
  #lock: Promise<unknown> = Promise.resolve();
  /** Items changed while the push loop was sending them: they stay queued. */
  readonly #touched = new Set<string>();
  #pushing: Promise<void> | null = null;
  #again = false;
  #attempt = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #closed = false;
  #status: SyncStatus = { kind: 'synced' };
  readonly #statusListeners = new Set<(s: SyncStatus) => void>();
  readonly #conflictListeners = new Set<(c: SyncConflict) => void>();

  constructor(opts: SyncedStoreOptions) {
    this.#local = opts.local;
    this.#remote = opts.remote;
    this.#journal = opts.journal;
    this.#timeoutMs = opts.remoteTimeoutMs ?? 5000;
    this.#delays = opts.retryDelaysMs?.length ? opts.retryDelaysMs : DEFAULT_RETRY_DELAYS_MS;
    this.#newId = opts.newId ?? defaultNewId;
    this.#warn = opts.warn ?? ((m) => console.warn(`[sync] ${m}`));
    this.files = new SyncedFiles(this);
    // Anything left from an earlier visit goes out now.
    this.kick();
  }

  // ---- status ----

  get status(): SyncStatus {
    return this.#status;
  }

  onStatus(fn: (s: SyncStatus) => void): () => void {
    this.#statusListeners.add(fn);
    return () => this.#statusListeners.delete(fn);
  }

  onConflict(fn: (c: SyncConflict) => void): () => void {
    this.#conflictListeners.add(fn);
    return () => this.#conflictListeners.delete(fn);
  }

  #setStatus(next: SyncStatus): void {
    const cur = this.#status;
    if (
      cur.kind === next.kind &&
      (cur.kind === 'synced' ||
        (cur.kind === 'syncing' && cur.pending === (next as { pending: number }).pending) ||
        (cur.kind === 'offline' && cur.pending === (next as { pending: number }).pending && cur.message === (next as { message: string }).message))
    ) {
      return;
    }
    this.#status = next;
    for (const fn of this.#statusListeners) fn(next);
  }

  async #markOffline(e: unknown): Promise<void> {
    const message = e instanceof StorageError ? e.message : CLOUD_UNAVAILABLE_MESSAGE;
    const p = await this.#read();
    this.#setStatus({ kind: 'offline', message, pending: pendingCount(p) });
  }

  // ---- journal ----

  async #read(): Promise<Pending> {
    if (!this.#pending) {
      const loaded = await this.#journal.read();
      this.#pending ??= loaded;
    }
    return this.#pending;
  }

  /** Change the journal and write it back. Serialized. */
  #mutate(fn: (p: Pending) => void): Promise<void> {
    const run = this.#lock.then(async () => {
      const p = await this.#read();
      fn(p);
      await this.#journal.write(p);
    });
    this.#lock = run.catch(() => undefined);
    return run;
  }

  /** The journal as it stands (a copy), for the app and tests. */
  async pending(): Promise<Pending> {
    await this.#lock;
    return structuredClone(await this.#read());
  }

  #withTimeout<T>(p: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new StorageError('unavailable', CLOUD_UNAVAILABLE_MESSAGE)), this.#timeoutMs);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  }

  // ---- ProjectStore ----

  async list(): Promise<ProjectSummary[]> {
    const localList = await this.#local.list();
    let remoteList: ProjectSummary[];
    try {
      remoteList = await this.#withTimeout(this.#remote.list());
    } catch (e) {
      await this.#markOffline(e);
      return localList;
    }
    const p = await this.pending();
    const merged = new Map<string, ProjectSummary>();
    const localById = new Map(localList.map((s) => [s.id, s]));
    for (const r of remoteList) {
      if (p.deletes.includes(r.id)) continue;
      const l = localById.get(r.id);
      merged.set(r.id, l && l.updatedAt >= r.updatedAt ? l : r);
    }
    const requeue: string[] = [];
    for (const l of localList) {
      if (merged.has(l.id)) continue;
      if (p.saves.includes(l.id)) {
        merged.set(l.id, l);
      } else if (p.baseline[l.id] !== undefined) {
        // It was on the remote and isn't any more: deleted on another device.
        await this.#local.delete(l.id).catch(() => undefined);
        await this.#mutate((j) => {
          delete j.baseline[l.id];
          j.files = j.files.filter((f) => f.projectId !== l.id);
        });
      } else {
        // Never synced (made before sign-in, or the journal was lost): send it, never drop it.
        merged.set(l.id, l);
        requeue.push(l.id);
      }
    }
    if (requeue.length > 0) {
      await this.#mutate((j) => requeue.forEach((id) => addUnique(j.saves, id)));
    }
    if (this.#status.kind === 'offline' || requeue.length > 0) this.kick();
    return [...merged.values()].sort(byNewest);
  }

  async load(id: string): Promise<ProjectRecord | null> {
    const p = await this.pending();
    if (p.deletes.includes(id)) return null;
    const [l, r] = await Promise.allSettled([this.#local.load(id), this.#withTimeout(this.#remote.load(id))]);
    const remote = r.status === 'fulfilled' ? r.value : undefined;
    if (r.status === 'rejected') {
      if (isUnavailable(r.reason)) await this.#markOffline(r.reason);
      else this.#warn(`The cloud copy of ${id} couldn't be read: ${describeError(r.reason)}`);
    }
    const local = l.status === 'fulfilled' ? l.value : null;
    const pendingSave = p.saves.includes(id);

    if (remote && (!local || (remote.meta.updatedAt > local.meta.updatedAt && !pendingSave))) {
      // Newer elsewhere (or damaged here): keep the remote copy on this device.
      await this.#local.save(remote);
      await this.#mutate((j) => {
        j.baseline[id] = remote.meta.updatedAt;
      });
      return remote;
    }
    if (l.status === 'rejected') throw l.reason;
    if (!local && r.status === 'rejected' && !isUnavailable(r.reason)) throw r.reason;
    return local;
  }

  async save(record: ProjectRecord): Promise<ProjectSummary> {
    const summary = await this.#local.save(record);
    this.#touched.add(`save:${record.id}`);
    await this.#mutate((p) => {
      addUnique(p.saves, record.id);
      p.deletes = p.deletes.filter((id) => id !== record.id);
    });
    this.kick();
    return summary;
  }

  async delete(id: string): Promise<void> {
    await this.#local.delete(id);
    this.#touched.add(`save:${id}`);
    await this.#mutate((p) => {
      p.saves = p.saves.filter((s) => s !== id);
      p.files = p.files.filter((f) => f.projectId !== id);
      p.fileDeletes = p.fileDeletes.filter((f) => f.projectId !== id);
      addUnique(p.deletes, id);
      delete p.baseline[id];
    });
    this.kick();
  }

  // ---- files (called by SyncedFiles) ----

  async putFile(projectId: string, file: NewFile): Promise<FileRef> {
    const ref = await this.#local.files.put(projectId, file);
    const pf = { projectId, fileId: ref.id };
    this.#touched.add(`file:${fileKey(pf)}`);
    await this.#mutate((p) => {
      addUnique(p.files, pf, sameFile);
      p.fileDeletes = p.fileDeletes.filter((f) => !sameFile(pf)(f));
    });
    this.kick();
    return ref;
  }

  async getFile(projectId: string, fileId: string): Promise<StoredFile | null> {
    const local = await this.#local.files.get(projectId, fileId);
    if (local) return local;
    const p = await this.pending();
    if (p.deletes.includes(projectId) || p.fileDeletes.some(sameFile({ projectId, fileId }))) return null;
    let remote: StoredFile | null;
    try {
      remote = await this.#withTimeout(this.#remote.files.get(projectId, fileId));
    } catch (e) {
      if (isUnavailable(e)) await this.#markOffline(e);
      return null;
    }
    if (!remote) return null;
    // Keep a copy here (not journalled: the remote already has it).
    await this.#local.files
      .put(projectId, { id: remote.id, createdAt: remote.createdAt, name: remote.name, mimeType: remote.mimeType, bytes: remote.bytes })
      .catch(() => undefined);
    return remote;
  }

  async listFiles(projectId: string): Promise<FileRef[]> {
    const local = await this.#local.files.list(projectId);
    const p = await this.pending();
    if (p.deletes.includes(projectId)) return local;
    let remote: FileRef[] = [];
    try {
      remote = await this.#withTimeout(this.#remote.files.list(projectId));
    } catch (e) {
      if (isUnavailable(e)) await this.#markOffline(e);
    }
    const byId = new Map(local.map((f) => [f.id, f]));
    for (const f of remote) {
      if (!byId.has(f.id) && !p.fileDeletes.some(sameFile({ projectId, fileId: f.id }))) byId.set(f.id, f);
    }
    return [...byId.values()].sort(byCreated);
  }

  async deleteFile(projectId: string, fileId: string): Promise<void> {
    await this.#local.files.delete(projectId, fileId);
    const pf = { projectId, fileId };
    this.#touched.add(`file:${fileKey(pf)}`);
    await this.#mutate((p) => {
      p.files = p.files.filter((f) => !sameFile(pf)(f));
      addUnique(p.fileDeletes, pf, sameFile);
    });
    this.kick();
  }

  // ---- push loop ----

  /** Start (or re-run) the push loop. Returns at once. */
  kick(): void {
    if (this.#closed) return;
    if (this.#pushing) {
      this.#again = true;
      return;
    }
    this.#pushing = this.#push().finally(() => {
      this.#pushing = null;
      if (this.#again && !this.#closed) {
        this.#again = false;
        this.kick();
      }
    });
  }

  /** Try now (the app calls this when it comes online or back to the foreground). */
  retry(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.kick();
  }

  /** Resolves when the push loop is idle (tests, sign-out). */
  async idle(): Promise<void> {
    while (this.#pushing) await this.#pushing;
  }

  close(): void {
    this.#closed = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #scheduleRetry(): void {
    if (this.#closed) return;
    const delay = this.#delays[Math.min(this.#attempt, this.#delays.length - 1)]!;
    this.#attempt++;
    if (this.#timer) clearTimeout(this.#timer);
    const timer = setTimeout(() => {
      this.#timer = null;
      this.kick();
    }, delay);
    (timer as { unref?: () => void }).unref?.();
    this.#timer = timer;
  }

  async #push(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    /** Items dropped or deferred in this run. */
    const skip = new Set<string>();
    while (!this.#closed) {
      await this.#lock;
      const p = await this.#read();
      const count = pendingCount(p);
      const item = nextItem(p, skip);
      if (!item) {
        this.#attempt = 0;
        this.#setStatus(count === 0 ? { kind: 'synced' } : { kind: 'syncing', pending: count });
        return;
      }
      this.#setStatus({ kind: 'syncing', pending: count });
      const key = itemKey(item);
      this.#touched.delete(key);
      try {
        await this.#send(item, p);
      } catch (e) {
        if (isUnavailable(e)) {
          await this.#markOffline(e);
          this.#scheduleRetry();
          return;
        }
        // The remote refused this item for good (invalid, too large): don't let it block the queue.
        this.#warn(`Couldn't sync ${key}: ${describeError(e)}`);
        skip.add(key);
      }
      if (!this.#touched.has(key)) await this.#mutate((j) => removeItem(j, item));
      else skip.add(key);
    }
  }

  async #send(item: Item, p: Pending): Promise<void> {
    switch (item.kind) {
      case 'delete':
        await this.#remote.delete(item.id);
        await this.#mutate((j) => {
          delete j.baseline[item.id];
        });
        return;
      case 'file': {
        const f = await this.#local.files.get(item.file.projectId, item.file.fileId);
        if (!f) return;
        await this.#remote.files.put(f.projectId, { id: f.id, createdAt: f.createdAt, name: f.name, mimeType: f.mimeType, bytes: f.bytes });
        return;
      }
      case 'fileDelete':
        await this.#remote.files.delete(item.file.projectId, item.file.fileId);
        return;
      case 'save':
        await this.#sendSave(item.id, p.baseline[item.id]);
        return;
    }
  }

  async #sendSave(id: string, baseline: number | undefined): Promise<void> {
    let local: ProjectRecord | null;
    try {
      local = await this.#local.load(id);
    } catch (e) {
      // Damaged here: nothing good to send.
      this.#warn(`Couldn't read ${id} on this device to sync it: ${describeError(e)}`);
      return;
    }
    if (!local) return;
    let remote: ProjectRecord | null;
    try {
      remote = await this.#remote.load(id);
    } catch (e) {
      if (isUnavailable(e)) throw e;
      remote = null; // damaged remotely: ours replaces it
    }
    const remoteAt = remote?.meta.updatedAt;
    if (remote && remoteAt === local.meta.updatedAt) {
      await this.#mutate((j) => {
        j.baseline[id] = local.meta.updatedAt;
      });
      return;
    }
    if (remote && remoteAt !== undefined && remoteAt > (baseline ?? Number.NEGATIVE_INFINITY)) {
      await this.#keepConflictCopy(local, remote);
      return;
    }
    await this.#remote.save(local);
    await this.#mutate((j) => {
      j.baseline[id] = local.meta.updatedAt;
    });
  }

  /** Both sides changed: the remote version wins `id`, ours becomes a new project. */
  async #keepConflictCopy(local: ProjectRecord, remote: ProjectRecord): Promise<void> {
    const copyId = this.#newId();
    const copyName = `${local.meta.name}${CONFLICT_SUFFIX}`;
    const copy: ProjectRecord = {
      ...local,
      id: copyId,
      meta: { ...local.meta, name: copyName, named: true },
      project: { ...local.project, name: copyName },
    };
    await this.#local.save(copy);
    const files = await this.#local.files.list(local.id);
    for (const ref of files) {
      const f = await this.#local.files.get(local.id, ref.id);
      if (f) await this.#local.files.put(copyId, { id: f.id, createdAt: f.createdAt, name: f.name, mimeType: f.mimeType, bytes: f.bytes });
    }
    await this.#local.save(remote);
    await this.#mutate((j) => {
      addUnique(j.saves, copyId);
      for (const ref of files) addUnique(j.files, { projectId: copyId, fileId: ref.id }, sameFile);
      j.baseline[local.id] = remote.meta.updatedAt;
    });
    const conflict = { id: local.id, copyId, copyName };
    for (const fn of this.#conflictListeners) fn(conflict);
  }
}

class SyncedFiles implements ProjectFiles {
  readonly #store: SyncedProjectStore;
  constructor(store: SyncedProjectStore) {
    this.#store = store;
  }
  put(projectId: string, file: NewFile): Promise<FileRef> {
    return this.#store.putFile(projectId, file);
  }
  get(projectId: string, fileId: string): Promise<StoredFile | null> {
    return this.#store.getFile(projectId, fileId);
  }
  list(projectId: string): Promise<FileRef[]> {
    return this.#store.listFiles(projectId);
  }
  delete(projectId: string, fileId: string): Promise<void> {
    return this.#store.deleteFile(projectId, fileId);
  }
}
