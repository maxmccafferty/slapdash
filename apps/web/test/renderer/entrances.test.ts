import { describe, expect, it } from 'vitest';
import { CommandBus, createProject } from '@slapdash/core';
import { CATALOG } from '@slapdash/catalog';
import {
  DROP_HEIGHT_M,
  ENTER_MS,
  EntranceSchedule,
  entranceFrame,
  labelOpacity,
  MAX_TOTAL_MS,
  REDUCED_FADE_MS,
} from '../../src/renderer/entrances.ts';
import { sampleBus } from './fixtures.ts';

const shellCommands: [string, unknown][] = [
  ['pour_slab', { from: { x: 0, z: 0 }, to: { x: '16ft', z: '12ft' } }],
  ['build_wall', { start: { x: 0, z: 0 }, end: { x: '16ft', z: 0 }, height: '8ft' }],
  ['build_wall', { start: { x: '16ft', z: 0 }, end: { x: '16ft', z: '12ft' }, height: '8ft' }],
];

function emptyBus() {
  return new CommandBus({ project: createProject({ name: 'Shed' }), catalog: CATALOG });
}

const opts = (over: Partial<Parameters<EntranceSchedule['update']>[1]> = {}) => ({ loadId: 1, animate: true, reducedMotion: false, now: 1000, ...over });

describe('entrances', () => {
  it('a project as loaded appears at once', () => {
    const s = new EntranceSchedule();
    s.update(sampleBus().project, opts({ animate: false }));
    expect(s.size).toBe(0);
  });

  it('the first render of a scene is instant, even after a command', () => {
    const s = new EntranceSchedule();
    s.update(sampleBus().project, opts());
    expect(s.size).toBe(0);
  });

  it('parts a command adds enter; parts already there do not', () => {
    const bus = emptyBus();
    bus.execute(...shellCommands[0]!);
    const s = new EntranceSchedule();
    s.update(bus.project, opts());
    const before = new Set(Object.keys(bus.project.parts));
    bus.execute(...shellCommands[1]!);
    s.update(bus.project, opts());
    const entering = [...s.active(1000).keys()];
    expect(entering.length).toBeGreaterThan(0);
    expect(entering.every((id) => !before.has(id))).toBe(true);
    expect(entering.length).toBe(Object.keys(bus.project.parts).length - before.size);
    // Same project again: nothing new.
    s.update(bus.project, opts({ now: 1100 }));
    expect(s.size).toBe(entering.length);
  });

  it('opening another project drops everything and is instant', () => {
    const bus = emptyBus();
    const s = new EntranceSchedule();
    s.update(bus.project, opts());
    bus.execute(...shellCommands[0]!);
    s.update(bus.project, opts());
    expect(s.size).toBeGreaterThan(0);
    s.update(sampleBus().project, opts({ loadId: 2, animate: false }));
    expect(s.size).toBe(0);
  });

  it('staggers a build by assembly, lowest first, and stays under the cap', () => {
    const bus = emptyBus();
    const s = new EntranceSchedule();
    s.update(bus.project, opts());
    for (const c of shellCommands) bus.execute(...c);
    s.update(bus.project, opts({ now: 0 }));
    const active = s.active(0);
    const startOf = (assemblyId: string) => Math.min(...[...active].filter(([id]) => bus.project.parts[id]!.assemblyId === assemblyId).map(([, e]) => e.start));
    const [slab, w1, w2] = Object.keys(bus.project.assemblies);
    expect(startOf(slab!)).toBe(0);
    expect(startOf(w1!)).toBeGreaterThan(startOf(slab!));
    expect(startOf(w2!)).toBeGreaterThan(startOf(w1!));
    const end = Math.max(...[...active.values()].map((e) => e.start + e.duration));
    expect(end).toBeLessThanOrEqual(MAX_TOTAL_MS);
    expect(MAX_TOTAL_MS).toBeLessThan(1500);
    expect(s.landsAt).toBe(end);
    // Inside a wall, the bottom plate starts before the top plates.
    const wallParts = [...active].filter(([id]) => bus.project.parts[id]!.assemblyId === w1);
    const byY = wallParts.sort(([a], [b]) => bus.project.parts[a]!.position.y - bus.project.parts[b]!.position.y);
    expect(byY[0]![1].start).toBeLessThan(byY.at(-1)![1].start);
    // Finished entrances drop out.
    expect(s.active(end + 1).size).toBe(0);
  });

  it('undo removes entering parts; redo brings them back in', () => {
    const bus = emptyBus();
    bus.execute(...shellCommands[0]!);
    const s = new EntranceSchedule();
    s.update(bus.project, opts());
    bus.execute(...shellCommands[1]!);
    s.update(bus.project, opts());
    const n = s.size;
    bus.undo();
    s.update(bus.project, opts({ now: 1100 }));
    expect(s.size).toBe(0);
    bus.redo();
    s.update(bus.project, opts({ now: 1200 }));
    expect(s.size).toBe(n);
  });

  it('reduced motion: no fall and no stagger, a quick fade', () => {
    const bus = emptyBus();
    const s = new EntranceSchedule();
    s.update(bus.project, opts());
    for (const c of shellCommands) bus.execute(...c);
    s.update(bus.project, opts({ reducedMotion: true, now: 0 }));
    for (const e of s.active(0).values()) expect(e).toEqual({ start: 0, duration: REDUCED_FADE_MS, drop: 0 });
  });

  it('a part falls and fades in, solid before it lands', () => {
    const e = { start: 100, duration: ENTER_MS, drop: DROP_HEIGHT_M };
    expect(entranceFrame(e, 50)).toMatchObject({ started: false, opacity: 0 });
    const mid = entranceFrame(e, 100 + ENTER_MS / 2);
    expect(mid.started).toBe(true);
    expect(mid.lift).toBeGreaterThan(0);
    expect(mid.lift).toBeLessThan(DROP_HEIGHT_M);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(entranceFrame(e, 100 + ENTER_MS * 0.7).opacity).toBeCloseTo(1, 6);
    expect(entranceFrame(e, 100 + ENTER_MS)).toEqual({ started: true, opacity: 1, lift: 0, done: true });
  });

  it('a new measurement waits for the parts to land; an old one shows at once', () => {
    const schedule = { lastAddedAt: 1000, landsAt: 2000, reducedMotion: false };
    expect(labelOpacity(schedule, 999, 1500)).toBe(0);
    expect(labelOpacity(schedule, 999, 2000)).toBe(0);
    expect(labelOpacity(schedule, 999, 2100)).toBeGreaterThan(0);
    expect(labelOpacity(schedule, 999, 5000)).toBe(1);
    expect(labelOpacity(schedule, 100, 1500)).toBe(1);
  });

  describe('editing an opening in place', () => {
    const doorShell: [string, unknown][] = [
      ['pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }],
      ['build_wall', { start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '9ft' }],
      ['build_wall', { start: { x: '20ft', z: '16ft' }, end: { x: 0, z: '16ft' }, height: '9ft' }],
      ['add_opening', { wallId: 'W2', kind: 'door', centerAt: '10ft' }],
    ];
    function edit(cmd: [string, unknown]) {
      const bus = emptyBus();
      for (const c of doorShell) expect(bus.execute(...c).ok).toBe(true);
      const s = new EntranceSchedule();
      s.update(bus.project, opts());
      const before = bus.project.parts;
      expect(bus.execute(...cmd).ok).toBe(true);
      s.update(bus.project, opts());
      const entering = [...s.active(1000).keys()].map((id) => bus.project.parts[id]!);
      const wallParts = Object.values(bus.project.parts).filter((p) => p.assemblyId === 'W2').length;
      return { before, entering, wallParts };
    }
    const shape = (p: { assemblyId: string; role: string; position: unknown; rotation: unknown; size: unknown }) =>
      JSON.stringify([p.assemblyId, p.role, p.position, p.rotation, p.size]);

    for (const cmd of [
      ['update_opening', { openingId: 'O1', width: '3ft' }],
      ['update_opening', { openingId: 'O1', height: '7ft' }],
      ['update_opening', { openingId: 'O1', centerAt: '12ft' }],
      ['remove_opening', { openingId: 'O1' }],
    ] as [string, unknown][]) {
      it(`${cmd[0]} ${JSON.stringify(cmd[1])}: only the re-framed parts fall in, not the wall`, () => {
        const { before, entering, wallParts } = edit(cmd);
        expect(entering.length).toBeGreaterThan(0);
        expect(entering.every((p) => !before[p.id])).toBe(true);
        // The other wall and the slab stay put; most of the edited wall does too.
        expect(entering.every((p) => p.assemblyId === 'W2' || p.assemblyId === 'O1')).toBe(true);
        expect(entering.length).toBeLessThan(wallParts / 2);
        // Nothing enters that is the same piece in the same place as before.
        const old = new Set(Object.values(before).map(shape));
        expect(entering.filter((p) => old.has(shape(p))).map((p) => p.id)).toEqual([]);
      });
    }
  });
});
