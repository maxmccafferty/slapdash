import { describe, expect, it } from 'vitest';
import { createProject, findAllClashes, type Project } from '../../../src/index.ts';
import { expectRoundTrip, runErr, runOk } from '../../helpers.ts';

const IN = 25.4;
const slabbed = () => runOk(createProject({ name: 't' }), 'pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }).project;
const north = (extra: Record<string, unknown> = {}) => ({ start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '9ft', ...extra });
const parts = (p: Project, wall: string) => Object.values(p.parts).filter((x) => x.assemblyId === wall);
const byTag = (p: Project, wall: string, role: string, tag: string) => parts(p, wall).filter((x) => x.role === role && x.tags.includes(tag));

describe('build_wall', () => {
  it('frames a 20ft × 9ft wall at 16in on a slab', () => {
    const res = expectRoundTrip(slabbed(), 'build_wall', north({ name: 'North wall' }));
    const p = res.project;
    // Commons at 16, 32 … 224in (14), clear of the end studs at 0 and 238 1/2in; plus 2 end studs.
    expect(byTag(p, 'W1', 'stud', 'common')).toHaveLength(14);
    expect(byTag(p, 'W1', 'stud', 'end')).toHaveLength(2);
    for (const s of parts(p, 'W1').filter((x) => x.role === 'stud')) expect(s.size.length).toBeCloseTo(103.5 * IN);
    expect(byTag(p, 'W1', 'plate', 'bottom')[0]!.materialId).toBe('pt-spf-no2');
    expect(byTag(p, 'W1', 'plate', 'top')).toHaveLength(1);
    expect(byTag(p, 'W1', 'plate', 'top-cap')[0]!.position.y).toBeCloseTo(4 * IN + 106.5 * IN);
    // 5 columns of 4ft sheets × 2 rows (8ft + 1ft).
    expect(parts(p, 'W1').filter((x) => x.role === 'sheathing')).toHaveLength(10);
    for (const x of parts(p, 'W1')) expect(x.buildStep).toEqual({ phase: x.role === 'sheathing' ? 'sheathing' : 'framing', seq: 0 });
    expect(p.assemblies.W1).toMatchObject({ kind: 'wall', name: 'North wall', builder: { name: 'build_wall' } });
    expect(p.assemblies.W1!.builder!.params).toMatchObject({ studLength: 2628.9, baseElevation: 101.6, support: { kind: 'concrete', partIds: ['FD1-SB01'] } });

    const joints = Object.values(p.joints);
    const anchor = joints.find((j) => j.jointTypeId === 'anchor-bolt')!;
    expect(anchor).toMatchObject({ partIds: ['W1-P01', 'FD1-SB01'], fastenerCount: 4 });
    // Each stud is nailed to the bottom and the top plate.
    for (const s of parts(p, 'W1').filter((x) => x.role === 'stud')) {
      const mine = joints.filter((j) => j.partIds.includes(s.id) && j.jointTypeId === 'nailed-16d');
      expect(mine.length, s.id).toBeGreaterThanOrEqual(2);
    }
    // Every panel is nailed to framing with 8d nails; top plate to cap face-nailed.
    for (const sh of parts(p, 'W1').filter((x) => x.role === 'sheathing')) {
      expect(joints.some((j) => j.partIds[0] === sh.id && j.jointTypeId === 'nailed-8d')).toBe(true);
    }
    expect(joints.find((j) => j.partIds.includes('W1-P02') && j.partIds.includes('W1-P03'))!.fastenerCount).toBe(10);
    expect(res.summary).toContain('Built wall W1 "North wall": 20\' 0" long, 9\' 0" high, 16 2x4 studs at 16in');
  });

  it('24in spacing, 2x6 studs and a precut stud length', () => {
    const p = runOk(slabbed(), 'build_wall', north({ spacing: '24in', studSize: '2x6', studLength: '104 5/8in' })).project;
    // Commons at 24 … 216in (9) + 2 ends.
    expect(byTag(p, 'W1', 'stud', 'common')).toHaveLength(9);
    expect(byTag(p, 'W1', 'stud', 'common')[0]!.sectionId).toBe('2x6');
    expect(p.assemblies.W1!.builder!.params.height).toBeCloseTo((104.625 + 4.5) * IN);
  });

  it('runs at any plan angle', () => {
    const p = runOk(createProject({ name: 't' }), 'build_wall', { start: { x: 0, z: 0 }, end: { x: '10ft', z: '10ft' }, height: '8ft' }).project;
    expect(findAllClashes(p)).toEqual([]);
    const stud = byTag(p, 'W1', 'stud', 'end')[0]!;
    expect(stud.rotation.y).toBeCloseTo(-45);
    expect(Object.values(p.joints).filter((j) => j.jointTypeId === 'anchor-bolt')).toHaveLength(0);
  });

  it('let-in bracing instead of sheathing', () => {
    const res = expectRoundTrip(slabbed(), 'build_wall', north({ bracing: 'let-in' }));
    const braces = parts(res.project, 'W1').filter((x) => x.role === 'brace');
    expect(braces).toHaveLength(2);
    expect(braces.every((b) => b.tags.includes('brace:diagonal') && b.sectionId === '1x4')).toBe(true);
    expect(parts(res.project, 'W1').filter((x) => x.role === 'sheathing')).toHaveLength(0);
    const nailed = Object.values(res.project.joints).filter((j) => j.partIds[0] === braces[0]!.id);
    expect(nailed.length).toBeGreaterThanOrEqual(5);
  });

  it('butts into an existing wall as a California corner with a backer', () => {
    let p = runOk(slabbed(), 'build_wall', north()).project;
    const res = expectRoundTrip(p, 'build_wall', { start: { x: '20ft', z: 0 }, end: { x: '20ft', z: '16ft' }, height: '9ft' });
    p = res.project;
    const params = p.assemblies.W2!.builder!.params as Record<string, unknown>;
    expect(params.butt).toEqual({ start: 'W1', end: null });
    expect(params.frameU0).toBeCloseTo(88.9);
    expect(params.sheathU0).toBeCloseTo(-(7 / 16) * IN);
    const backers = byTag(p, 'W1', 'stud', 'corner-backer');
    expect(backers).toHaveLength(1);
    expect(backers[0]!.buildStep).toEqual({ phase: 'framing', seq: 0 });
    expect(findAllClashes(p)).toEqual([]);
    // The corner studs of the two walls are nailed together.
    const w2End = byTag(p, 'W2', 'stud', 'end')[0]!.id;
    expect(Object.values(p.joints).some((j) => j.partIds.includes(w2End) && j.partIds.some((x) => x.startsWith('W1-')))).toBe(true);
  });

  describe('refusals', () => {
    const p = slabbed();
    it('start equals end', () => {
      expect(runErr(p, 'build_wall', north({ end: { x: 0, z: 0 } }))[0]!.message).toContain('the same point');
    });
    it('shorter than two stud spaces', () => {
      expect(runErr(p, 'build_wall', north({ end: { x: '2ft', z: 0 } }))[0]!.message).toBe(
        `A wall needs at least 2' 8" of framing (two stud spaces at 16in); this one has 2' 0".`,
      );
    });
    it('too short, and studs past stock length', () => {
      expect(runErr(p, 'build_wall', north({ height: '3ft' }))[0]!.message).toContain(`at least 4' 0" tall`);
      expect(runErr(p, 'build_wall', north({ height: '22ft' }))[0]!.message).toContain(`past the 20' 0" stock length`);
    });
    it('spacing not in the list (schema)', () => {
      const e = runErr(p, 'build_wall', north({ spacing: '18in' }))[0]!;
      expect(e.message).toBe('"spacing" must be one of "12in", "16in", "19.2in", "24in" (you gave "18in").');
    });
    it('a corner part-way along a wall', () => {
      const q = runOk(p, 'build_wall', north()).project;
      expect(runErr(q, 'build_wall', { start: { x: '10ft', z: 0 }, end: { x: '10ft', z: '16ft' }, height: '9ft' })[0]!.message).toBe(
        `The start of the new wall lands part-way along W1 "Wall 1" (10' 0" from its start). Corners are only supported at wall ends.`,
      );
    });
    it('a wall whose exterior faces into its neighbour', () => {
      const q = runOk(p, 'build_wall', north()).project;
      const e = runErr(q, 'build_wall', { start: { x: '20ft', z: 0 }, end: { x: '20ft', z: '16ft' }, height: '9ft', exterior: 'right' })[0]!;
      expect(e.message).toContain('exterior side would face into W1');
    });
    it('a clash with an existing structure', () => {
      const q = runOk(createProject({ name: 't' }), 'place_structure', { kind: 'box', at: { x: '5ft', z: '-1ft' } }).project;
      expect(runErr(q, 'build_wall', north())[0]!.message).toContain('The new wall would run through X1 "Site object" (X1-X01');
    });
    it('a material that is not lumber', () => {
      expect(runErr(p, 'build_wall', north({ materials: { lumber: 'concrete-3000' } }))[0]).toMatchObject({
        path: 'materials.lumber',
        message: '3000 psi concrete ("concrete-3000") is concrete, but this needs lumber.',
      });
      expect(runErr(p, 'build_wall', north({ materials: { sheathing: 'osb-7-17' } }))[0]).toMatchObject({ code: 'not_found', hint: 'Did you mean "osb-7-16"?' });
    });
  });
});
