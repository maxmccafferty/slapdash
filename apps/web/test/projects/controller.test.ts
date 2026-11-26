import { TIER1_CATALOG } from '@slapdash/catalog';
import { AgentMemory } from '@slapdash/agent';
import { CommandBus, createProject } from '@slapdash/core';
import { createLocalBackend } from '@slapdash/storage/local';
import { CLOUD_UNAVAILABLE_MESSAGE, ProjectSession, type Auth, type SyncConflict, type SyncControl, type SyncStatus } from '@slapdash/storage';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectsController, type ProjectsController, type ProjectsControllerDeps } from '../../src/projects/projects-controller.ts';
import { resetProjectsStore, useProjectsStore } from '../../src/projects/projects-store.ts';
import { buildSampleText } from '../../src/samples/build.ts';
import { resetModelStore, useModelStore } from '../../src/state/model-store.ts';
import { useShellStore } from '../../src/state/shell-store.ts';
import { OFFLINE_NOTE, SYNCED_NOTE } from '../../src/sync/sync-status.ts';

const SAMPLE = buildSampleText();
const open: { close(): void }[] = [];
const controllers: ProjectsController[] = [];

beforeEach(() => {
  resetModelStore();
  resetProjectsStore();
});

afterEach(async () => {
  for (const c of controllers.splice(0)) await c.dispose();
  for (const b of open.splice(0)) b.close();
});

function setup(extra: Partial<ProjectsControllerDeps> = {}, factory = new IDBFactory()) {
  const backend = createLocalBackend({ indexedDB: factory, IDBKeyRange });
  open.push(backend);
  const notes: string[] = [];
  const target = new EventTarget() as EventTarget & { document?: { visibilityState: DocumentVisibilityState } };
  let n = 0;
  const controller = createProjectsController({
    store: backend.store,
    device: backend.device,
    catalog: TIER1_CATALOG,
    loadSample: async () => SAMPLE,
    renderThumbnail: async () => null,
    notify: (t) => notes.push(t),
    createUrl: () => `blob:thumb-${++n}`,
    revokeUrl: () => {},
    debounceMs: 10_000,
    target: target as never,
    ...extra,
  });
  controllers.push(controller);
  return { controller, backend, notes, target, factory };
}

const partCount = () => Object.keys(useModelStore.getState().project?.parts ?? {}).length;

describe('the projects controller', () => {
  it('first run: an unsaved, empty "New project" and nothing listed', async () => {
    const { controller } = setup();
    await controller.start('');
    expect(controller.current?.isPersisted).toBe(false);
    expect(useModelStore.getState().project?.name).toBe('New project');
    expect(useModelStore.getState().bus).toBe(controller.current?.bus);
    expect(partCount()).toBe(0);
    expect(useProjectsStore.getState().projects).toEqual([]);
    expect(useProjectsStore.getState().currentId).toBe(controller.current?.id);
  });

  it('opens the sample as a new stored project named "Pool house"', async () => {
    const { controller } = setup();
    await controller.start('');
    useShellStore.getState().togglePanel('projects');
    expect(await controller.openSample()).toBe(true);
    expect(useModelStore.getState().project?.name).toBe('Pool house');
    expect(partCount()).toBeGreaterThan(100);
    expect(useShellStore.getState().panel).toBeNull();
    await controller.refreshList();
    expect(useProjectsStore.getState().projects.map((p) => p.name)).toEqual(['Pool house']);
  });

  it('?sample=pool-house builds the sample from commands, as a named project', async () => {
    const { controller } = setup();
    await controller.start('?sample=pool-house');
    expect(controller.current?.meta).toMatchObject({ name: 'Pool house', named: true });
    expect(partCount()).toBeGreaterThan(100);
  });

  it('New project, then open the sample again from the list; a reload reopens the last project', async () => {
    const { controller, factory } = setup();
    await controller.start('');
    await controller.openSample();
    const sampleId = controller.current!.id;
    await controller.newProject();
    expect(useModelStore.getState().project?.name).toBe('New project');
    expect(partCount()).toBe(0);
    expect(await controller.openProject(sampleId)).toBe(true);
    expect(controller.current?.id).toBe(sampleId);
    expect(partCount()).toBeGreaterThan(100);

    // Reload: a new controller on the same database.
    await controller.dispose();
    controllers.splice(controllers.indexOf(controller), 1);
    resetModelStore();
    const again = setup({}, factory);
    await again.controller.start('');
    expect(again.controller.current?.id).toBe(sampleId);
    expect(useModelStore.getState().project?.name).toBe('Pool house');
  });

  it('changes are kept: an edit autosaves when switching away and comes back', async () => {
    const { controller } = setup();
    await controller.start('');
    const bus = controller.current!.bus;
    expect(bus.execute('pour_slab', { from: { x: 0, z: 0 }, to: { x: '10ft', z: '12ft' } }).ok).toBe(true);
    const id = controller.current!.id;
    await controller.newProject();
    await controller.openProject(id);
    expect(partCount()).toBeGreaterThan(0);
  });

  it('a bad import is refused with a plain message and nothing changes', async () => {
    const { controller } = setup();
    await controller.start('');
    const before = controller.current;
    expect(await controller.importFile(new Blob(['not a project']))).toBe(false);
    expect(useProjectsStore.getState().error).toMatch(/\S/);
    expect(controller.current).toBe(before);
    controller.clearError();
    expect(useProjectsStore.getState().error).toBeNull();
  });

  it('imports a .slapdash file as a new project', async () => {
    const { controller } = setup();
    await controller.start('');
    expect(await controller.importFile(new Blob([SAMPLE]))).toBe(true);
    expect(await controller.importFile(new Blob([SAMPLE]))).toBe(true);
    await controller.refreshList();
    expect(useProjectsStore.getState().projects.map((p) => p.name)).toEqual(['Pool house', 'Pool house']);
  });

  it('opening a missing project explains why', async () => {
    const { controller } = setup();
    await controller.start('');
    expect(await controller.openProject('nope')).toBe(false);
    expect(useProjectsStore.getState().error).toMatch(/couldn't be found/);
  });

  it('saves the chat with the project and gives it back for that bus', async () => {
    const { controller } = setup();
    await controller.start('');
    await controller.openSample();
    const id = controller.current!.id;
    const memory = new AgentMemory();
    memory.beginTurn('t1', [{ type: 'text', text: 'How tall are the walls?' }]);
    memory.append('assistant', [{ type: 'text', text: '9 feet.' }]);
    memory.endTurn({ asked: 'How tall are the walls?', changeSummaries: [] });
    controller.onChatChanged(memory.toChatLog());
    await controller.newProject();
    expect(controller.chatLogFor(controller.current!.bus)?.messages).toEqual([]);
    await controller.openProject(id);
    const log = controller.chatLogFor(useModelStore.getState().bus!);
    expect(new AgentMemory(log!).transcript()).toEqual([{ turnId: 't1', asked: 'How tall are the walls?', reply: '9 feet.' }]);
    // Another bus isn't this project's.
    expect(controller.chatLogFor(new CommandBus({ project: createProject({ name: 'Other' }), catalog: TIER1_CATALOG }))).toBeNull();
  });

  it('stores a card picture for a built project and lists it', async () => {
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    const { controller, backend } = setup({ renderThumbnail: async () => png });
    await controller.start('');
    await controller.prepareList();
    expect(useProjectsStore.getState().thumbnails).toEqual({});
    await controller.openSample();
    const id = controller.current!.id;
    await controller.prepareList();
    expect(await backend.store.files.get(id, ProjectSession.THUMBNAIL_FILE_ID)).not.toBeNull();
    expect(useProjectsStore.getState().thumbnails[id]).toMatch(/^blob:thumb-/);
  });

  it('saves on pagehide', async () => {
    const { controller, backend, target } = setup();
    await controller.start('');
    controller.current!.bus.execute('pour_slab', { from: { x: 0, z: 0 }, to: { x: '10ft', z: '12ft' } });
    target.dispatchEvent(new Event('pagehide'));
    await controller.current!.flush();
    expect((await backend.store.list()).map((p) => p.name)).toEqual(['New project']);
  });

  it('Save names and saves the project, and says so in the chat', async () => {
    const { controller, notes } = setup();
    await controller.start('');
    await controller.openSample();
    await controller.save();
    expect(notes).toEqual(['Saved "Pool house".']);
  });
});

/** A stand-in for the synced backend's sync control. */
function fakeSync() {
  const statusListeners = new Set<(s: SyncStatus) => void>();
  const conflictListeners = new Set<(c: SyncConflict) => void>();
  let status: SyncStatus = { kind: 'synced' };
  const sync: SyncControl = {
    get status() {
      return status;
    },
    onStatus: (fn) => (statusListeners.add(fn), () => void statusListeners.delete(fn)),
    onConflict: (fn) => (conflictListeners.add(fn), () => void conflictListeners.delete(fn)),
    retry: vi.fn(),
    idle: vi.fn(async () => {}),
  };
  return {
    sync,
    emit(next: SyncStatus) {
      status = next;
      for (const fn of statusListeners) fn(next);
    },
    conflict(c: SyncConflict) {
      for (const fn of conflictListeners) fn(c);
    },
  };
}

describe('the projects controller with cloud sync (hosted copy)', () => {
  it('notes going offline once, and "Synced." when it is back', async () => {
    const fake = fakeSync();
    const { controller, notes } = setup({ sync: fake.sync });
    await controller.start('');
    expect(useProjectsStore.getState().sync).toEqual({ kind: 'synced' });
    fake.emit({ kind: 'offline', message: CLOUD_UNAVAILABLE_MESSAGE, pending: 1 });
    fake.emit({ kind: 'offline', message: CLOUD_UNAVAILABLE_MESSAGE, pending: 2 });
    fake.emit({ kind: 'syncing', pending: 2 });
    fake.emit({ kind: 'synced' });
    expect(notes).toEqual([OFFLINE_NOTE, SYNCED_NOTE]);
    expect(useProjectsStore.getState().sync).toEqual({ kind: 'synced' });
  });

  it('back in the foreground: pushes, lists, and reopens the open project when another device changed it', async () => {
    const fake = fakeSync();
    const { controller, backend, target } = setup({ sync: fake.sync });
    await controller.start('');
    await controller.openSample();
    const id = controller.current!.id;
    const before = controller.current!;
    const firstBus = useModelStore.getState().bus;

    // Another device saved a newer copy, which sync put in the store.
    const stored = (await backend.store.load(id))!;
    await backend.store.save({
      ...stored,
      meta: { ...stored.meta, name: 'Pool house v2', updatedAt: stored.meta.updatedAt + 60_000 },
      project: { ...stored.project, name: 'Pool house v2' },
    });

    target.dispatchEvent(new Event('focus'));
    await controller.resync();
    expect(fake.sync.retry).toHaveBeenCalled();
    expect(controller.current).not.toBe(before);
    expect(controller.current!.id).toBe(id);
    expect(controller.current!.meta.name).toBe('Pool house v2');
    expect(useModelStore.getState().bus).not.toBe(firstBus);
    expect(useProjectsStore.getState().projects.map((p) => p.name)).toEqual(['Pool house v2']);
  });

  it('does not reopen over unsaved changes or while Claude is working', async () => {
    const fake = fakeSync();
    let busy = true;
    const { controller, backend } = setup({ sync: fake.sync, isBusy: () => busy });
    await controller.start('');
    await controller.openSample();
    const session = controller.current!;
    const stored = (await backend.store.load(session.id))!;
    await backend.store.save({ ...stored, meta: { ...stored.meta, updatedAt: stored.meta.updatedAt + 60_000 } });
    await controller.resync();
    expect(controller.current).toBe(session);
    busy = false;
    expect(session.bus.execute('rename_project', { name: 'Edited here' }).ok).toBe(true);
    expect(session.isDirty).toBe(true);
    await controller.resync();
    expect(controller.current).toBe(session);
  });

  it('a conflict on the open project says where the other version went and reopens it', async () => {
    const fake = fakeSync();
    const { controller, backend, notes } = setup({ sync: fake.sync });
    await controller.start('');
    await controller.openSample();
    const session = controller.current!;
    await controller.refreshList();
    fake.conflict({ id: session.id, copyId: 'copy-1', copyName: 'Pool house (conflict, this device)' });
    await vi.waitFor(() => expect(controller.current).not.toBe(session));
    expect(notes.at(-1)).toMatch(/^"Pool house" was also changed on another device\..*"Pool house \(conflict, this device\)"\.$/);
    expect(await backend.store.load(session.id)).not.toBeNull();
  });

  it('Sign out saves, waits for sync, signs out and reloads', async () => {
    const fake = fakeSync();
    const order: string[] = [];
    const auth = { signOut: vi.fn(async () => void order.push('signOut')) } as unknown as Auth;
    (fake.sync.idle as ReturnType<typeof vi.fn>).mockImplementation(async () => void order.push('idle'));
    const reload = vi.fn(() => void order.push('reload'));
    const user = { id: 'u1', displayName: 'max@example.com', email: 'max@example.com' };
    const { controller, backend } = setup({ sync: fake.sync, auth, user, reload });
    await controller.start('');
    expect(useProjectsStore.getState().user).toEqual({ displayName: 'max@example.com', email: 'max@example.com' });
    controller.current!.bus.execute('pour_slab', { from: { x: 0, z: 0 }, to: { x: '10ft', z: '12ft' } });
    await controller.signOut();
    expect(order).toEqual(['idle', 'signOut', 'reload']);
    expect((await backend.store.list()).map((p) => p.name)).toEqual(['New project']);
  });

  it('without sync, focus does nothing new', async () => {
    const { controller, target } = setup();
    await controller.start('');
    const session = controller.current;
    target.dispatchEvent(new Event('focus'));
    await controller.resync();
    expect(controller.current).toBe(session);
    expect(useProjectsStore.getState().sync).toBeNull();
  });
});
