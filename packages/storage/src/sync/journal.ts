/**
 * What the synced store still has to send to the remote. It is kept on the device (the
 * local adapter stores it in its `device` table), so changes made offline survive a reload.
 */

export interface PendingFile {
  projectId: string;
  fileId: string;
}

export interface Pending {
  /** Project ids whose local record must be pushed. */
  saves: string[];
  /** Project ids deleted here and not yet on the remote. */
  deletes: string[];
  files: PendingFile[];
  fileDeletes: PendingFile[];
  /**
   * The `meta.updatedAt` last pushed to, or pulled from, the remote for each project. A
   * remote copy newer than this was changed on another device (see the conflict rule).
   */
  baseline: Record<string, number>;
}

export interface SyncJournal {
  read(): Promise<Pending>;
  write(pending: Pending): Promise<void>;
}

export function emptyPending(): Pending {
  return { saves: [], deletes: [], files: [], fileDeletes: [], baseline: {} };
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function fileRefs(v: unknown): PendingFile[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is PendingFile =>
      typeof x === 'object' && x !== null && typeof (x as PendingFile).projectId === 'string' && typeof (x as PendingFile).fileId === 'string',
  );
}

/** A journal read from storage, with anything unreadable dropped. */
export function normalizePending(raw: unknown): Pending {
  if (typeof raw !== 'object' || raw === null) return emptyPending();
  const r = raw as Record<string, unknown>;
  const baseline: Record<string, number> = {};
  if (typeof r.baseline === 'object' && r.baseline !== null) {
    for (const [k, v] of Object.entries(r.baseline as Record<string, unknown>)) if (typeof v === 'number') baseline[k] = v;
  }
  return { saves: strings(r.saves), deletes: strings(r.deletes), files: fileRefs(r.files), fileDeletes: fileRefs(r.fileDeletes), baseline };
}

export function pendingCount(p: Pending): number {
  return p.saves.length + p.deletes.length + p.files.length + p.fileDeletes.length;
}

/** A journal that lasts as long as the page (tests). */
export class MemorySyncJournal implements SyncJournal {
  #value: Pending = emptyPending();
  async read(): Promise<Pending> {
    return structuredClone(this.#value);
  }
  async write(pending: Pending): Promise<void> {
    this.#value = structuredClone(pending);
  }
}
