/**
 * The local-only adapter (ADR-0001 §10): IndexedDB via Dexie, no sign-in. The default.
 */
import { StorageError } from '../../errors.ts';
import { newId as defaultNewId } from '../../ids.ts';
import { summarize, validateRecord } from '../../record.ts';
import type {
  Auth,
  AuthResult,
  DeviceState,
  FileRef,
  NewFile,
  ProjectFiles,
  ProjectRecord,
  ProjectStore,
  ProjectSummary,
  StorageBackend,
  StoredFile,
  User,
} from '../../types.ts';
import { DEFAULT_DB_NAME, SlapdashDB, type IndexedDBDeps } from './db.ts';

export { SlapdashDB, DEFAULT_DB_NAME } from './db.ts';

export interface LocalBackendOptions extends IndexedDBDeps {
  /** IndexedDB database name. Default "slapdash". */
  dbName?: string;
  /** Clock for file timestamps. Default Date.now. */
  now?: () => number;
  /** Id generator for files. Default crypto.randomUUID. */
  newId?: () => string;
}

function toRef(row: StoredFile): FileRef {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    createdAt: row.createdAt,
  };
}

function unavailable(e: unknown): StorageError {
  if (e instanceof StorageError) return e;
  const detail = e instanceof Error ? e.message : String(e);
  return new StorageError('unavailable', `This browser's storage isn't available right now (${detail}).`);
}

/** Run a Dexie call, turning low-level failures into a StorageError. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error && e.name === 'QuotaExceededError') {
      throw new StorageError('too_large', "This device is out of storage space for projects. Delete an old project or export one to a file to free some.");
    }
    throw unavailable(e);
  }
}

class LocalFiles implements ProjectFiles {
  readonly #db: SlapdashDB;
  readonly #now: () => number;
  readonly #newId: () => string;

  constructor(db: SlapdashDB, now: () => number, newId: () => string) {
    this.#db = db;
    this.#now = now;
    this.#newId = newId;
  }

  put(projectId: string, file: NewFile): Promise<FileRef> {
    return guard(async () => {
      const row: StoredFile = {
        projectId,
        id: file.id ?? this.#newId(),
        name: file.name,
        mimeType: file.mimeType,
        size: file.bytes.byteLength,
        createdAt: file.createdAt ?? this.#now(),
        // A copy: later changes to the caller's array don't reach the stored file.
        bytes: file.bytes.slice(),
      };
      await this.#db.files.put(row);
      return toRef(row);
    });
  }

  get(projectId: string, fileId: string): Promise<StoredFile | null> {
    return guard(async () => (await this.#db.files.get([projectId, fileId])) ?? null);
  }

  list(projectId: string): Promise<FileRef[]> {
    return guard(async () => {
      const rows = await this.#db.files.where('projectId').equals(projectId).toArray();
      return rows
        .map(toRef)
        .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    });
  }

  delete(projectId: string, fileId: string): Promise<void> {
    return guard(() => this.#db.files.delete([projectId, fileId]));
  }
}

export class LocalProjectStore implements ProjectStore {
  readonly #db: SlapdashDB;
  readonly files: ProjectFiles;

  constructor(db: SlapdashDB, opts: { now?: () => number; newId?: () => string } = {}) {
    this.#db = db;
    this.files = new LocalFiles(db, opts.now ?? Date.now, opts.newId ?? defaultNewId);
  }

  list(): Promise<ProjectSummary[]> {
    return guard(() => this.#db.projects.orderBy('updatedAt').reverse().toArray());
  }

  async load(id: string): Promise<ProjectRecord | null> {
    const db = this.#db;
    const [body, chat] = await guard(() =>
      db.transaction('r', [db.bodies, db.chats], () => Promise.all([db.bodies.get(id), db.chats.get(id)])),
    );
    if (!body) return null;
    const checked = validateRecord({ ...body, chat: chat?.chat });
    if (!checked.ok) {
      const name = typeof body.meta?.name === 'string' ? `"${body.meta.name}"` : 'This project';
      throw new StorageError(
        'invalid',
        `The saved project ${name} couldn't be opened because its data is damaged. ${checked.errors[0] ?? ''}`.trim(),
        checked.errors,
      );
    }
    return checked.record;
  }

  async save(record: ProjectRecord): Promise<ProjectSummary> {
    const checked = validateRecord(record);
    if (!checked.ok) {
      throw new StorageError('invalid', `This project can't be saved: ${checked.errors[0] ?? 'it is invalid.'}`, checked.errors);
    }
    const { chat, ...body } = checked.record;
    const summary = summarize(checked.record);
    const db = this.#db;
    await guard(() =>
      db.transaction('rw', [db.projects, db.bodies, db.chats], async () => {
        await db.projects.put(summary);
        await db.bodies.put(body);
        await db.chats.put({ projectId: body.id, chat });
      }),
    );
    return summary;
  }

  delete(id: string): Promise<void> {
    const db = this.#db;
    return guard(() =>
      db.transaction('rw', [db.projects, db.bodies, db.chats, db.files], async () => {
        await db.projects.delete(id);
        await db.bodies.delete(id);
        await db.chats.delete(id);
        await db.files.where('projectId').equals(id).delete();
      }),
    );
  }
}

/** The one user of a local-only install. */
export const LOCAL_USER: Readonly<User> = Object.freeze({ id: 'local', displayName: 'This device' });

/** No sign-in: the local user is always signed in. */
export class LocalAuth implements Auth {
  readonly requiresSignIn = false;
  readonly #listeners = new Set<(user: User | null) => void>();

  async currentUser(): Promise<User> {
    return { ...LOCAL_USER };
  }

  async signIn(): Promise<AuthResult> {
    return { ok: true, user: { ...LOCAL_USER } };
  }

  /** Nothing to sign out of; the local user stays. */
  async signOut(): Promise<void> {}

  onChange(fn: (user: User | null) => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }
}

const LAST_PROJECT_KEY = 'lastProjectId';

export class LocalDeviceState implements DeviceState {
  readonly #db: SlapdashDB;

  constructor(db: SlapdashDB) {
    this.#db = db;
  }

  getLastProjectId(): Promise<string | null> {
    return guard(async () => {
      const row = await this.#db.device.get(LAST_PROJECT_KEY);
      return typeof row?.value === 'string' ? row.value : null;
    });
  }

  setLastProjectId(id: string | null): Promise<void> {
    return guard(async () => {
      if (id === null) await this.#db.device.delete(LAST_PROJECT_KEY);
      else await this.#db.device.put({ key: LAST_PROJECT_KEY, value: id });
    });
  }
}

/** The local backend: projects, files and device state in one IndexedDB database. */
export function createLocalBackend(opts: LocalBackendOptions = {}): StorageBackend & { db: SlapdashDB } {
  const deps: IndexedDBDeps = {};
  if (opts.indexedDB) deps.indexedDB = opts.indexedDB;
  if (opts.IDBKeyRange) deps.IDBKeyRange = opts.IDBKeyRange;
  const db = new SlapdashDB(opts.dbName ?? DEFAULT_DB_NAME, deps);
  const storeOpts: { now?: () => number; newId?: () => string } = {};
  if (opts.now) storeOpts.now = opts.now;
  if (opts.newId) storeOpts.newId = opts.newId;
  return {
    db,
    store: new LocalProjectStore(db, storeOpts),
    auth: new LocalAuth(),
    device: new LocalDeviceState(db),
    close: () => db.close(),
  };
}
