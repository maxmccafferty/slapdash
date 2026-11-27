/**
 * The builders run on the real catalog: every default id exists, the core acceptance
 * shell (packages/core/test/builders/shell.acceptance.test.ts) builds cleanly, and so do a
 * pool fence, a polycarbonate pergola and a deck.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILDER_DEFAULTS,
  CommandBus,
  HEADER_TABLE,
  createProject,
  findAllClashes,
  formatErrors,
  checkJoint,
  codeNotes,
  indexCatalog,
  type Project,
} from '@slapdash/core';
import { CATALOG } from '../src/index.ts';

const idx = indexCatalog(CATALOG);

describe('builders on the catalog', () => {
  it('has every BUILDER_DEFAULTS material, section and joint type', () => {
    for (const id of Object.values(BUILDER_DEFAULTS.materials)) expect(idx.materials.has(id), id).toBe(true);
    for (const id of Object.values(BUILDER_DEFAULTS.sections)) expect(idx.sections.has(id), id).toBe(true);
    for (const id of Object.values(BUILDER_DEFAULTS.jointTypes)) expect(idx.jointTypes.has(id), id).toBe(true);
  });

  it('has every header section the header table can pick', () => {
    const ids = new Set(Object.values(HEADER_TABLE).flatMap((rows) => rows.map((row) => row.sectionId)));
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) expect(idx.sections.has(id), id).toBe(true);
  });

  describe('the 16 × 20 pool-house shell', () => {
    let n = 0;
    const bus = new CommandBus({ project: createProject({ name: 'Pool house' }), catalog: CATALOG, now: () => ++n });
    const exec = (name: string, input: unknown) => {
      const res = bus.execute(name, input);
      if (!res.ok) throw new Error(`${name}: ${formatErrors(res.errors)}`);
    };
    bus.group({ label: 'Build the pool house shell', source: 'claude', turnId: 't1' }, () => {
      exec('pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } });
      exec('build_wall', { start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '9ft', name: 'North wall' });
      exec('build_wall', { start: { x: '20ft', z: 0 }, end: { x: '20ft', z: '16ft' }, height: '9ft', name: 'East wall' });
      exec('build_wall', { start: { x: '20ft', z: '16ft' }, end: { x: 0, z: '16ft' }, height: '9ft', name: 'South wall' });
      exec('build_wall', { start: { x: 0, z: '16ft' }, end: { x: 0, z: 0 }, height: '9ft', name: 'West wall' });
      exec('add_opening', { wallId: 'W3', kind: 'sliding-door', centerAt: '10ft' });
      exec('add_opening', { wallId: 'W2', kind: 'window', centerAt: '8ft' });
      exec('build_roof', { type: 'gable', from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' }, pitch: '6 in 12', ridgeAxis: 'x' });
    });
    const p = bus.project;

    it('builds with nothing running through anything', () => {
      expect(Object.keys(p.parts).length).toBeGreaterThan(100);
      expect(findAllClashes(p)).toEqual([]);
    });

    it('has no code notes (no pool, nothing flagged): the generic windows only matter near water', () => {
      expect(codeNotes(p, idx)).toEqual([]);
    });

    it('each opening gets a generic window/door unit, drawn as a frame, sashes and glass', () => {
      const units = Object.values(p.parts).filter((x) => x.materialId === 'opening-unit');
      expect([...new Set(units.map((u) => u.assemblyId))].sort()).toEqual(['O1', 'O2']);
      for (const u of units) expect(u.tags).toContain('unit');
      expect(units.some((u) => u.role === 'panel')).toBe(false);
      for (const id of ['O1', 'O2']) {
        const roles = new Set(units.filter((u) => u.assemblyId === id).map((u) => u.role));
        expect([...roles].sort(), id).toEqual(['frame', 'glass', 'sash']);
      }
      expect(p.assemblies.O1!.builder!.params).toMatchObject({ style: 'sliding' });
      expect(p.assemblies.O2!.builder!.params).toMatchObject({ style: 'casement' });
    });
  });

  describe('tier 3 builders on the real catalog', () => {
    const run = (cmds: Array<[string, unknown]>): Project => {
      let n = 0;
      const bus = new CommandBus({ project: createProject({ name: 'Yard' }), catalog: CATALOG, now: () => ++n });
      for (const [name, input] of cmds) {
        const res = bus.execute(name, input);
        if (!res.ok) throw new Error(`${name}: ${formatErrors(res.errors)}`);
      }
      return bus.project;
    };
    const sound = (p: Project) => {
      const joints = Object.values(p.joints);
      const embedded = new Set(joints.filter((j) => j.jointTypeId === 'post-embedded').map((j) => [...j.partIds].sort().join('|')));
      expect(
        findAllClashes(p, { skip: (a, b) => a.tags.includes('site-context') || b.tags.includes('site-context') || embedded.has([a.id, b.id].sort().join('|')) }),
      ).toEqual([]);
      for (const j of joints) {
        const { [j.id]: _self, ...others } = p.joints;
        expect(checkJoint({ ...p, joints: others }, j, idx), j.id).toEqual([]);
      }
    };

    it.each(['picket', 'chain-link', 'aluminum', 'glass'] as const)('a %s pool fence with a gate around a pool', (style) => {
      const p = run([
        ['place_structure', { kind: 'pool', at: { x: '4ft', z: '4ft' }, width: '12ft', depth: '20ft' }],
        [
          'build_fence',
          {
            path: [{ x: 0, z: 0 }, { x: '20ft', z: 0 }, { x: '20ft', z: '28ft' }, { x: 0, z: '28ft' }, { x: 0, z: 0 }],
            style,
            height: '4ft',
            poolBarrier: true,
            gates: [{ centerAt: '10ft' }],
          },
        ],
      ]);
      sound(p);
      expect(Object.values(p.joints).some((j) => j.jointTypeId === 'gate-hinge-self-closing')).toBe(true);
      // Real pool hardware and rated infill: no barrier notes.
      expect(codeNotes(p, idx).map((n) => n.key)).toEqual([]);
    });

    it('a plain chain-link fence next to a pool is noted as not a barrier, with the pool still needing one', () => {
      const p = run([
        ['place_structure', { kind: 'pool', at: { x: '4ft', z: '4ft' }, width: '12ft', depth: '20ft' }],
        ['build_fence', { path: [{ x: 0, z: 0 }, { x: '20ft', z: 0 }], style: 'chain-link', height: '4ft', gates: [{ centerAt: '10ft' }] }],
      ]);
      expect(codeNotes(p, idx).map((n) => n.key.split(':')[0])).toEqual(['fence-not-pool-barrier', 'pool-needs-barrier']);
    });

    it('a 12 × 16 polycarbonate pergola and a 4ft deck with stairs and each guard style', () => {
      sound(run([['build_pergola', { from: { x: 0, z: 0 }, to: { x: '16ft', z: '12ft' }, roofing: 'polycarbonate' }]]));
      for (const railing of ['wood', 'cable', 'glass'] as const) {
        sound(run([['build_deck', { from: { x: 0, z: 0 }, to: { x: '16ft', z: '12ft' }, height: '4ft', railing, stairs: { side: 'south', at: '6ft' } }]]));
      }
      sound(run([['build_deck', { from: { x: 0, z: 0 }, to: { x: '16ft', z: '12ft' }, height: '3ft', decking: 'composite-decking' }]]));
    });
  });
});
