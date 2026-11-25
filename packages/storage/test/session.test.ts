import { SAMPLE_CATALOG } from '@slapdash/core';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalBackend } from '../src/adapters/local/index.ts';
import { StorageError } from '../src/errors.ts';
import { ProjectSession, type SessionDeps } from '../src/session.ts';
import type { StorageBackend } from '../src/types.ts';
import { allBytes, fixedClock, sequentialIds } from '../testing/index.ts';

const open: { close(): void }[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const b of open.splice(0)) b.close();
});

function backendOn(factory: IDBFactory) {
  const b = createLocalBackend({ indexedDB: factory, IDBKeyRange, now: fixedClock(1_000) });
  open.push(b);
  return b;
}

function deps(b: StorageBackend, extra: Partial<SessionDeps> = {}): SessionDeps {
  return { store: b.store, device: b.device, catalog: SAMPLE_CATALOG, now: fixedClock(), newId: sequentialIds('p'), ...extra };
}

/** Build a small wall: an assembly, two studs and a joint, as three undo steps. */
function buildWall(s: ProjectSession): void {
  const bus = s.bus;
  expect(bus.execute('add_assembly', { name: 'South wall', kind: 'wall' }).ok).toBe(true);
  bus.group({ label: 'Two studs', source: 'claude', turnId: 't1' }, () => {
    for (const x of [0, '16in']) {
      bus.execute('add_part', { assemblyId: 'W1', role: 'stud', materialId: 'spf-no2', sectionId: '2x4', position: { x, y: 0, z: 0 }, length: '8ft' });
    }
  });
  expect(bus.execute('connect', { jointTypeId: 'post-base', partIds: ['W1-S01', 'GROUND'], at: { x: 0, y: 0, z: 0 } }).ok).toBe(true);
}

describe('ProjectSession', () => {
  it('reloading the page restores the last project: model, undo history, versions and chat', async () => {
    const factory = new IDBFactory();
    const first = backendOn(factory);
    const s1 = await ProjectSession.open(deps(first));
    buildWall(s1);
    expect(s1.bus.saveVersion('wall up').ok).toBe(true);
    s1.appendChat({ role: 'user', content: 'Build a south wall', turnId: 't1' });
    s1.appendChat({ role: 'assistant', content: [{ type: 'text', text: 'Done.' }], turnId: 't1' });
    expect(await s1.flush()).toEqual({ ok: true, saved: true });
    const beforeReload = { project: s1.project, history: s1.bus.listHistory(), versions: s1.bus.listVersions(), chat: s1.chat };
    await s1.close();
    first.close();

    // "Reload": a brand-new backend and session on the same IndexedDB.
    const second = backendOn(factory);
    const s2 = await ProjectSession.open(deps(second));
    expect(s2.id).toBe(s1.id);
    expect(s2.project).toEqual(beforeReload.project);
    expect(s2.bus.listHistory()).toEqual(beforeReload.history);
    expect(s2.bus.listVersions()).toEqual(beforeReload.versions);
    expect(s2.chat).toEqual(beforeReload.chat);
    expect(s2.isDirty).toBe(false);

    // Undo still works after the reload and goes back to the earlier state.
    expect(s2.bus.undo().ok).toBe(true);
    expect(Object.keys(s2.project.joints)).toEqual([]);
    expect(s2.bus.undo().ok).toBe(true);
    expect(Object.keys(s2.project.parts)).toEqual([]);
    expect(s2.bus.restoreVersion('wall up').ok).toBe(true);
    expect(Object.keys(s2.project.parts)).toHaveLength(2);
    await s2.close();
  });

  it('first run gives an unnamed "New project" and writes nothing until the first change', async () => {
    const b = backendOn(new IDBFactory());
    const save = vi.spyOn(b.store, 'save');
    const s = await ProjectSession.open(deps(b));
    expect(s.project.name).toBe('New project');
    expect(s.meta.named).toBe(false);
    expect(s.isPersisted).toBe(false);
    expect(await s.flush()).toEqual({ ok: true, saved: false });
    expect(save).not.toHaveBeenCalled();
    expect(await b.store.list()).toEqual([]);
    expect(await b.device.getLastProjectId()).toBeNull();

    s.bus.execute('add_assembly', { name: 'Deck', kind: 'floor' });
    await s.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect((await b.store.list()).map((p) => p.name)).toEqual(['New project']);
    expect(await b.device.getLastProjectId()).toBe(s.id);
    await s.close();
  });

  it('autosave is debounced: several quick changes give one save', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const b = backendOn(new IDBFactory());
    const save = vi.spyOn(b.store, 'save');
    const s = await ProjectSession.open(deps(b, { debounceMs: 500 }));
    s.bus.execute('add_assembly', { name: 'A', kind: 'wall' });
    await vi.advanceTimersByTimeAsync(200);
    s.bus.execute('add_assembly', { name: 'B', kind: 'wall' });
    await vi.advanceTimersByTimeAsync(200);
    s.appendChat({ role: 'user', content: 'hi' });
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await s.flush()).toEqual({ ok: true, saved: false }); // waits for the autosave to finish
    expect(s.isDirty).toBe(false);
    expect(s.status.kind).toBe('saved');

    s.bus.undo();
    await s.flush(); // forced, before the timer
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(2);
    await s.close();
  });

  it('waits for an open bus group (a Claude turn) to close before saving', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const b = backendOn(new IDBFactory());
    const save = vi.spyOn(b.store, 'save');
    const s = await ProjectSession.open(deps(b, { debounceMs: 100 }));
    s.bus.beginGroup({ label: 'Turn', source: 'claude', turnId: 't9' });
    s.bus.execute('add_assembly', { name: 'A', kind: 'wall' });
    await vi.advanceTimersByTimeAsync(500);
    expect(save).not.toHaveBeenCalled();
    s.bus.endGroup();
    await vi.advanceTimersByTimeAsync(150);
    expect(save).toHaveBeenCalledTimes(1);
    await s.flush();
    expect((await b.store.load(s.id))!.history!.undo.map((e) => e.label)).toEqual(['Turn']);
    await s.close();
  });

  it('Save asks for a name the first time, then renames (undoably) and confirms', async () => {
    const b = backendOn(new IDBFactory());
    const s = await ProjectSession.open(deps(b));
    s.bus.execute('add_assembly', { name: 'A', kind: 'wall' });

    expect(await s.save()).toEqual({ ok: false, needsName: true, suggestedName: 'New project' });
    expect(await s.save({ name: '   ' })).toMatchObject({ ok: false, needsName: true });

    expect(await s.save({ name: '  Pool house ' })).toEqual({ ok: true, message: 'Saved "Pool house".' });
    expect(s.project.name).toBe('Pool house');
    expect(s.meta).toMatchObject({ name: 'Pool house', named: true });
    const stored = await b.store.load(s.id);
    expect(stored!.meta).toMatchObject({ name: 'Pool house', named: true });
    expect(stored!.project.name).toBe('Pool house');
    expect((await b.store.list())[0]).toMatchObject({ name: 'Pool house', named: true });

    expect(s.bus.listHistory().at(-1)!.label).toBe('Name the project');
    s.bus.undo();
    expect(s.project.name).toBe('New project');
    s.bus.redo();

    expect(await s.save()).toEqual({ ok: true, message: 'Saved "Pool house".' });
    expect((await s.save({ name: 'x'.repeat(200) })).ok).toBe(false);
    expect(s.project.name).toBe('Pool house');
    await s.close();
  });

  it('a rename by Claude updates the stored name', async () => {
    const b = backendOn(new IDBFactory());
    const s = await ProjectSession.open(deps(b));
    s.bus.execute('rename_project', { name: 'Garden shed' });
    await s.flush();
    expect((await b.store.list())[0]!.name).toBe('Garden shed');
    await s.close();
  });

  it('export then import round-trips exactly, including files', async () => {
    const a = backendOn(new IDBFactory());
    const s = await ProjectSession.open(deps(a, { now: () => 42_000 }));
    buildWall(s);
    s.bus.saveVersion('v1', 'note');
    s.bus.undo();
    s.appendChat({ role: 'user', content: 'see photo', turnId: 't1' });
    s.setChatSummary('Earlier: talked about the site.');
    await s.save({ name: 'Pool house' });
    await a.store.files.put(s.id, { name: 'site.jpg', mimeType: 'image/jpeg', bytes: allBytes(10) });
    await a.store.files.put(s.id, { name: 'empty.bin', mimeType: 'application/octet-stream', bytes: new Uint8Array() });

    const exported = await s.exportFile();
    expect(exported.fileName).toBe('pool-house.slapdash');
    expect(exported.mimeType).toBe('application/vnd.slapdash+json');

    const b = backendOn(new IDBFactory());
    const imported = await ProjectSession.importFile(exported.text, { store: b.store, newId: () => 'imported-1' });
    expect(imported).toEqual({ ok: true, id: 'imported-1', name: 'Pool house' });

    const original = await a.store.load(s.id);
    const copy = await b.store.load('imported-1');
    const { id: _a, ...origBody } = original!;
    const { id: _b, ...copyBody } = copy!;
    expect(copyBody).toEqual(origBody);

    const origFiles = await Promise.all((await a.store.files.list(s.id)).map((f) => a.store.files.get(s.id, f.id)));
    const copyFiles = await Promise.all((await b.store.files.list('imported-1')).map((f) => b.store.files.get('imported-1', f.id)));
    expect(copyFiles.map((f) => ({ ...f, projectId: 'x' }))).toEqual(origFiles.map((f) => ({ ...f, projectId: 'x' })));

    // Exporting the imported project gives identical text (fixed clock).
    const s2 = await ProjectSession.openById('imported-1', deps(b, { now: () => 42_000 }));
    expect(await b.device.getLastProjectId()).toBe('imported-1');
    expect((await s2.exportFile()).text).toBe(exported.text);
    // Undo and redo still work on the imported copy.
    expect(s2.bus.undo().ok).toBe(true);
    expect(s2.project.name).toBe('New project');
    expect(s2.bus.redo().ok).toBe(true);
    await s.close();
    await s2.close();
  });

  it('import of a bad file stores nothing and explains why', async () => {
    const b = backendOn(new IDBFactory());
    const res = await ProjectSession.importFile('{"format":"slapdash","formatVersion":3}', { store: b.store });
    expect(res).toEqual({ ok: false, errors: [expect.stringContaining('newer Slapdash')] });
    expect(await b.store.list()).toEqual([]);
  });

  it('a failed save sets an error status and keeps the changes; the next flush retries', async () => {
    const b = backendOn(new IDBFactory());
    const real = b.store.save.bind(b.store);
    const save = vi
      .spyOn(b.store, 'save')
      .mockImplementationOnce(() => Promise.reject(new StorageError('unavailable', "This browser's storage isn't available right now (test).")))
      .mockImplementation(real);
    const s = await ProjectSession.open(deps(b));
    const statuses: string[] = [];
    s.onStatus((st) => statuses.push(st.kind));
    s.bus.execute('add_assembly', { name: 'A', kind: 'wall' });

    const failed = await s.flush();
    expect(failed.ok).toBe(false);
    expect(s.status).toEqual({
      kind: 'error',
      message: "Your latest changes aren't saved yet. This browser's storage isn't available right now (test).",
    });
    expect(s.isDirty).toBe(true);

    expect(await s.flush()).toEqual({ ok: true, saved: true });
    expect(s.status.kind).toBe('saved');
    expect(s.isDirty).toBe(false);
    expect(save).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(['saving', 'error', 'saving', 'saved']);
    expect(Object.keys((await b.store.load(s.id))!.project.assemblies)).toEqual(['W1']);
    await s.close();
  });

  it('saves never overlap; a flush during a save runs after it', async () => {
    const b = backendOn(new IDBFactory());
    let inFlight = 0;
    let maxInFlight = 0;
    const real = b.store.save.bind(b.store);
    vi.spyOn(b.store, 'save').mockImplementation(async (r) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        return await real(r);
      } finally {
        inFlight--;
      }
    });
    const s = await ProjectSession.open(deps(b));
    s.bus.execute('add_assembly', { name: 'A', kind: 'wall' });
    const p1 = s.flush();
    s.bus.execute('add_assembly', { name: 'B', kind: 'wall' });
    const p2 = s.flush();
    await Promise.all([p1, p2]);
    expect(maxInFlight).toBe(1);
    expect(Object.keys((await b.store.load(s.id))!.project.assemblies)).toEqual(['W1', 'W2']);
    await s.close();
  });

  it('a damaged last project opens a new project with an error status instead of crashing', async () => {
    const factory = new IDBFactory();
    const b = backendOn(factory);
    const s1 = await ProjectSession.open(deps(b));
    s1.bus.execute('add_assembly', { name: 'A', kind: 'wall' });
    await s1.close();
    await b.db.bodies.update(s1.id, { meta: { broken: true } as never });

    const s2 = await ProjectSession.open(deps(b, { newId: () => 'fresh' }));
    expect(s2.id).toBe('fresh');
    expect(s2.project.name).toBe('New project');
    expect(s2.status.kind).toBe('error');
    expect((s2.status as { message: string }).message).toMatch(/^Your last project couldn't be opened, so a new one was started\./);
    await s2.close();
  });

  it('openById of a missing project throws a not_found StorageError', async () => {
    const b = backendOn(new IDBFactory());
    await expect(ProjectSession.openById('nope', deps(b))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('chat: appended messages get ids and times; summary keeps the last N messages', async () => {
    const b = backendOn(new IDBFactory());
    const s = await ProjectSession.open(deps(b, { now: () => 5, newId: sequentialIds('m') }));
    const m = s.appendChat({ role: 'user', content: { any: ['json', 1, null] } });
    expect(m).toEqual({ id: 'm-2', role: 'user', at: 5, content: { any: ['json', 1, null] } });
    s.appendChat({ role: 'assistant', content: 'two' });
    s.appendChat({ role: 'user', content: 'three' });
    s.setChatSummary('Old stuff.', 1);
    expect(s.chat).toEqual({ version: 1, summary: 'Old stuff.', messages: [expect.objectContaining({ content: 'three' })] });
    expect(() => s.appendChat({ role: 'user', content: (() => 1) as never })).toThrow(StorageError);
    await s.flush();
    expect((await b.store.load(s.id))!.chat).toEqual(s.chat);
    await s.close();
  });

  it('chat: replaceChat stores a whole log with prefs; setChatSummary keeps the prefs', async () => {
    const b = backendOn(new IDBFactory());
    const s = await ProjectSession.open(deps(b, { now: () => 5, newId: sequentialIds('m') }));
    const log = {
      version: 1 as const,
      prefs: { confirmBigChanges: false },
      messages: [
        { id: 'a', role: 'user' as const, at: 1, turnId: 't1', content: [{ type: 'text', text: 'Build it' }] },
        { id: 'b', role: 'assistant' as const, at: 2, turnId: 't1', content: [{ type: 'text', text: 'Done.' }] },
      ],
    };
    s.replaceChat(log);
    expect(s.chat).toEqual(log);
    s.setChatSummary('Earlier.', 1);
    expect(s.chat.prefs).toEqual({ confirmBigChanges: false });
    expect(() => s.replaceChat({ version: 1, messages: [{ id: 'x', role: 'bot', at: 1, content: 1 }] } as never)).toThrow(StorageError);
    await s.flush();
    expect((await b.store.load(s.id))!.chat).toEqual(s.chat);
    await s.close();
  });

  it('newProject starts fresh without touching the last-project pointer', async () => {
    const b = backendOn(new IDBFactory());
    const shared = deps(b);
    const s1 = await ProjectSession.open(shared);
    s1.bus.execute('add_assembly', { name: 'A', kind: 'wall' });
    await s1.close();
    const s2 = ProjectSession.newProject(shared);
    expect(s2.id).not.toBe(s1.id);
    expect(await b.device.getLastProjectId()).toBe(s1.id);
    s2.bus.execute('add_assembly', { name: 'B', kind: 'wall' });
    await s2.close();
    expect(await b.device.getLastProjectId()).toBe(s2.id);
    expect(await b.store.list()).toHaveLength(2);
  });
});
