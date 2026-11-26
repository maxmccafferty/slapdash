/**
 * The storage boundary (ADR-0001 §10). The app talks only to these interfaces; backend
 * SDKs are imported only under `src/adapters/<name>/`.
 */
import type { Project, SerializedBus } from '@slapdash/core';
import type { ChatLog } from './chat.ts';

/** Per-project bookkeeping kept next to the model. */
export interface ProjectMeta {
  /** Mirrors `project.name`; kept here so `list()` doesn't need the whole project. */
  name: string;
  /** False until the user saves with a name. A fresh site is "New project" and unnamed. */
  named: boolean;
  /** ms since epoch. */
  createdAt: number;
  /** ms since epoch. Set by the caller (the session), not by the store. */
  updatedAt: number;
}

/** Everything persisted for one project, apart from its files. */
export interface ProjectRecord {
  id: string;
  meta: ProjectMeta;
  project: Project;
  /** Undo/redo history and named versions, or null if there is none. */
  history: SerializedBus | null;
  chat: ChatLog;
}

/** One row of the Projects list. */
export interface ProjectSummary {
  id: string;
  name: string;
  named: boolean;
  createdAt: number;
  updatedAt: number;
  partCount: number;
}

/** A file to store, e.g. a photo. `id` and `createdAt` are kept if given (used by import). */
export interface NewFile {
  id?: string;
  createdAt?: number;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface FileRef {
  id: string;
  projectId: string;
  name: string;
  mimeType: string;
  /** Bytes. */
  size: number;
  createdAt: number;
}

export interface StoredFile extends FileRef {
  bytes: Uint8Array;
}

export interface ProjectFiles {
  /** Store a copy of the bytes. A file with the same id in the same project is replaced. */
  put(projectId: string, file: NewFile): Promise<FileRef>;
  /** Null if there's no such file in that project. */
  get(projectId: string, fileId: string): Promise<StoredFile | null>;
  /** Oldest first (by createdAt, then id). */
  list(projectId: string): Promise<FileRef[]>;
  /** No-op if missing. */
  delete(projectId: string, fileId: string): Promise<void>;
}

export interface ProjectStore {
  /** Newest `updatedAt` first. */
  list(): Promise<ProjectSummary[]>;
  /** Null if there's no such project. Throws `StorageError('invalid')` if the stored data can't be read. */
  load(id: string): Promise<ProjectRecord | null>;
  /** Insert or replace. Validates first; throws `StorageError('invalid')` and stores nothing if invalid. */
  save(record: ProjectRecord): Promise<ProjectSummary>;
  /** Removes the record, its chat and its files. No-op if missing. */
  delete(id: string): Promise<void>;
  files: ProjectFiles;
}

export interface User {
  id: string;
  displayName: string;
  email?: string;
}

export type SignInCredentials = { kind: 'password'; email: string; password: string } | { kind: 'passkey' };

export type AuthResult = { ok: true; user: User } | { ok: false; error: string };

export interface Auth {
  /** False for the local adapter: there is always a user. */
  readonly requiresSignIn: boolean;
  currentUser(): Promise<User | null>;
  signIn(credentials: SignInCredentials): Promise<AuthResult>;
  signOut(): Promise<void>;
  /** Called when the signed-in user changes. Returns an unsubscribe function. */
  onChange(fn: (user: User | null) => void): () => void;
}

/** Per-device state. Kept out of ProjectStore because it stays local even with a remote backend. */
export interface DeviceState {
  getLastProjectId(): Promise<string | null>;
  setLastProjectId(id: string | null): Promise<void>;
}

/** What an adapter's factory returns. */
export interface StorageBackend {
  store: ProjectStore;
  auth: Auth;
  device: DeviceState;
  /** Release connections. The backend can't be used afterwards. */
  close(): void;
}
