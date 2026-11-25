/**
 * The command bus (ADR-0002 §A2): the only writer of the model. Every change is a
 * typed command → schema validation → semantic checks → apply → inverse recorded.
 * A group (one Claude turn) is one undo step.
 */
import type { Catalog } from '../catalog/schema.ts';
import { indexCatalog, isCatalogIndex, type CatalogIndex } from '../catalog/validate.ts';
import type { Project } from '../model/schema.ts';
import { commandError, notFound, suggest, zodIssuesToErrors, type CommandError } from '../commands/errors.ts';
import { commandRegistry } from '../commands/registry.ts';
import type { AppliedCommand, CommandContext } from '../commands/types.ts';
import {
  DEFAULT_HISTORY_LIMIT,
  type GroupMeta,
  type HistoryEntry,
  type HistoryListItem,
  type RecordedCommand,
} from './history.ts';
import { VersionStore, type SavedVersion, type VersionListItem } from './versions.ts';

export type ExecResult = { ok: true; summary: string; created: string[] } | { ok: false; errors: CommandError[] };
export type UndoResult = { ok: true; summary: string } | { ok: false; errors: CommandError[] };
export type BusResult = { ok: true; summary: string } | { ok: false; errors: CommandError[] };

export type BusEventType = 'execute' | 'undo' | 'redo' | 'restore';
export interface BusEvent {
  type: BusEventType;
  summary: string;
}
export type BusListener = (project: Project, event: BusEvent) => void;

export interface CommandBusOptions {
  project: Project;
  catalog: Catalog | CatalogIndex;
  /** Clock, for history timestamps. Defaults to Date.now. */
  now?: () => number;
  /** Oldest entries are dropped beyond this. Default 500. */
  historyLimit?: number;
  /** Deep-freeze every project state (catches accidental mutation). Default true. */
  freeze?: boolean;
}

export interface SerializedBus {
  version: 1;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  versions: SavedVersion[];
  nextEntryId: number;
}

interface OpenGroup {
  meta: GroupMeta;
  depth: number;
  commands: RecordedCommand[];
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  return value;
}

const nothingTo = (what: string): UndoResult => ({
  ok: false,
  errors: [commandError('not_allowed', `Nothing to ${what}.`)],
});

export class CommandBus {
  #project: Project;
  readonly catalog: CatalogIndex;
  readonly #ctx: CommandContext;
  readonly #historyLimit: number;
  readonly #freeze: boolean;
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];
  #group: OpenGroup | null = null;
  #nextEntryId = 1;
  #versions = new VersionStore();
  #listeners = new Set<BusListener>();

  constructor(opts: CommandBusOptions) {
    this.catalog = isCatalogIndex(opts.catalog) ? opts.catalog : indexCatalog(opts.catalog);
    this.#ctx = { catalog: this.catalog, now: opts.now ?? Date.now };
    this.#historyLimit = opts.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.#freeze = opts.freeze ?? true;
    this.#project = this.#maybeFreeze(opts.project);
  }

  get project(): Readonly<Project> {
    return this.#project;
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  /**
   * Run a command. On success it is recorded in the open group (or as its own undo
   * step) and the redo stack is cleared. On failure the project is unchanged and the
   * errors are plain sentences Claude can act on.
   */
  execute(name: string, rawInput: unknown): ExecResult {
    const def = commandRegistry.get(name);
    if (!def || !def.exposed) {
      const close = suggest(name, [...commandRegistry.values()].filter((d) => d.exposed).map((d) => d.name));
      return {
        ok: false,
        errors: [
          commandError('unknown_command', `There's no command "${name}".`, close ? { hint: `Did you mean "${close}"?` } : {}),
        ],
      };
    }
    const result = this.#run({ name, input: rawInput });
    if (!result.ok) return result;

    this.#project = result.project;
    const recorded: RecordedCommand = { redo: result.redo, inverse: result.inverse, summary: result.summary };
    if (this.#group) {
      this.#group.commands.push(recorded);
    } else {
      this.#push({ label: result.summary, source: 'user' }, [recorded]);
    }
    this.#redo = [];
    this.#emit({ type: 'execute', summary: result.summary });
    return { ok: true, summary: result.summary, created: result.created };
  }

  /** Validate and apply one command against the current project, without recording. */
  #run(cmd: AppliedCommand):
    | { ok: true; project: Project; inverse: AppliedCommand[]; redo: AppliedCommand; summary: string; created: string[] }
    | { ok: false; errors: CommandError[] } {
    return this.#runOn(this.#project, cmd);
  }

  #runOn(project: Project, cmd: AppliedCommand) {
    const def = commandRegistry.get(cmd.name);
    if (!def) {
      return { ok: false as const, errors: [commandError('unknown_command', `There's no command "${cmd.name}".`)] };
    }
    const parsed = def.schema.safeParse(cmd.input);
    if (!parsed.success) return { ok: false as const, errors: zodIssuesToErrors(parsed.error.issues, cmd.input) };
    const problems = def.check(project, parsed.data, this.#ctx);
    if (problems.length > 0) return { ok: false as const, errors: problems };
    try {
      const res = def.apply(project, parsed.data, this.#ctx);
      return { ok: true as const, ...res, project: this.#maybeFreeze(res.project) };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return {
        ok: false as const,
        errors: [commandError('internal', `Something went wrong running ${cmd.name}; nothing was changed. (${detail})`)],
      };
    }
  }

  /** Apply a list of commands in order, all or nothing. */
  #runAll(cmds: readonly AppliedCommand[]): { ok: true; project: Project } | { ok: false; errors: CommandError[] } {
    let project = this.#project;
    for (const cmd of cmds) {
      const res = this.#runOn(project, cmd);
      if (!res.ok) return res;
      project = res.project;
    }
    return { ok: true, project };
  }

  // ── Groups ────────────────────────────────────────────────────────────────

  /**
   * Start collecting commands into one undo step (e.g. one Claude turn). Nested
   * begins flatten into the outer group. Failed commands are not recorded and do not
   * abort the group.
   */
  beginGroup(meta: GroupMeta): void {
    if (this.#group) {
      this.#group.depth++;
      return;
    }
    this.#group = { meta: { ...meta }, depth: 1, commands: [] };
  }

  /** Close the group. Returns the recorded entry, or null if nested or empty. */
  endGroup(): HistoryEntry | null {
    const g = this.#group;
    if (!g) return null;
    g.depth--;
    if (g.depth > 0) return null;
    this.#group = null;
    if (g.commands.length === 0) return null;
    return this.#push(g.meta, g.commands);
  }

  /** Run `fn` inside a group. Synchronous only: the group closes when `fn` returns. */
  group<T>(meta: GroupMeta, fn: () => T): T {
    this.beginGroup(meta);
    try {
      return fn();
    } finally {
      this.endGroup();
    }
  }

  get inGroup(): boolean {
    return this.#group !== null;
  }

  /**
   * Undo, redo and restore run against committed history. If a group is open, its
   * commands so far are committed first (if any), the operation runs, and a fresh
   * group with the same label, source and depth is reopened for what follows.
   */
  #outsideGroup<T>(fn: () => T): T {
    const g = this.#group;
    if (!g) return fn();
    this.#group = null;
    if (g.commands.length > 0) this.#push(g.meta, g.commands);
    try {
      return fn();
    } finally {
      this.#group = { meta: g.meta, depth: g.depth, commands: [] };
    }
  }

  #push(meta: GroupMeta, commands: RecordedCommand[]): HistoryEntry {
    const entry: HistoryEntry = { id: this.#nextEntryId++, ...meta, at: this.#ctx.now(), commands };
    this.#undo.push(entry);
    if (this.#undo.length > this.#historyLimit) this.#undo.splice(0, this.#undo.length - this.#historyLimit);
    return entry;
  }

  // ── Undo / redo ───────────────────────────────────────────────────────────

  get canUndo(): boolean {
    return this.#undo.length > 0 || (this.#group?.commands.length ?? 0) > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  undo(): UndoResult {
    return this.#outsideGroup(() => {
      const entry = this.#undo.at(-1);
      if (!entry) return nothingTo('undo');
      const inverses = entry.commands
        .slice()
        .reverse()
        .flatMap((c) => c.inverse.slice().reverse());
      const res = this.#runAll(inverses);
      if (!res.ok) return res;
      this.#undo.pop();
      this.#redo.push(entry);
      this.#project = res.project;
      const summary = `Undid: ${entry.label}`;
      this.#emit({ type: 'undo', summary });
      return { ok: true, summary };
    });
  }

  redo(): UndoResult {
    return this.#outsideGroup(() => {
      const entry = this.#redo.at(-1);
      if (!entry) return nothingTo('redo');
      const res = this.#runAll(entry.commands.map((c) => c.redo));
      if (!res.ok) return res;
      this.#redo.pop();
      this.#undo.push(entry);
      this.#project = res.project;
      const summary = `Redid: ${entry.label}`;
      this.#emit({ type: 'redo', summary });
      return { ok: true, summary };
    });
  }

  /** Recent history, oldest first; undone entries (redoable) come last. */
  listHistory(limit = 20): HistoryListItem[] {
    const toItem = (e: HistoryEntry, isUndone: boolean): HistoryListItem => {
      const item: HistoryListItem = {
        id: e.id,
        label: e.label,
        source: e.source,
        at: e.at,
        summaries: e.commands.map((c) => c.summary),
        isUndone,
      };
      if (e.turnId !== undefined) item.turnId = e.turnId;
      return item;
    };
    const items = [
      ...this.#undo.map((e) => toItem(e, false)),
      ...this.#redo
        .slice()
        .reverse()
        .map((e) => toItem(e, true)),
    ];
    return items.slice(Math.max(0, items.length - limit));
  }

  // ── Versions ──────────────────────────────────────────────────────────────

  saveVersion(name: string, note?: string): BusResult {
    const trimmed = name.trim();
    if (trimmed === '') return { ok: false, errors: [commandError('invalid_input', 'A version needs a name.', { path: 'name' })] };
    if (this.#versions.has(trimmed)) {
      return {
        ok: false,
        errors: [commandError('conflict', `A version called "${trimmed}" already exists.`, { path: 'name', hint: 'Pick another name.' })],
      };
    }
    const version: SavedVersion = { name: trimmed, savedAt: this.#ctx.now(), project: this.#project };
    if (note !== undefined) version.note = note;
    this.#versions.add(version);
    return { ok: true, summary: `Saved version "${trimmed}".` };
  }

  listVersions(): VersionListItem[] {
    return this.#versions.list();
  }

  /** Restore a saved version as an undo step of its own, so the restore can be undone. */
  restoreVersion(name: string): BusResult {
    const version = this.#versions.get(name);
    if (!version) return { ok: false, errors: [notFound('saved version', name.trim(), this.#versions.names(), 'name')] };
    const source = this.#group?.meta.source ?? 'user';
    return this.#outsideGroup(() => {
      const res = this.#run({ name: 'replace_project', input: { project: version.project } });
      if (!res.ok) return res;
      const label = `Restored version "${version.name}"`;
      this.#project = res.project;
      this.#push({ label, source }, [
        { redo: res.redo, inverse: res.inverse, summary: `${label}.` },
      ]);
      this.#redo = [];
      this.#emit({ type: 'restore', summary: `${label}.` });
      return { ok: true, summary: `${label}.` };
    });
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  /** Called once after every successful execute, undo, redo or restore. Returns an unsubscribe function. */
  subscribe(fn: BusListener): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #emit(event: BusEvent): void {
    for (const fn of this.#listeners) fn(this.#project, event);
  }

  // ── Persistence hooks (used by @slapdash/storage) ─────────────────────────

  /** History and versions as plain data. Commands in a still-open group are not included; end it first. */
  serialize(): SerializedBus {
    return {
      version: 1,
      undo: [...this.#undo],
      redo: [...this.#redo],
      versions: [...this.#versions.all()],
      nextEntryId: this.#nextEntryId,
    };
  }

  static hydrate(opts: CommandBusOptions, data: SerializedBus): CommandBus {
    const bus = new CommandBus(opts);
    bus.#undo = [...data.undo];
    bus.#redo = [...data.redo];
    bus.#versions = new VersionStore(data.versions);
    bus.#nextEntryId = data.nextEntryId;
    return bus;
  }

  #maybeFreeze(project: Project): Project {
    return this.#freeze ? deepFreeze(project) : project;
  }
}
