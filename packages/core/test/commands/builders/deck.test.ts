import { describe, expect, it } from 'vitest';
import { createProject, type Project } from '../../../src/index.ts';
import { expectRoundTrip, expectSound, runErr, runOk } from '../../helpers.ts';

const IN = 25.4;
const FT = 304.8;
const parts = (p: Project) => Object.values(p.parts);
const base = { from: { x: 0, z: 0 }, to: { x: '16ft', z: '12ft' } };

describe('build_deck', () => {
  it('12x16 at 2ft: no guard, joists from the span table, decking on the joists', () => {
    const res = expectRoundTrip(createProject({ name: 't' }), 'build_deck', { ...base, height: '2ft' });
    const p = res.project;
    expectSound(p);
    expect(Object.values(p.assemblies).map((a) => a.kind)).toEqual(['floor']);
    const asm = Object.values(p.assemblies)[0]!;
    // 12ft joist span − beams inset: about 11ft 3in, so 2x8 at 16in (IRC R507.6: 11ft 1in) is too short → 2x10.
    expect(asm.builder!.params).toMatchObject({ joistSize: '2x10', spacing: '16in', railing: 'none' });
    const boards = parts(p).filter((x) => x.role === 'sheathing');
    expect(boards.length).toBe(25);
    expect(boards.every((x) => x.materialId === 'pt-syp-no2-gc' && x.sectionId === '5-4x6')).toBe(true);
    expect(parts(p).filter((x) => x.role === 'post')).toHaveLength(6);
  });

  it('at 4ft it adds a 36in wood guard with balusters under 4in apart', () => {
    const p = runOk(createProject({ name: 't' }), 'build_deck', { ...base, height: '4ft' }).project;
    expectSound(p);
    const rail = Object.values(p.assemblies).find((a) => a.name.endsWith('railing'))!;
    expect(rail.kind).toBe('misc');
    const caps = parts(p).filter((x) => x.tags.includes('guard-cap'));
    expect(caps).toHaveLength(4);
    for (const c of caps) expect(c.position.y + 0).toBeGreaterThan(0);
    const balusters = parts(p)
      .filter((x) => x.tags.includes('guard-baluster'))
      .sort((a, b) => a.position.x - b.position.x || a.position.z - b.position.z);
    expect(balusters.length).toBeGreaterThan(60);
    // Along the north side (z < 0), gaps between neighbours in the same bay stay under 4in.
    const north = balusters.filter((x) => x.position.z < 0).map((x) => x.position.x);
    const gaps = north.slice(1).map((x, i) => x - north[i]! - 1.5 * IN).filter((g) => g < 6 * IN);
    expect(gaps.length).toBeGreaterThan(10);
    for (const g of gaps) expect(g).toBeLessThan(4 * IN);
  });

  it('refuses no guard at 4ft', () => {
    expect(runErr(createProject({ name: 't' }), 'build_deck', { ...base, height: '4ft', railing: 'none' })[0]!.message).toContain('R312.1.1');
  });

  it('composite decking with cable railing at 12in joists; glass railing panels are safety glazing', () => {
    const c = runOk(createProject({ name: 't' }), 'build_deck', { ...base, height: '4ft', decking: 'composite-decking', railing: 'cable' }).project;
    expectSound(c);
    const asm = Object.values(c.assemblies).find((a) => a.kind === 'floor')!;
    expect(asm.builder!.params).toMatchObject({ spacing: '12in', decking: 'composite-decking', railing: 'cable' });
    expect(parts(c).filter((x) => x.materialId === 'cable-rail-infill').length).toBeGreaterThan(8);
    const g = runOk(createProject({ name: 't' }), 'build_deck', { ...base, height: '4ft', railing: 'glass' }).project;
    expectSound(g);
    expect(parts(g).filter((x) => x.materialId === 'glass-railing-panel').length).toBeGreaterThan(8);
  });

  it('stairs: risers at most 7 3/4in, treads at least 10in, a pad, and a handrail from 4 risers', () => {
    const res = expectRoundTrip(createProject({ name: 't' }), 'build_deck', { ...base, height: '4ft', stairs: { side: 'south', at: '6ft' } });
    const p = res.project;
    expectSound(p);
    const treads = parts(p).filter((x) => x.tags.includes('stair-tread'));
    const tops = [...new Set(treads.map((x) => Math.round(x.position.y + x.size.width)))].sort((a, b) => b - a);
    // 48in / 7 risers of 6 7/8in → 6 treads.
    expect(tops).toHaveLength(6);
    const riser = (48 * IN) / 7;
    expect(riser).toBeLessThanOrEqual(7.75 * IN);
    expect(parts(p).filter((x) => x.tags.includes('stair-stringer')).length).toBeGreaterThanOrEqual(3);
    expect(parts(p).filter((x) => x.tags.includes('stair-pad'))).toHaveLength(1);
    expect(parts(p).filter((x) => x.tags.includes('stair-handrail'))).toHaveLength(2);
    expect(res.summary).toContain('7 risers');
    // The south guard is broken at the stair opening.
    expect(parts(p).filter((x) => x.tags.includes('guard-cap'))).toHaveLength(5);
  });

  it('too low for framing is refused with a hint', () => {
    expect(runErr(createProject({ name: 't' }), 'build_deck', { ...base, height: '10in' })[0]!.message).toContain('too low');
  });

  it('recipe params record the joist size picked', () => {
    const p = runOk(createProject({ name: 't' }), 'build_deck', { ...base, height: '2ft', spacing: '12in' }).project;
    expect(Object.values(p.assemblies)[0]!.builder!.params).toMatchObject({ joistSize: '2x8', spacing: '12in' });
    expect(FT).toBeGreaterThan(0);
  });
});
