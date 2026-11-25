import { describe, expect, it } from 'vitest';
import { createProject, findAllClashes, GROUND, type Project } from '../../../src/index.ts';
import { expectRoundTrip, runErr, runOk } from '../../helpers.ts';

const IN = 25.4;
const floor = (extra: Record<string, unknown> = {}) => ({ from: { x: 0, z: 0 }, to: { x: '12ft', z: '16ft' }, ...extra });
const slabbed = () => runOk(createProject({ name: 't' }), 'pour_slab', { from: { x: 0, z: 0 }, to: { x: '12ft', z: '16ft' } }).project;
const roles = (p: Project, role: string) => Object.values(p.parts).filter((x) => x.assemblyId === 'F1' && x.role === role);

describe('frame_floor', () => {
  it('frames a floor on a slab: sills, rims, joists across the short side, blocking, subfloor', () => {
    const res = expectRoundTrip(slabbed(), 'frame_floor', floor());
    const p = res.project;
    // Joists run east-west (12ft side) at 16in along the 16ft side: marks 16 … 176in (11) + 2 end rims + 2 bands.
    expect(roles(p, 'joist')).toHaveLength(11);
    expect(roles(p, 'rim')).toHaveLength(4);
    expect(roles(p, 'joist')[0]!.size.length).toBeCloseTo(141 * IN);
    // 12ft span > 8ft: one block in each of the 12 bays.
    expect(roles(p, 'blocking')).toHaveLength(12);
    expect(roles(p, 'plate').every((x) => x.materialId === 'pt-spf-no2' && x.tags.includes('sill-plate'))).toBe(true);
    // 3 rows of 4ft across 12ft; rows of 8ft sheets staggered along 16ft: 2 + 3 + 2.
    expect(roles(p, 'sheathing')).toHaveLength(7);
    const top = Math.max(...roles(p, 'sheathing').map((x) => x.position.y + x.size.height));
    expect(top).toBeCloseTo(4 * IN + 1.5 * IN + 7.25 * IN + (23 / 32) * IN);
    const joints = Object.values(p.joints);
    expect(joints.filter((j) => j.jointTypeId === 'anchor-bolt')).toHaveLength(2);
    const joistJoints = joints.filter((j) => j.partIds.includes(roles(p, 'joist')[0]!.id));
    expect(joistJoints.filter((j) => j.fastenerCount === 3)).toHaveLength(2);
    const joined = new Set(joints.flatMap((j) => j.partIds));
    expect(Object.values(p.parts).filter((x) => x.assemblyId === 'F1').every((x) => joined.has(x.id))).toBe(true);
    expect(findAllClashes(p)).toEqual([]);
  });

  it('on piers', () => {
    const p = runOk(createProject({ name: 't' }), 'frame_floor', floor({ support: 'piers', joistDirection: 'z' })).project;
    // Bearing edges are the 12ft north and south sides: ceil(144/72)+1 = 3 piers each.
    expect(roles(p, 'pier')).toHaveLength(6);
    const joints = Object.values(p.joints);
    expect(joints.filter((j) => j.jointTypeId === 'post-base')).toHaveLength(6);
    expect(joints.filter((j) => j.partIds[1] === GROUND)).toHaveLength(6);
    expect(roles(p, 'joist')[0]!.size.length).toBeCloseTo(189 * IN);
  });

  describe('refusals', () => {
    it('nothing to bear on', () => {
      expect(runErr(createProject({ name: 't' }), 'frame_floor', floor())[0]!.message).toBe(
        `There's nothing under the west edge to bear on. Pour a slab or footing first, or use support: "piers".`,
      );
    });
    it('joists past stock length', () => {
      expect(runErr(createProject({ name: 't' }), 'frame_floor', floor({ to: { x: '24ft', z: '30ft' }, support: 'piers' }))[0]!.message).toContain(
        'add a beam mid-span',
      );
    });
    it('top too low or leaving a gap', () => {
      expect(runErr(slabbed(), 'frame_floor', floor({ top: '6in' }))[0]!.message).toContain('"top" is too low');
      expect(runErr(slabbed(), 'frame_floor', floor({ top: '3ft' }))[0]!.message).toContain('gap above the foundation');
    });
    it('a clash', () => {
      const q = runOk(createProject({ name: 't' }), 'place_structure', { kind: 'box', at: { x: '2ft', z: '2ft' } }).project;
      expect(runErr(q, 'frame_floor', floor({ support: 'piers' }))[0]!.message).toContain('The new floor would run through X1');
    });
    it('schema error', () => {
      expect(runErr(slabbed(), 'frame_floor', floor({ joistSize: '2x5' }))[0]!.message).toContain('"joistSize" must be one of');
    });
  });
});
