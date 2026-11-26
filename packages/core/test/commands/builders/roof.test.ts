import { describe, expect, it } from 'vitest';
import { createProject, findAllClashes, type Project } from '../../../src/index.ts';
import { expectRoundTrip, runErr, runOk } from '../../helpers.ts';

const IN = 25.4;
/** Slab + four 9ft walls, clockwise, around 20ft × 16ft. */
export function shell(heights: { south?: string; north?: string } = {}): Project {
  let p = runOk(createProject({ name: 't' }), 'pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }).project;
  const wall = (start: unknown, end: unknown, height = '9ft') => (p = runOk(p, 'build_wall', { start, end, height }).project);
  wall({ x: 0, z: 0 }, { x: '20ft', z: 0 }, heights.north);
  wall({ x: '20ft', z: 0 }, { x: '20ft', z: '16ft' });
  wall({ x: '20ft', z: '16ft' }, { x: 0, z: '16ft' }, heights.south);
  wall({ x: 0, z: '16ft' }, { x: 0, z: 0 });
  return p;
}
const roof = (extra: Record<string, unknown> = {}) => ({ type: 'gable', from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' }, pitch: '6 in 12', ...extra });
const roles = (p: Project, role: string) => Object.values(p.parts).filter((x) => x.assemblyId === 'R1' && x.role === role);

describe('build_roof', () => {
  it('a 6 in 12 gable over a 20 × 16 shell', () => {
    const res = expectRoundTrip(shell(), 'build_roof', roof());
    const p = res.project;
    // Ridge along x (the longer side): rafter pairs at 0, 16 … 224in and at the far end = 16 pairs.
    expect(roles(p, 'rafter')).toHaveLength(32);
    expect(roles(p, 'ridge')).toHaveLength(1);
    expect(roles(p, 'ridge')[0]!.sectionId).toBe('2x8');
    expect(roles(p, 'joist').filter((x) => x.tags.includes('rafter-tie'))).toHaveLength(16);
    // Run 8ft − 3/4in + 12in overhang = 107 1/4in, along a 6/12 slope.
    expect(roles(p, 'rafter')[0]!.size.length).toBeCloseTo((107.25 * IN) / Math.cos(Math.atan(0.5)), 3);
    expect(Object.values(p.parts).filter((x) => x.assemblyId === 'R1').every((x) => x.buildStep.phase === 'roofing')).toBe(true);
    const joints = Object.values(p.joints);
    expect(joints.filter((j) => j.jointTypeId === 'hurricane-tie')).toHaveLength(32);
    const joined = new Set(joints.flatMap((j) => j.partIds));
    expect(Object.values(p.parts).filter((x) => x.assemblyId === 'R1').every((x) => joined.has(x.id))).toBe(true);
    expect(findAllClashes(p)).toEqual([]);
  });

  it('a shed roof on walls of the right heights', () => {
    // 2 in 12 over 16ft, low side north at 9ft 4in (slab + wall): the south walls must top out at
    // 9' 4" + (16ft − 3 1/2in + 7/16in) × 2/12 = 11' 11 1/2" (to the nearest 1/16), so build them
    // 11' 11 1/2" − 4in slab = 11' 7 1/2" tall: the number the refusal below gives works.
    const p0 = shell({ south: '11ft 7 1/2in' });
    const res = expectRoundTrip(p0, 'build_roof', roof({ type: 'shed', lowSide: 'north', pitch: '2 in 12' }));
    expect(roles(res.project, 'rafter')).toHaveLength(16);
    expect(roles(res.project, 'ridge')).toHaveLength(0);
    expect(findAllClashes(res.project)).toEqual([]);
  });

  describe('refusals', () => {
    it('pitch out of range', () => {
      expect(runErr(shell(), 'build_roof', roof({ pitch: '0 in 12' }))[0]!.message).toBe('A roof pitch must be between 1 in 12 and 24 in 12 (you gave 0 in 12).');
    });
    it('no walls and no bearing height', () => {
      expect(runErr(createProject({ name: 't' }), 'build_roof', roof())[0]!.message).toBe('There are no walls under the north edge of the roof to bear on.');
    });
    it('rafters past stock length', () => {
      expect(runErr(createProject({ name: 't' }), 'build_roof', roof({ to: { x: '40ft', z: '36ft' }, bearingHeight: '9ft' }))[0]!.message).toBe(
        // Run 18ft − 3/4in + 12in = 227 1/4in; ÷ cos(26.57°) = 254 1/16in.
        `A 6 in 12 gable roof over 36' 0" needs 21' 2 1/16" rafters, past the 20' 0" stock length.`,
      );
    });
    it('a shed whose high walls are too low', () => {
      expect(runErr(shell(), 'build_roof', roof({ type: 'shed', lowSide: 'north', pitch: '2 in 12' }))[0]!.message).toBe(
        `The south walls top out at 9' 4" but a 2 in 12 shed roof over 16' 0" needs them at 11' 11 1/2". Build them taller or lower the pitch.`,
      );
    });
    it('a clash', () => {
      let p = shell();
      // Trunk just west of the slab; its canopy (12ft–30ft up) reaches over the west gable.
      p = runOk(p, 'place_structure', { kind: 'tree', at: { x: '-2ft', z: '8ft' }, height: '30ft', canopy: '10ft' }).project;
      expect(runErr(p, 'build_roof', roof())[0]!.message).toContain('The new roof would run through X1 "Tree"');
    });
  });
});
