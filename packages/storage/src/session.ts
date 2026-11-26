/**
 * A project open in the app: the command bus, its chat, and autosave to a ProjectStore.
 *
 * Autosave: every bus change (execute, undo, redo, restore) and every chat change marks
 * the session dirty and schedules a debounced `flush()`. Saves never overlap. A failed
 * save keeps the session dirty and sets an error status; the next change or flush
 * retries. The app should call `flush()` on `pagehide`/`visibilitychange`.
 */
import { CommandBus, createProject, formatErrors, type Catalog, type CatalogIndex, type Project } from '@slapdash/core';
import { emptyChatLog, zChatMessage, type ChatLog, type ChatMessage, type JsonValue } from './chat.ts';
import { describeError, StorageError } from './errors.ts';
import {
  decodeSlapdashFile,
  encodeSlapdashFile,
  SLAPDASH_MIME_TYPE,
  slapdashFileName,
  type PortableFile,
} from './format/slapdash-file.ts';
import { newId as defaultNewId } from './ids.ts';
import type { DeviceState, ProjectMeta, ProjectRecord, ProjectStore } from './types.ts';

export const NEW_PROJECT_NAME = 'New project';
export const DEFAULT_AUTOSAVE_MS = 500;

export interface SessionDeps {
  store: ProjectStore;
  device: DeviceState;
  catalog: Catalog | CatalogIndex;
  /** Clock. Default Date.now. */
  now?: () => number;
  /** Id generator for new projects and chat messages. Default crypto.randomUUID. */
  newId?: () => string;
  /** Autosave delay after the last change. Default 500 ms. */
  debounceMs?: number;
}

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string };

/** Result of `flush()`. Never rejects. `saved: false` means there was nothing to save yet. */
export type FlushResult = { ok: true; saved: boolean } | { ok: false; message: string };

export type SaveResult =
  | { ok: true; message: string }
  | { ok: false; needsName: true; suggestedName: string }
  | { ok: false; needsName: false; message: string };

export interface ExportedFile {
  fileName: string;
  mimeType: string;
  text: string;
}

export type ImportResult = { ok: true; id: string; name: string } | { ok: false; errors: string[] };

export interface NewChatMessage {
  role: ChatMessage['role'];
  content: JsonValue;
  turnId?: string;
  id?: string;
  at?: number;
}

interface Resolved {
  store: ProjectStore;
  device: DeviceState;
  catalog: Catalog | CatalogIndex;
  now: () => number;
  newId: () => string;
  debounceMs: number;
}

function resolve(deps: SessionDeps): Resolved {
  return {
    store: deps.store,
    device: deps.device,
    catalog: deps.catalog,
    now: deps.now ?? Date.now,
    newId: deps.newId ?? defaultNewId,
    debounceMs: deps.debounceMs ?? DEFAULT_AUTOSAVE_MS,
  };
}

export class ProjectSession {
  readonly id: string;
  readonly bus: CommandBus;
  readonly #deps: Resolved;
  #meta: ProjectMeta;
  #chat: ChatLog;
  /** True once the record exists in the store. */
  #persisted: boolean;
  #dirty = false;
  #closed = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #queue: Promise<FlushResult> = Promise.resolve({ ok: true, saved: false });
  #status: SaveStatus = { kind: 'idle' };
  readonly #statusListeners = new Set<(status: SaveStatus) => void>();
  readonly #unsubscribeBus: () => void;

  private constructor(deps: Resolved, record: ProjectRecord, persisted: boolean) {
    this.#deps = deps;
    this.id = record.id;
    this.#meta = { ...record.meta };
    this.#chat = record.chat;
    this.#persisted = persisted;
    const busOpts = { project: record.project, catalog: deps.catalog, now: deps.now };
    this.bus = record.history ? CommandBus.hydrate(busOpts, record.history) : new CommandBus(busOpts);
    this.#unsubscribeBus = this.bus.subscribe(() => this.#markDirty());
  }

  // ── Opening ───────────────────────────────────────────────────────────────

  /**
   * Open the project this device last used, or start a fresh "New project" if there is
   * none. If the last project can't be read, a fresh project is opened instead and the
   * status is set to an error; this never throws because of bad stored data.
   */
  static async open(deps: SessionDeps): Promise<ProjectSession> {
    const d = resolve(deps);
    let error: string | null = null;
    try {
      const lastId = await d.device.getLastProjectId();
      if (lastId) {
        const record = await d.store.load(lastId);
        if (record) return new ProjectSession(d, record, true);
      }
    } catch (e) {
      error = `Your last project couldn't be opened, so a new one was started. ${describeError(e)}`;
    }
    const session = ProjectSession.#fresh(d);
    if (error) session.#setStatus({ kind: 'error', message: error });
    return session;
  }

  /** Open a stored project and remember it as this device's last project. */
  static async openById(id: string, deps: SessionDeps): Promise<ProjectSession> {
    const d = resolve(deps);
    const record = await d.store.load(id);
    if (!record) throw new StorageError('not_found', "That project couldn't be found. It may have been deleted.");
    await d.device.setLastProjectId(id);
    return new ProjectSession(d, record, true);
  }

  /** Start a fresh, unnamed project. Nothing is stored until the first change. */
  static newProject(deps: SessionDeps): ProjectSession {
    return ProjectSession.#fresh(resolve(deps));
  }

  static #fresh(d: Resolved): ProjectSession {
    const at = d.now();
    const project = createProject({ name: NEW_PROJECT_NAME });
    const record: ProjectRecord = {
      id: d.newId(),
      meta: { name: project.name, named: false, createdAt: at, updatedAt: at },
      project,
      history: null,
      chat: emptyChatLog(),
    };
    return new ProjectSession(d, record, false);
  }

  /**
   * Import a .slapdash file as a new project (always a new id). Files keep their ids,
   * so references to them in the chat still work. Open it with `openById`.
   */
  static async importFile(
    text: string,
    deps: Pick<SessionDeps, 'store' | 'newId'>,
  ): Promise<ImportResult> {
    const decoded = decodeSlapdashFile(text);
    if (!decoded.ok) return decoded;
    const id = (deps.newId ?? defaultNewId)();
    try {
      await deps.store.save({ id, ...decoded.record });
      for (const f of decoded.files) {
        await deps.store.files.put(id, { id: f.id, name: f.name, mimeType: f.mimeType, createdAt: f.createdAt, bytes: f.bytes });
      }
    } catch (e) {
      await deps.store.delete(id).catch(() => {});
      return { ok: false, errors: [`The project couldn't be imported. ${describeError(e)}`] };
    }
    return { ok: true, id, name: decoded.record.meta.name };
  }

  // ── State ─────────────────────────────────────────────────────────────────

  get project(): Readonly<Project> {
    return this.bus.project;
  }

  get meta(): Readonly<ProjectMeta> {
    return { ...this.#meta, name: this.bus.project.name };
  }

  get chat(): Readonly<ChatLog> {
    return this.#chat;
  }

  get isDirty(): boolean {
    return this.#dirty;
  }

  /** True once the project has been written to the store at least once. */
  get isPersisted(): boolean {
    return this.#persisted;
  }

  get status(): SaveStatus {
    return this.#status;
  }

  /** Called whenever the save status changes. Returns an unsubscribe function. */
  onStatus(fn: (status: SaveStatus) => void): () => void {
    this.#statusListeners.add(fn);
    return () => {
      this.#statusListeners.delete(fn);
    };
  }

  /** The record as it would be saved now. Commands in a still-open bus group are not in `history`. */
  toRecord(): ProjectRecord {
    return {
      id: this.id,
      meta: { ...this.#meta, name: this.bus.project.name },
      project: this.bus.project,
      history: this.bus.serialize(),
      chat: this.#chat,
    };
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  /** Add a message to the saved chat. Throws StorageError('invalid') if it isn't valid JSON data. */
  appendChat(message: NewChatMessage): ChatMessage {
    const candidate: Record<string, unknown> = {
      id: message.id ?? this.#deps.newId(),
      role: message.role,
      at: message.at ?? this.#deps.now(),
      content: message.content,
    };
    if (message.turnId !== undefined) candidate.turnId = message.turnId;
    const parsed = zChatMessage.safeParse(candidate);
    if (!parsed.success) {
      throw new StorageError('invalid', "That chat message can't be saved: its content isn't plain JSON data.");
    }
    this.#chat = { ...this.#chat, messages: [...this.#chat.messages, parsed.data] };
    this.#markDirty();
    return parsed.data;
  }

  /**
   * Replace older turns with a summary (ADR-0002 §D8): keeps the last `keep` messages
   * and stores `summary`. Pass null to clear the summary without dropping messages.
   */
  setChatSummary(summary: string | null, keep?: number): void {
    const next: ChatLog = { version: this.#chat.version, messages: this.#chat.messages };
    if (summary !== null) next.summary = summary;
    if (keep !== undefined) next.messages = keep <= 0 ? [] : this.#chat.messages.slice(-keep);
    this.#chat = next;
    this.#markDirty();
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  /**
   * The user's Save action. An unnamed project needs a name first: without one this
   * returns `needsName` and a suggestion. Naming is an undoable rename.
   */
  async save(opts: { name?: string } = {}): Promise<SaveResult> {
    const name = opts.name?.trim() ?? '';
    if (!this.#meta.named && name === '') {
      return { ok: false, needsName: true, suggestedName: this.bus.project.name };
    }
    if (name !== '') {
      if (name !== this.bus.project.name) {
        const res = this.bus.group({ label: 'Name the project', source: 'user' }, () =>
          this.bus.execute('rename_project', { name }),
        );
        if (!res.ok) return { ok: false, needsName: false, message: formatErrors(res.errors) };
      }
      this.#meta = { ...this.#meta, named: true };
    }
    this.#dirty = true;
    const out = await this.flush();
    if (!out.ok) return { ok: false, needsName: false, message: out.message };
    if (!out.saved) {
      return { ok: false, needsName: false, message: "Changes are still being made; they'll be saved when they finish." };
    }
    return { ok: true, message: `Saved "${this.bus.project.name}".` };
  }

  /**
   * Save now if there are unsaved changes. Saves run one at a time; a flush during a
   * save runs after it. Never rejects. If a bus group is open (e.g. Claude is mid-turn),
   * saving waits until it closes, because its commands aren't in the history yet.
   */
  flush(): Promise<FlushResult> {
    this.#clearTimer();
    this.#queue = this.#queue.then(() => this.#saveNow());
    return this.#queue;
  }

  async #saveNow(): Promise<FlushResult> {
    if (!this.#dirty) return { ok: true, saved: false };
    if (this.bus.inGroup) {
      this.#schedule();
      return { ok: true, saved: false };
    }
    const at = this.#deps.now();
    const meta: ProjectMeta = { ...this.#meta, name: this.bus.project.name, updatedAt: at };
    const record: ProjectRecord = { ...this.toRecord(), meta };
    this.#dirty = false;
    this.#setStatus({ kind: 'saving' });
    try {
      await this.#deps.store.save(record);
      this.#meta = meta;
      this.#persisted = true;
      await this.#deps.device.setLastProjectId(this.id);
      this.#setStatus({ kind: 'saved', at });
      return { ok: true, saved: true };
    } catch (e) {
      this.#dirty = true;
      const message = `Your latest changes aren't saved yet. ${describeError(e)}`;
      this.#setStatus({ kind: 'error', message });
      return { ok: false, message };
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  /**
   * The project as a .slapdash file. Saves first if needed, but exports the in-memory
   * state either way, so an export still works if the store is failing.
   */
  async exportFile(): Promise<ExportedFile> {
    await this.flush();
    const files: PortableFile[] = [];
    if (this.#persisted) {
      for (const ref of await this.#deps.store.files.list(this.id)) {
        const file = await this.#deps.store.files.get(this.id, ref.id);
        if (file) files.push(file);
      }
    }
    const record = this.toRecord();
    return {
      fileName: slapdashFileName(record.meta.name),
      mimeType: SLAPDASH_MIME_TYPE,
      text: encodeSlapdashFile(record, files, { now: this.#deps.now }),
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Save any pending changes and stop autosaving. */
  async close(): Promise<FlushResult> {
    const out = await this.flush();
    this.#closed = true;
    this.#clearTimer();
    this.#unsubscribeBus();
    this.#statusListeners.clear();
    return out;
  }

  #markDirty(): void {
    this.#dirty = true;
    this.#schedule();
  }

  #schedule(): void {
    if (this.#closed) return;
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.flush();
    }, this.#deps.debounceMs);
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #setStatus(status: SaveStatus): void {
    this.#status = status;
    for (const fn of this.#statusListeners) fn(status);
  }
}
