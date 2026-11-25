/**
 * Local-first sync over any remote backend (ADR-0001 §10): the device keeps working copies
 * and a push queue, the remote is the source of truth across devices. SDK-free.
 */
import type { ProjectStore, StorageBackend } from '../types.ts';
import type { SyncJournal } from './journal.ts';
import { SyncedProjectStore, type SyncConflict, type SyncedStoreOptions, type SyncStatus } from './synced-store.ts';

export {
  emptyPending,
  MemorySyncJournal,
  normalizePending,
  pendingCount,
  type Pending,
  type PendingFile,
  type SyncJournal,
} from './journal.ts';
export {
  CONFLICT_SUFFIX,
  DEFAULT_RETRY_DELAYS_MS,
  SyncedProjectStore,
  type SyncConflict,
  type SyncedStoreOptions,
  type SyncStatus,
} from './synced-store.ts';

/** What the app needs to show and nudge sync. */
export interface SyncControl {
  readonly status: SyncStatus;
  onStatus(fn: (s: SyncStatus) => void): () => void;
  onConflict(fn: (c: SyncConflict) => void): () => void;
  /** Push now (coming online, back to the foreground). */
  retry(): void;
  /** Resolves when nothing is being pushed. */
  idle(): Promise<void>;
}

export interface SyncedBackend extends StorageBackend {
  store: SyncedProjectStore;
  sync: SyncControl;
}

export interface SyncedBackendOptions extends Partial<Omit<SyncedStoreOptions, 'local' | 'remote' | 'journal'>> {
  /** Where projects live on this device; also supplies `device`. */
  local: StorageBackend;
  /** The source of truth across devices; also supplies `auth`. */
  remote: StorageBackend;
  /** The push queue, kept on this device. */
  journal: SyncJournal;
}

export function createSyncedBackend(opts: SyncedBackendOptions): SyncedBackend {
  const { local, remote, journal, ...rest } = opts;
  const store = new SyncedProjectStore({ ...rest, local: local.store, remote: remote.store, journal });
  const sync: SyncControl = {
    get status() {
      return store.status;
    },
    onStatus: (fn) => store.onStatus(fn),
    onConflict: (fn) => store.onConflict(fn),
    retry: () => store.retry(),
    idle: () => store.idle(),
  };
  return {
    store,
    sync,
    auth: remote.auth,
    device: local.device,
    close: () => {
      store.close();
      local.close();
      remote.close();
    },
  };
}

/**
 * Copy every project (with its files, keeping ids) from one store into another. Used once
 * per user and device on first sign-in, so projects made before sign-in upload. Projects
 * that can't be read are skipped. Returns how many were copied.
 */
export async function adoptProjects(from: ProjectStore, into: ProjectStore): Promise<number> {
  let count = 0;
  for (const summary of await from.list()) {
    const record = await from.load(summary.id).catch(() => null);
    if (!record) continue;
    for (const ref of await from.files.list(summary.id)) {
      const f = await from.files.get(summary.id, ref.id);
      if (f) await into.files.put(summary.id, { id: f.id, createdAt: f.createdAt, name: f.name, mimeType: f.mimeType, bytes: f.bytes });
    }
    await into.save(record);
    count++;
  }
  return count;
}
