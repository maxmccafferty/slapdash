import { describe, expect, it } from 'vitest';
import { SAMPLE_CATALOG, commandRegistry, createProject, findAllClashes, indexCatalog, type Project } from '../../../src/index.ts';
import { expectRoundTrip, runErr, runOk } from '../../helpers.ts';

const IN = 25.4;
const wallProject = (extra: Record<string, unknown> = {}) => {
  const p = runOk(createProject({ name: 't' }), 'pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }).project;
  return runOk(p, 'build_wall', { start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '9ft', ...extra }).project;
};
const inWall = (p: Project, wall = 'W1') => Object.values(p.parts).filter((x) => x.assemblyId === wall);
const tagged = (p: Project, role: string, tag: string, wall = 'W1') => inWall(p, wall).filter((x) => x.role === role && x.tags.includes(tag));
const counts = (p: Project, wall = 'W1') => ({
  common: tagged(p, 'stud', 'common', wall).length,
  king: tagged(p, 'stud', 'king', wall).length,
  jack: tagged(p, 'stud', 'jack', wall).length,
  cripple: tagged(p, 'stud', 'cripple', wall).length,
  header: inWall(p, wall).filter((x) => x.role === 'header').length,
  sill: inWall(p, wall).filter((x) => x.role === 'sill').length,
  bottom: tagged(p, 'plate', 'bottom', wall).length,
  sheathing: inWall(p, wall).filter((x) => x.role === 'sheathing').length,
});

describe('add_opening', () => {
  it('frames a window; untouched stud IDs stay the same', () => {
    const before = wallProject();
    const res = expectRoundTrip(before, 'add_opening', { wallId: 'W1', kind: 'window', centerAt: '8ft' });
    const p = res.project;
    // RO 78–114in; one jack and one king each side (36in: 2-2x4, NJ 1; R602.7.5: 1 king up to 4ft).
    // Commons at 80, 96, 112in are in the way.
    const removed = ['W1-S06', 'W1-S07', 'W1-S08'];
    for (const id of removed) expect(p.parts[id]).toBeUndefined();
    for (const id of Object.keys(before.parts)) if (!removed.includes(id) && !id.startsWith('W1-SH') && id !== 'W1-P01') expect(p.parts[id]).toEqual(before.parts[id]);
    expect(Object.values(p.joints).some((j) => removed.some((r) => j.partIds.includes(r)))).toBe(false);
    expect(counts(p)).toMatchObject({ common: 11, king: 2, jack: 2, cripple: 6, header: 2, sill: 1, bottom: 1 });
    const header = inWall(p).find((x) => x.role === 'header')!;
    expect(header.sectionId).toBe('2x4');
    expect(header.size.length).toBeCloseTo(39 * IN);
    expect(header.tags).toContain('opening:O1');
    const sill = inWall(p).find((x) => x.role === 'sill')!;
    expect(sill.position.y).toBeCloseTo(4 * IN + 33 * IN);
    expect(p.assemblies.O1).toMatchObject({ kind: 'opening', buildStep: { phase: 'openings', seq: 0 }, builder: { name: 'add_opening', params: { wallId: 'W1', kind: 'window' } } });
    expect(findAllClashes(p)).toEqual([]);
    expect(res.summary).toContain('Framed O1 in W1: a 3\' 0" × 4\' 0" window, 2-2x4 header, 1 jack and 1 king stud each side');
  });

  it('a door cuts the bottom plate; a sliding door gets a 2-2x10 at a 16ft building width', () => {
    const p = runOk(wallProject(), 'add_opening', { wallId: 'W1', kind: 'sliding-door', at: '7ft' }).project;
    expect(counts(p)).toMatchObject({ king: 4, jack: 4, cripple: 4, header: 2, sill: 0, bottom: 2 });
    const header = inWall(p).find((x) => x.role === 'header')!;
    expect(header.sectionId).toBe('2x10');
    expect(header.size.length).toBeCloseTo(78 * IN);
    const plates = tagged(p, 'plate', 'bottom');
    expect(Object.values(p.joints).filter((j) => j.jointTypeId === 'anchor-bolt' && plates.some((x) => j.partIds.includes(x.id)))).toHaveLength(2);
    expect(findAllClashes(p)).toEqual([]);
  });

  it('build_wall with an inline opening equals build_wall + add_opening', () => {
    const inline = (() => {
      const p = runOk(createProject({ name: 't' }), 'pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }).project;
      return runOk(p, 'build_wall', {
        start: { x: 0, z: 0 },
        end: { x: '20ft', z: 0 },
        height: '9ft',
        openings: [{ kind: 'sliding-door', at: '7ft' }],
      }).project;
    })();
    const after = runOk(wallProject(), 'add_opening', { wallId: 'W1', kind: 'sliding-door', at: '7ft' }).project;
    expect(counts(inline)).toEqual(counts(after));
    expect(Object.keys(inline.joints).length).toBe(Object.keys(after.joints).length);
    expect(inline.assemblies.O1!.builder!.params).toEqual(after.assemblies.O1!.builder!.params);
  });

  it('a non-bearing wall gets a flat 2x4 header', () => {
    const p = runOk(wallProject({ loadBearing: false }), 'add_opening', { wallId: 'W1', kind: 'door', at: '5ft' }).project;
    const header = inWall(p).filter((x) => x.role === 'header');
    expect(header).toHaveLength(1);
    expect(header[0]!.size.width).toBeCloseTo(38.1);
  });

  it('adds the door/window unit to the opening assembly when the catalog has one', () => {
    const catalog = indexCatalog({
      ...SAMPLE_CATALOG,
      materials: [...SAMPLE_CATALOG.materials, { id: 'window-unit', name: 'Window unit', category: 'opening', acceptsJoints: ['nailed-16d', 'factory-assembled'] }],
    });
    const def = commandRegistry.get('add_opening')!;
    const input = def.schema.parse({ wallId: 'W1', kind: 'window', centerAt: '8ft' });
    const ctx = { catalog, now: () => 0 };
    const before = wallProject();
    expect(def.check(before, input, ctx)).toEqual([]);
    const p = def.apply(before, input, ctx).project;
    expect(Object.values(p.parts).filter((x) => x.role === 'panel')).toEqual([]);
    const unit = Object.values(p.parts).filter((x) => x.tags.includes('unit'));
    // A casement (the default for a product with no unit): frame, fin, sash and glass.
    expect(unit.map((x) => x.role).sort()).toEqual([...Array(8).fill('frame'), 'glass', ...Array(4).fill('sash')]);
    for (const x of unit) {
      expect(x).toMatchObject({ assemblyId: 'O1', materialId: 'window-unit', buildStep: { phase: 'openings', seq: 0 } });
      expect(x.sectionId).toBeUndefined();
    }
    expect(unit.find((x) => x.tags.includes('unit:sill'))!.id).toBe('O1-FR01');
    const ids = new Set(unit.map((x) => x.id));
    const attach = Object.values(p.joints).filter((j) => j.partIds.some((id) => ids.has(id)) && j.partIds.some((id) => !ids.has(id)));
    expect(attach.length).toBeGreaterThanOrEqual(2);
    expect(attach.every((j) => j.jointTypeId === 'nailed-16d')).toBe(true);
    const internal = Object.values(p.joints).filter((j) => j.partIds.every((id) => ids.has(id)));
    expect(internal).toHaveLength(unit.length - 1);
    expect(internal.every((j) => j.jointTypeId === 'factory-assembled')).toBe(true);
    expect(p.assemblies.O1!.builder!.params).toMatchObject({ style: 'casement' });
    expect(findAllClashes(p)).toEqual([]);
  });

  it('a specific product, nailed through its fin, and a safety-glazing tag; neither changes the recipe unless given', () => {
    const plain = runOk(wallProject(), 'add_opening', { wallId: 'W1', kind: 'window', centerAt: '8ft' }).project;
    const params = plain.assemblies.O1!.builder!.params;
    expect(params).not.toHaveProperty('product');
    expect(params).not.toHaveProperty('safetyGlazing');

    const res = expectRoundTrip(wallProject(), 'add_opening', { wallId: 'W1', kind: 'window', centerAt: '8ft', product: 'window-casement', safetyGlazing: true });
    const unit = Object.values(res.project.parts).filter((x) => x.tags.includes('unit'));
    for (const x of unit) expect(x).toMatchObject({ assemblyId: 'O1', materialId: 'window-casement' });
    // Only the glass is marked safety glazing.
    expect(unit.filter((x) => x.tags.includes('safety-glazing')).map((x) => x.role)).toEqual(['glass']);
    const ids = new Set(unit.map((x) => x.id));
    const nailed = Object.values(res.project.joints).filter((j) => j.partIds.some((id) => ids.has(id)) && j.partIds.some((id) => !ids.has(id)));
    expect(nailed.length).toBeGreaterThanOrEqual(2);
    expect(nailed.every((j) => j.jointTypeId === 'nailed-roofing')).toBe(true);
    expect(res.project.assemblies.O1!.builder!.params).toMatchObject({ product: 'window-casement', safetyGlazing: true });

    const inline = runOk(createProject({ name: 't' }), 'build_wall', {
      start: { x: 0, z: 0 },
      end: { x: '20ft', z: 0 },
      height: '9ft',
      openings: [{ kind: 'window', centerAt: '8ft', product: 'window-casement' }],
    }).project;
    expect(Object.values(inline.parts).find((x) => x.role === 'glass')!.materialId).toBe('window-casement');
  });

  it('refuses a product that is not an opening', () => {
    expect(runErr(wallProject(), 'add_opening', { wallId: 'W1', kind: 'window', centerAt: '8ft', product: 'spf-no2' })[0]!.message).toContain('needs opening');
  });

  describe('refusals', () => {
    const p = wallProject();
    it('wall not found', () => {
      expect(runErr(p, 'add_opening', { wallId: 'W9', kind: 'door', at: '5ft' })[0]).toMatchObject({ code: 'not_found', message: `There's no wall "W9".`, hint: 'Did you mean "W1"?' });
    });
    it('not a builder wall', () => {
      const q = runOk(p, 'add_assembly', { name: 'Hand wall', kind: 'wall' }).project;
      expect(runErr(q, 'add_opening', { wallId: 'W2', kind: 'door', at: '5ft' })[0]!.message).toBe(
        "W2 wasn't made with build_wall, so add_opening can't re-frame it.",
      );
    });
    it('runs past the end', () => {
      // RO 216–252in, framing to 255in; the end stud starts at 238 1/2in.
      expect(runErr(p, 'add_opening', { wallId: 'W1', kind: 'window', at: '18ft' })[0]!.message).toBe(
        'The opening needs 1\' 4 1/2" more room at the east end for the king and jack studs.',
      );
      expect(runErr(p, 'add_opening', { wallId: 'W1', kind: 'window', at: '2in' })[0]!.message).toBe(
        'The opening needs 2 1/2" more room at the west end for the king and jack studs.',
      );
    });
    it('overlaps another opening', () => {
      const q = runOk(p, 'add_opening', { wallId: 'W1', kind: 'window', at: '5ft' }).project;
      expect(runErr(q, 'add_opening', { wallId: 'W1', kind: 'window', at: '7ft' })[0]!.message).toBe("The opening's framing would overlap O1's framing.");
    });
    it('too tall for the wall', () => {
      // A 38in door at the 24ft column needs a 2-2x6 (4' 7"); studs top out at 105in, so 105 - 5 1/2 = 99 1/2in.
      expect(runErr(p, 'add_opening', { wallId: 'W1', kind: 'door', at: '5ft', height: '8ft 6in' })[0]!.message).toBe(
        `A 9' 0" wall fits a door at most 8' 3 1/2" tall with a 2-2x6 header; you asked for 8' 6".`,
      );
    });
    it('past the header table', () => {
      expect(runErr(p, 'add_opening', { wallId: 'W1', kind: 'sliding-door', at: '2ft', width: '14ft' })[0]!.message).toBe(
        `A 14' 0" opening is longer than any built-up 2x header allows here (2-2x12 max 8' 1" at 30 psf). Use a narrower opening or an engineered beam.`,
      );
    });
    it('a window sill at the floor; sillHeight on a door', () => {
      expect(runErr(p, 'add_opening', { wallId: 'W1', kind: 'window', at: '5ft', sillHeight: 0 })[0]!.message).toContain('at or below the floor');
      expect(runErr(p, 'add_opening', { wallId: 'W1', kind: 'door', at: '5ft', sillHeight: '2ft' })[0]!.message).toContain('only applies to windows');
    });
    it('neither at nor centerAt', () => {
      expect(runErr(p, 'add_opening', { wallId: 'W1', kind: 'door' })[0]!.message).toContain('Give exactly one of "at"');
    });
  });
});
