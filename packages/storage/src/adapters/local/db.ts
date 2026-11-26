import { Dexie, type Table } from 'dexie';
import type { ChatLog } from '../../chat.ts';
import type { ProjectRecord, ProjectSummary, StoredFile } from '../../types.ts';

export type BodyRow = Omit<ProjectRecord, 'chat'>;
export interface ChatRow {
  projectId: string;
  chat: ChatLog;
}
export interface DeviceRow {
  key: string;
  value: unknown;
}

export interface IndexedDBDeps {
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

export const DEFAULT_DB_NAME = 'slapdash';

/**
 * The local database. Version 1 tables:
 * - projects: ProjectSummary rows, so list() is cheap
 * - bodies: { id, meta, project, history }
 * - chats: { projectId, chat }
 * - files: StoredFile rows keyed by [projectId+id]
 * - device: per-device key/value (last project id)
 *
 * To change the schema, add `this.version(2).stores(...)` (with an upgrade if needed);
 * never edit version 1.
 */
export class SlapdashDB extends Dexie {
  declare projects: Table<ProjectSummary, string>;
  declare bodies: Table<BodyRow, string>;
  declare chats: Table<ChatRow, string>;
  declare files: Table<StoredFile, [string, string]>;
  declare device: Table<DeviceRow, string>;

  constructor(name = DEFAULT_DB_NAME, deps: IndexedDBDeps = {}) {
    super(name, {
      ...(deps.indexedDB ? { indexedDB: deps.indexedDB } : {}),
      ...(deps.IDBKeyRange ? { IDBKeyRange: deps.IDBKeyRange } : {}),
    });
    this.version(1).stores({
      projects: 'id, updatedAt',
      bodies: 'id',
      chats: 'projectId',
      files: '[projectId+id], projectId',
      device: 'key',
    });
  }
}
