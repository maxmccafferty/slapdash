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
  type ChatLog,
  type DeviceState,
  type ProjectStore,
  type SaveStatus,
  type SessionDeps,
} from '@slapdash/storage';
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
  dispose(): Promise<void>;
}

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

  const onPageHide = () => void current?.flush();
  const onVisibility = () => {
    if (target?.document?.visibilityState === 'hidden') void current?.flush();
  };
  const target = deps.target ?? (typeof window === 'undefined' ? undefined : window);
  target?.addEventListener('pagehide', onPageHide);
  target?.addEventListener('visibilitychange', onVisibility);

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

    async dispose() {
      target?.removeEventListener('pagehide', onPageHide);
      target?.removeEventListener('visibilitychange', onVisibility);
      offStatus();
      await current?.close();
      for (const url of Object.values(useProjectsStore.getState().thumbnails)) revokeUrl(url);
    },
  };
}
