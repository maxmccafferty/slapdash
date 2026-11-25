/**
 * The open project, framework-free (ADR-0003 §I). It owns the current `ProjectSession`
 * (autosave to the ProjectStore), points the model store at its bus, and runs the Projects
 * modal's actions: open, new, import and the shipped sample. React reads `projects-store.ts`
 * and calls these methods through `ProjectsContext`.
 *
 * Switching projects: capture the old project's card picture, close its session (which
 * saves anything pending), then attach the new bus. The chat controller sees the new bus and
 * restores that project's chat through `chatLogFor`.
 */
import type { ChatLogLike } from '@slapdash/agent';
import type { Catalog, CatalogIndex, CommandBus, SiteDefaults } from '@slapdash/core';
import {
  describeError,
  ProjectSession,
  type Auth,
  type ChatLog,
  type DeviceState,
  type ProjectStore,
  type SaveStatus,
  type SessionDeps,
  type SyncControl,
  type SyncStatus,
  type User,
} from '@slapdash/storage';
import { conflictNote, offlineNote, SYNCED_NOTE } from '../sync/sync-status.ts';
import { attach, buildSample } from '../model/bootstrap.ts';
import { partCount } from '../model/floor-stops.ts';
import { isSnapshotReady, renderSnapshot } from '../renderer/snapshot/registry.ts';
import { SAMPLE_NAME } from '../samples/build.ts';
import { supportsWebGL2 } from '../shell/ModelArea.tsx';
import { useModelStore } from '../state/model-store.ts';
import { useShellStore } from '../state/shell-store.ts';
import { useProjectsStore, type ProjectsState } from './projects-store.ts';

/** The card picture: a 256 px iso view. */
export const THUMBNAIL_SIZE = 256;

export interface ProjectsControllerDeps {
  store: ProjectStore;
  device: DeviceState;
  catalog: Catalog | CatalogIndex;
  siteDefaults?: () => SiteDefaults | undefined;
  now?: () => number;
  newId?: () => string;
  debounceMs?: number;
  /** The shipped sample's file text. Default: the bundled `pool-house.slapdash` (lazy chunk). */
  loadSample?: () => Promise<string>;
  /**
   * Renders the current model as a PNG for its card, or null if the 3D view can't. Waits up
   * to `waitMs` for the 3D view to load.
   */
  renderThumbnail?: (opts: { waitMs: number }) => Promise<Blob | null>;
  /** A line in the chat: Save's result, a save that failed. */
  notify?: (text: string) => void;
  createUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
  /** Where `pagehide` and `visibilitychange` are listened for. Default `window` if there is one. */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'> & { document?: Pick<Document, 'visibilityState'> };
  /**
   * Cloud sync (hosted copy). When set, coming back online or to the foreground pushes
   * pending changes, refreshes the list and reopens the open project if another device
   * changed it; going offline and coming back are noted in the chat once each.
   */
  sync?: SyncControl;
  /** The signed-in user and their auth, for the Projects footer's Sign out. */
  user?: User;
  auth?: Auth;
  /** True while something (a Claude turn) is using the open project's bus: no reopening then. */
  isBusy?: () => boolean;
  /** After sign-out. Default `location.reload()`, which shows the sign-in card. */
  reload?: () => void;
}

export interface ProjectsController {
  readonly current: ProjectSession | null;
  /** Open the last project (or first run's "New project"). `?sample=pool-house` builds the sample instead. */
  start(search?: string): Promise<void>;
  /** Open a stored project. False (with `error` set) if it couldn't be opened. */
  openProject(id: string): Promise<boolean>;
  newProject(): Promise<void>;
  /** Import a .slapdash file as a new project and open it. False (with `error` set) if it was refused. */
  importFile(file: Blob): Promise<boolean>;
  /** Open the shipped sample pool house as a new project. */
  openSample(): Promise<boolean>;
  /** The Save key: name the project (keeping its name) and save now. */
  save(): Promise<void>;
  /** The Projects modal opened: list, update the open project's picture, then list again. */
  prepareList(): Promise<void>;
  refreshList(): Promise<void>;
  /** Store the open project's card picture, waiting up to `waitMs` for the 3D view. */
  captureThumbnail(waitMs?: number): Promise<void>;
  clearError(): void;
  /** The saved chat of the project whose bus this is, or null. */
  chatLogFor(bus: CommandBus): ChatLogLike | null;
  /** Save the chat of the open project (after each Claude turn). */
  onChatChanged(log: ChatLogLike): void;
  /**
   * Back online or in the foreground (hosted copy): push, refresh the list, and reopen the
   * open project if the store has a newer copy and nothing here is unsaved.
   */
  resync(): Promise<void>;
  /** Save, wait briefly for sync, sign out on this device and reload to the sign-in card. */
  signOut(): Promise<void>;
  dispose(): Promise<void>;
}

/** How long sign-out waits for pending changes to reach the cloud. They stay queued on the device either way. */
export const SIGN_OUT_SYNC_WAIT_MS = 3000;

const set = (partial: Partial<ProjectsState>) => useProjectsStore.setState(partial);

async function defaultLoadSample(): Promise<string> {
  const mod = await import('../samples/pool-house.slapdash?raw');
  return mod.default;
}

/**
 * How long the Projects modal waits for the 3D view to load (just after a reload, say) to
 * picture the open project. The list shows meanwhile. Switching projects doesn't wait.
 */
export const THUMBNAIL_WAIT_MS = 20_000;

async function defaultRenderThumbnail({ waitMs }: { waitMs: number }): Promise<Blob | null> {
  if (!supportsWebGL2()) return null;
  for (let waited = 0; !isSnapshotReady(); waited += 100) {
    if (waited >= waitMs) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const result = await renderSnapshot({ angle: 'iso', size: THUMBNAIL_SIZE });
  return result.png;
}

const canMakeUrls = () => typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';

export function createProjectsController(deps: ProjectsControllerDeps): ProjectsController {
  const sessionDeps: SessionDeps = { store: deps.store, device: deps.device, catalog: deps.catalog };
  if (deps.siteDefaults) sessionDeps.siteDefaults = deps.siteDefaults;
  if (deps.now) sessionDeps.now = deps.now;
  if (deps.newId) sessionDeps.newId = deps.newId;
  if (deps.debounceMs !== undefined) sessionDeps.debounceMs = deps.debounceMs;

  const createUrl = deps.createUrl ?? ((blob: Blob) => (canMakeUrls() ? URL.createObjectURL(blob) : ''));
  const revokeUrl = deps.revokeUrl ?? ((url: string) => (canMakeUrls() && url ? URL.revokeObjectURL(url) : undefined));
  const renderThumbnail = deps.renderThumbnail ?? defaultRenderThumbnail;
  const loadSample = deps.loadSample ?? defaultLoadSample;

  let current: ProjectSession | null = null;
  let offStatus: () => void = () => {};
  let lastErrorNote: string | null = null;
  /** Opens run one at a time, so a double tap can't open two projects at once. */
  let switching: Promise<unknown> = Promise.resolve();

  function onStatus(status: SaveStatus) {
    set({ saveStatus: status });
    if (status.kind === 'error' && status.message !== lastErrorNote) {
      lastErrorNote = status.message;
      deps.notify?.(status.message);
    } else if (status.kind === 'saved') {
      lastErrorNote = null;
    }
  }

  /** Close the open session (saving it) and make `next` the open project. */
  async function switchTo(next: ProjectSession): Promise<void> {
    const previous = current;
    if (previous && previous !== next) {
      await captureThumbnail();
      offStatus();
      await previous.close();
    }
    current = next;
    offStatus = next.onStatus(onStatus);
    // Before attaching, so the chat controller finds this project's chat.
    set({ currentId: next.id, saveStatus: next.status, error: null });
    attach(next.bus);
    if (next.status.kind === 'error') onStatus(next.status);
    useShellStore.getState().closePanel();
  }

  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = switching.then(fn, fn);
    switching = run.catch(() => undefined);
    return run;
  }

  async function withBusy<T>(fn: () => Promise<T>): Promise<T> {
    set({ busy: true });
    try {
      return await fn();
    } finally {
      set({ busy: false });
    }
  }

  async function captureThumbnail(waitMs = 0): Promise<void> {
    const session = current;
    if (!session) return;
    const project = useModelStore.getState().project;
    if (useModelStore.getState().bus !== session.bus || !project || partCount(project) === 0) return;
    try {
      await session.flush();
      if (!session.isPersisted) return;
      const png = await renderThumbnail({ waitMs });
      if (!png) return;
      const bytes = new Uint8Array(await png.arrayBuffer());
      await session.setThumbnail(bytes);
    } catch {
      // A missing picture only means the card shows the plain floor.
    }
  }

  async function refreshList(): Promise<void> {
    try {
      const projects = await deps.store.list();
      const thumbnails: Record<string, string> = {};
      for (const p of projects) {
        const file = await deps.store.files.get(p.id, ProjectSession.THUMBNAIL_FILE_ID).catch(() => null);
        if (file) {
          const url = createUrl(new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: file.mimeType }));
          if (url) thumbnails[p.id] = url;
        }
      }
      const old = useProjectsStore.getState().thumbnails;
      set({ projects, thumbnails });
      for (const url of Object.values(old)) revokeUrl(url);
    } catch (e) {
      set({ error: `Your projects couldn't be listed. ${describeError(e)}` });
    }
  }

  async function openById(id: string): Promise<boolean> {
    if (current?.id === id) {
      useShellStore.getState().closePanel();
      return true;
    }
    try {
      const session = await ProjectSession.openById(id, sessionDeps);
      await switchTo(session);
      return true;
    } catch (e) {
      set({ error: describeError(e) });
      return false;
    }
  }

  async function importText(text: string): Promise<boolean> {
    // Counts as an edit here, so the copy lists first.
    const result = await ProjectSession.importFile(text, { ...sessionDeps, now: sessionDeps.now ?? Date.now });
    if (!result.ok) {
      set({ error: result.errors[0] ?? "That file couldn't be imported." });
      return false;
    }
    return openById(result.id);
  }

  /**
   * Reopen the open project from the store when the store's copy is newer (or `force`), as
   * long as nothing here is unsaved and no Claude turn is using the bus.
   */
  async function reloadIfNewer(force = false): Promise<void> {
    const session = current;
    if (!session || !session.isPersisted || session.isDirty || deps.isBusy?.()) return;
    let stored;
    try {
      stored = await deps.store.load(session.id);
    } catch {
      return;
    }
    if (!stored || current !== session || session.isDirty) return;
    if (!force && stored.meta.updatedAt <= session.meta.updatedAt) return;
    try {
      const next = await ProjectSession.openById(session.id, sessionDeps);
      if (current === session && !session.isDirty) await switchTo(next);
    } catch {
      // The open project stays as it is.
    }
  }

  let resyncing: Promise<void> | null = null;
  function resync(): Promise<void> {
    if (!deps.sync) return Promise.resolve();
    // focus, visibilitychange and online often fire together: one run at a time.
    resyncing ??= (async () => {
      try {
        deps.sync?.retry();
        await refreshList();
        await serial(() => reloadIfNewer());
      } finally {
        resyncing = null;
      }
    })();
    return resyncing;
  }

  const onPageHide = () => void current?.flush();
  const onVisibility = () => {
    if (target?.document?.visibilityState === 'hidden') void current?.flush();
    else if (target?.document?.visibilityState === 'visible') void resync();
  };
  const onForeground = () => void resync();
  const target = deps.target ?? (typeof window === 'undefined' ? undefined : window);
  target?.addEventListener('pagehide', onPageHide);
  target?.addEventListener('visibilitychange', onVisibility);
  if (deps.sync) {
    target?.addEventListener('focus', onForeground);
    target?.addEventListener('online', onForeground);
  }

  // Sync notes: one when the cloud goes away, one when everything has gone through again.
  let offlineNoted = false;
  const onSync = (status: SyncStatus) => {
    set({ sync: status });
    if (status.kind === 'offline' && !offlineNoted) {
      offlineNoted = true;
      deps.notify?.(offlineNote(status));
    } else if (status.kind === 'synced' && offlineNoted) {
      offlineNoted = false;
      deps.notify?.(SYNCED_NOTE);
    }
  };
  const offSync = deps.sync?.onStatus(onSync) ?? (() => {});
  const offConflict =
    deps.sync?.onConflict((conflict) => {
      const name = useProjectsStore.getState().projects.find((p) => p.id === conflict.id)?.name ?? current?.meta.name ?? 'This project';
      deps.notify?.(conflictNote(conflict, name));
      void refreshList();
      if (current?.id === conflict.id) void serial(() => reloadIfNewer(true));
    }) ?? (() => {});
  set({
    sync: deps.sync ? deps.sync.status : null,
    user: deps.user ? { displayName: deps.user.displayName, ...(deps.user.email ? { email: deps.user.email } : {}) } : null,
  });

  return {
    get current() {
      return current;
    },

    start(search = '') {
      return serial(async () => {
        const params = new URLSearchParams(search);
        if (params.get('sample') === 'pool-house') {
          // Dev and e2e: built from commands so the parts drop in, then autosaved like any project.
          const session = ProjectSession.newProject(sessionDeps, { name: SAMPLE_NAME });
          await switchTo(session);
          buildSample(session.bus, params.get('context') === '1');
        } else {
          await switchTo(await ProjectSession.open(sessionDeps));
        }
        await refreshList();
      });
    },

    openProject(id) {
      return serial(() => withBusy(() => openById(id)));
    },

    newProject() {
      return serial(() => withBusy(async () => switchTo(ProjectSession.newProject(sessionDeps))));
    },

    importFile(file) {
      return serial(() =>
        withBusy(async () => {
          let text: string;
          try {
            text = await file.text();
          } catch {
            set({ error: "That file couldn't be read." });
            return false;
          }
          return importText(text);
        }),
      );
    },

    openSample() {
      return serial(() =>
        withBusy(async () => {
          let text: string;
          try {
            text = await loadSample();
          } catch {
            set({ error: "The sample couldn't be loaded. Check your connection and try again." });
            deps.notify?.("The sample couldn't be loaded. Check your connection and try again.");
            return false;
          }
          return importText(text);
        }),
      );
    },

    async save() {
      const session = current;
      if (!session) return;
      const result = await session.save({ name: session.project.name });
      deps.notify?.(result.ok ? result.message : result.needsName ? 'Give the project a name to save it.' : result.message);
    },

    async prepareList() {
      await refreshList();
      await captureThumbnail(THUMBNAIL_WAIT_MS);
      await refreshList();
    },

    refreshList,
    captureThumbnail,

    clearError() {
      set({ error: null });
    },

    chatLogFor(bus) {
      return current && current.bus === bus ? (current.chat as ChatLogLike) : null;
    },

    onChatChanged(log) {
      try {
        current?.replaceChat(log as ChatLog);
      } catch {
        deps.notify?.("This conversation couldn't be saved with the project.");
      }
    },

    resync,

    async signOut() {
      await current?.flush();
      if (deps.sync) {
        await Promise.race([deps.sync.idle(), new Promise((resolve) => setTimeout(resolve, SIGN_OUT_SYNC_WAIT_MS))]);
      }
      await deps.auth?.signOut();
      (deps.reload ?? (() => window.location.reload()))();
    },

    async dispose() {
      target?.removeEventListener('pagehide', onPageHide);
      target?.removeEventListener('visibilitychange', onVisibility);
      target?.removeEventListener('focus', onForeground);
      target?.removeEventListener('online', onForeground);
      offSync();
      offConflict();
      offStatus();
      await current?.close();
      for (const url of Object.values(useProjectsStore.getState().thumbnails)) revokeUrl(url);
    },
  };
}
