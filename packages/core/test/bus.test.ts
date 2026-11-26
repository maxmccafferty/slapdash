import { describe, expect, it, vi } from 'vitest';
import { CommandBus, SAMPLE_CATALOG, createProject } from '../src/index.ts';
import { fixedClock, fixtureProject, makeBus } from './helpers.ts';

const wall = { name: 'South wall', kind: 'wall' };
const stud = (x = 0) => ({ assemblyId: 'W1', role: 'stud', materialId: 'spf-no2', sectionId: '2x4', position: { x, y: 0, z: 0 }, length: '8ft' });

describe('CommandBus.execute', () => {
  it('applies a command and records it as its own undo step', () => {
    const bus = makeBus();
    const res = bus.execute('add_assembly', wall);
    expect(res).toEqual({ ok: true, summary: 'Added wall W1 "South wall".', created: ['W1'] });
    expect(bus.listHistory()).toEqual([
      { id: 1, label: 'Added wall W1 "South wall".', source: 'user', at: expect.any(Number), summaries: ['Added wall W1 "South wall".'], isUndone: false },
    ]);
    expect(bus.undo()).toEqual({ ok: true, summary: 'Undid: Added wall W1 "South wall".' });
    expect(bus.project.assemblies).toEqual({});
    expect(bus.redo().ok).toBe(true);
    expect(bus.project.assemblies.W1).toBeDefined();
  });

  it('rejects unknown and internal commands with a suggestion', () => {
    const bus = makeBus();
    expect(bus.execute('add_prt', {})).toEqual({
      ok: false,
      errors: [{ code: 'unknown_command', message: `There's no command "add_prt".`, hint: 'Did you mean "add_part"?' }],
    });
    expect(bus.execute('replace_project', { project: createProject({ name: 'x' }) }).ok).toBe(false);
  });

  it('leaves state untouched on validation errors and does not record them', () => {
    const bus = makeBus();
    const before = bus.project;
    const res = bus.execute('add_part', stud());
    expect(res.ok).toBe(false);
    expect(bus.project).toBe(before);
    expect(bus.canUndo).toBe(false);
  });

  it('turns exceptions in apply into an internal error, state unchanged', async () => {
    const { commandRegistry } = await import('../src/commands/registry.ts');
    const def = commandRegistry.get('update_assembly')!;
    const spy = vi.spyOn(def, 'apply').mockImplementation(() => {
      throw new Error('boom');
    });
    const bus = makeBus(fixtureProject());
    const before = bus.project;
    const res = bus.execute('update_assembly', { id: 'W1', name: 'x' });
    spy.mockRestore();
    expect(res).toMatchObject({ ok: false, errors: [{ code: 'internal', message: expect.stringContaining('nothing was changed. (boom)') }] });
    expect(bus.project).toBe(before);
  });
});

describe('CommandBus.dryRun', () => {
  it('reports what execute would do without changing the project, history or listeners', () => {
    const bus = makeBus();
    const heard = vi.fn();
    bus.subscribe(heard);
    const before = bus.project;
    const dry = bus.dryRun('add_assembly', wall);
    expect(dry).toEqual({ ok: true, summary: 'Added wall W1 "South wall".', created: ['W1'] });
    expect(bus.project).toBe(before);
    expect(bus.canUndo).toBe(false);
    expect(bus.listHistory()).toEqual([]);
    expect(heard).not.toHaveBeenCalled();
    expect(bus.execute('add_assembly', wall)).toEqual(dry);
  });

  it('does not record into an open group', () => {
    const bus = makeBus();
    bus.beginGroup({ label: 'Turn', source: 'claude', turnId: 't1' });
    expect(bus.dryRun('add_assembly', wall).ok).toBe(true);
    expect(bus.endGroup()).toBeNull();
    expect(bus.project.assemblies).toEqual({});
  });

  it('reports the parts a builder would create', () => {
    const bus = makeBus();
    const dry = bus.dryRun('pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } });
    expect(dry.ok && dry.created).toEqual(['FD1', 'FD1-SB01', 'FD1-FT01', 'FD1-FT02', 'FD1-FT03', 'FD1-FT04']);
    expect(bus.project.parts).toEqual({});
  });

  it('returns the same errors as execute', () => {
    const bus = makeBus();
    expect(bus.dryRun('add_prt', {})).toEqual(bus.execute('add_prt', {}));
    expect(bus.dryRun('replace_project', {}).ok).toBe(false);
    expect(bus.dryRun('add_part', stud())).toEqual(bus.execute('add_part', stud()));
  });
});

describe('groups', () => {
  it('records N commands as one entry and undoes them in one step', () => {
    const bus = makeBus();
    const entry = bus.group({ label: 'Build a wall', source: 'claude', turnId: 't1' }, () => {
      bus.execute('add_assembly', wall);
      bus.execute('add_part', stud(0));
      bus.execute('add_part', stud(406.4));
      return 'done';
    });
    expect(entry).toBe('done');
    const history = bus.listHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ label: 'Build a wall', source: 'claude', turnId: 't1', isUndone: false });
    expect(history[0]!.summaries).toHaveLength(3);
    expect(Object.keys(bus.project.parts)).toHaveLength(2);
    bus.undo();
    expect(bus.project.assemblies).toEqual({});
    expect(bus.project.parts).toEqual({});
    expect(bus.canUndo).toBe(false);
    bus.redo();
    expect(Object.keys(bus.project.parts)).toEqual(['W1-S01', 'W1-S02']);
  });

  it('failed commands inside a group are reported, not recorded, and do not abort it', () => {
    const bus = makeBus();
    bus.beginGroup({ label: 'turn', source: 'claude' });
    expect(bus.execute('add_assembly', wall).ok).toBe(true);
    expect(bus.execute('add_part', { ...stud(), materialId: 'unobtainium' }).ok).toBe(false);
    expect(bus.execute('add_part', stud()).ok).toBe(true);
    const entry = bus.endGroup();
    expect(entry!.commands.map((c) => c.redo.name)).toEqual(['add_assembly', 'add_part']);
  });

  it('nested groups flatten into the outer one', () => {
    const bus = makeBus();
    bus.beginGroup({ label: 'outer', source: 'claude' });
    bus.execute('add_assembly', wall);
    bus.beginGroup({ label: 'inner', source: 'user' });
    bus.execute('add_part', stud());
    expect(bus.endGroup()).toBeNull();
    expect(bus.inGroup).toBe(true);
    const entry = bus.endGroup();
    expect(entry).toMatchObject({ label: 'outer', source: 'claude' });
    expect(entry!.commands).toHaveLength(2);
    expect(bus.listHistory()).toHaveLength(1);
  });

  it('an empty group records nothing', () => {
    const bus = makeBus();
    bus.beginGroup({ label: 'nothing', source: 'claude' });
    bus.execute('add_part', stud()); // fails: no W1
    expect(bus.endGroup()).toBeNull();
    expect(bus.listHistory()).toEqual([]);
    expect(bus.endGroup()).toBeNull(); // no open group
  });

  it('undo inside an open group commits the group first, then reopens it', () => {
    const bus = makeBus();
    bus.execute('add_assembly', wall);
    bus.beginGroup({ label: 'turn', source: 'claude', turnId: 't9' });
    bus.execute('add_part', stud());
    expect(bus.canUndo).toBe(true);
    expect(bus.undo()).toEqual({ ok: true, summary: 'Undid: turn' });
    expect(bus.project.parts).toEqual({});
    expect(bus.inGroup).toBe(true);
    // the group carries on with the same label
    bus.execute('add_part', stud(100));
    const entry = bus.endGroup();
    expect(entry).toMatchObject({ label: 'turn', source: 'claude', turnId: 't9' });
    expect(bus.listHistory().map((h) => [h.label, h.isUndone])).toEqual([
      ['Added wall W1 "South wall".', false],
      ['turn', false],
    ]);
    // undoing without anything new in the reopened group undoes the previous entry
    bus.beginGroup({ label: 'turn 2', source: 'claude' });
    bus.undo();
    bus.redo();
    expect(bus.endGroup()).toBeNull();
    expect(Object.keys(bus.project.parts)).toEqual(['W1-S02']);
  });
});

describe('undo / redo stacks', () => {
  it('a new command clears the redo stack', () => {
    const bus = makeBus();
    bus.execute('add_assembly', wall);
    bus.undo();
    expect(bus.canRedo).toBe(true);
    bus.execute('add_assembly', { name: 'Roof', kind: 'roof' });
    expect(bus.canRedo).toBe(false);
  });

  it('empty stacks give friendly messages', () => {
    const bus = makeBus();
    expect(bus.undo()).toEqual({ ok: false, errors: [{ code: 'not_allowed', message: 'Nothing to undo.' }] });
    expect(bus.redo()).toEqual({ ok: false, errors: [{ code: 'not_allowed', message: 'Nothing to redo.' }] });
  });

  it('an undone add never gives its ID to the next add', () => {
    const bus = makeBus();
    bus.execute('add_assembly', wall);
    bus.undo();
    expect(bus.execute('add_assembly', wall)).toMatchObject({ created: ['W2'] });
  });

  it('caps history, dropping the oldest entries', () => {
    const bus = makeBus(undefined, { historyLimit: 3 });
    for (let i = 0; i < 5; i++) bus.execute('add_assembly', { name: `a${i}`, kind: 'misc' });
    expect(bus.listHistory().map((h) => h.label)).toEqual([
      'Added misc M3 "a2".',
      'Added misc M4 "a3".',
      'Added misc M5 "a4".',
    ]);
    while (bus.canUndo) bus.undo();
    expect(Object.keys(bus.project.assemblies)).toEqual(['M1', 'M2']);
  });

  it('listHistory is chronological, marks undone entries, and respects limit', () => {
    const bus = makeBus();
    for (let i = 0; i < 4; i++) bus.execute('add_assembly', { name: `a${i}`, kind: 'misc' });
    bus.undo();
    bus.undo();
    const h = bus.listHistory();
    expect(h.map((e) => [e.label, e.isUndone])).toEqual([
      ['Added misc M1 "a0".', false],
      ['Added misc M2 "a1".', false],
      ['Added misc M3 "a2".', true],
      ['Added misc M4 "a3".', true],
    ]);
    expect(bus.listHistory(1)).toHaveLength(1);
    expect(h.map((e) => e.id)).toEqual([1, 2, 3, 4]);
  });
});

describe('versions', () => {
  it('saves, lists and restores versions; a restore can be undone', () => {
    const bus = makeBus(fixtureProject());
    expect(bus.saveVersion('  before roof ', 'walls only')).toEqual({ ok: true, summary: 'Saved version "before roof".' });
    bus.execute('delete_parts', { ids: ['W1-S01', 'W1-S02'] });
    const afterDelete = bus.project;
    expect(bus.listVersions()).toEqual([{ name: 'before roof', note: 'walls only', savedAt: expect.any(Number), partCount: 3, jointCount: 2 }]);

    expect(bus.restoreVersion('before roof')).toEqual({ ok: true, summary: 'Restored version "before roof".' });
    expect(Object.keys(bus.project.parts)).toHaveLength(3);
    expect(bus.listHistory().at(-1)!.label).toBe('Restored version "before roof"');

    bus.undo();
    expect(bus.project).toEqual(afterDelete);
    bus.redo();
    expect(Object.keys(bus.project.parts)).toHaveLength(3);
  });

  it('a restore does not roll back ID counters', () => {
    const bus = makeBus(createProject({ name: 't' }));
    bus.saveVersion('empty');
    bus.execute('add_assembly', wall);
    bus.restoreVersion('empty');
    expect(bus.execute('add_assembly', wall)).toMatchObject({ created: ['W2'] });
  });

  it('rejects duplicate, blank and unknown names', () => {
    const bus = makeBus();
    bus.saveVersion('v1');
    expect(bus.saveVersion('v1 ')).toEqual({
      ok: false,
      errors: [{ code: 'conflict', message: 'A version called "v1" already exists.', path: 'name', hint: 'Pick another name.' }],
    });
    expect(bus.saveVersion('  ').ok).toBe(false);
    expect(bus.restoreVersion('v2')).toEqual({
      ok: false,
      errors: [{ code: 'not_found', message: `There's no saved version "v2".`, path: 'name', hint: 'Did you mean "v1"?' }],
    });
  });

  it('restore inside a group commits the group first', () => {
    const bus = makeBus();
    bus.saveVersion('empty');
    bus.beginGroup({ label: 'turn', source: 'claude' });
    bus.execute('add_assembly', wall);
    bus.restoreVersion('empty');
    bus.endGroup();
    expect(bus.listHistory().map((h) => [h.label, h.source])).toEqual([
      ['turn', 'claude'],
      ['Restored version "empty"', 'claude'],
    ]);
  });
});

describe('subscribe', () => {
  it('notifies once per execute, undo, redo and restore', () => {
    const bus = makeBus();
    const events: string[] = [];
    const off = bus.subscribe((project, e) => events.push(`${e.type}:${Object.keys(project.assemblies).length}`));
    bus.execute('add_assembly', wall);
    bus.execute('add_part', { bad: true }); // failure: no event
    bus.saveVersion('v');
    bus.undo();
    bus.redo();
    bus.restoreVersion('v');
    off();
    bus.undo();
    expect(events).toEqual(['execute:1', 'undo:0', 'redo:1', 'restore:1']);
  });
});

describe('immutability', () => {
  it('freezes state and keeps unchanged parts by reference', () => {
    const bus = makeBus(fixtureProject());
    const before = bus.project;
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.parts['W1-S01']!.position)).toBe(true);
    expect(() => {
      (bus.project.parts['W1-S01']!.position as { x: number }).x = 5;
    }).toThrow();

    bus.execute('move_parts', { ids: ['W1-S01'], by: { x: 10, y: 0, z: 0 } });
    expect(bus.project).not.toBe(before);
    expect(bus.project.parts['W1-S01']).not.toBe(before.parts['W1-S01']);
    expect(bus.project.parts['W1-S02']).toBe(before.parts['W1-S02']);
    expect(bus.project.joints).toBe(before.joints);
    expect(bus.project.assemblies).toBe(before.assemblies);
  });
});

describe('serialize / hydrate', () => {
  it('round-trips history and versions through JSON', () => {
    const clock = fixedClock();
    const bus = new CommandBus({ project: createProject({ name: 't' }), catalog: SAMPLE_CATALOG, now: clock });
    bus.execute('add_assembly', wall);
    bus.saveVersion('one');
    bus.execute('add_part', stud());
    bus.undo();
    const data = JSON.parse(JSON.stringify(bus.serialize()));
    const copy = CommandBus.hydrate({ project: JSON.parse(JSON.stringify(bus.project)), catalog: SAMPLE_CATALOG, now: clock }, data);
    expect(copy.listHistory()).toEqual(bus.listHistory());
    expect(copy.listVersions()).toEqual(bus.listVersions());
    copy.redo();
    expect(Object.keys(copy.project.parts)).toEqual(['W1-S01']);
    copy.undo();
    copy.undo();
    expect(copy.project.assemblies).toEqual({});
    expect(copy.restoreVersion('one').ok).toBe(true);
    expect(copy.execute('add_assembly', wall)).toMatchObject({ created: ['W2'] });
  });
});

describe('CommandBus siteDefaults', () => {
  it('reads the site defaults each time a command runs', () => {
    let defaults: { location: { label: string }; table: Record<string, { label: string; loads: { groundSnow: { value: number; unit: 'kPa'; source: string } } }> } | undefined;
    const bus = new CommandBus({ project: createProject({ name: 't' }), catalog: SAMPLE_CATALOG, now: fixedClock(), siteDefaults: () => defaults });
    bus.execute('pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } });
    const first = bus.execute('build_wall', { start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '9ft', openings: [{ kind: 'window', centerAt: '8ft' }] });
    expect(first.ok && first.summary).toContain('the default 30 psf ground snow load');
    defaults = { location: { label: 'Snowy, ST' }, table: { 'snowy, st': { label: 'Snowy, ST', loads: { groundSnow: { value: 2.394, unit: 'kPa', source: 'test' } } } } };
    const second = bus.execute('build_wall', { start: { x: '20ft', z: 0 }, end: { x: '20ft', z: '16ft' }, height: '9ft', openings: [{ kind: 'window', centerAt: '8ft' }] });
    expect(second.ok && second.summary).toContain("Snowy, ST's 50 psf ground snow load (test)");
  });
});
