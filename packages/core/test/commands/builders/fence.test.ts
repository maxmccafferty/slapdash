import { describe, expect, it } from 'vitest';
import { createProject, GROUND } from '../../../src/index.ts';
import { expectRoundTrip, runErr, runOk } from '../../helpers.ts';

const path = [
  { x: 0, z: 0 },
  { x: '20ft', z: 0 },
  { x: '20ft', z: '10ft' },
];

describe('build_fence', () => {
  it('posts at every corner and at most 8ft apart, set in concrete, with rails and boards', () => {
    const res = expectRoundTrip(createProject({ name: 't' }), 'build_fence', { path });
    const parts = Object.values(res.project.parts);
    // 20ft → 3 bays (4 posts), 10ft → 2 bays (2 more posts, sharing the corner).
    expect(parts.filter((p) => p.role === 'post')).toHaveLength(6);
    expect(parts.filter((p) => p.role === 'pier')).toHaveLength(6);
    // 6ft tall → 3 rails per bay, 5 bays.
    expect(parts.filter((p) => p.role === 'rail')).toHaveLength(15);
    // Privacy 1x6 boards: floor(240 / 5.5) + floor(120 / 5.5) = 43 + 21.
    expect(parts.filter((p) => p.role === 'panel')).toHaveLength(64);
    expect(parts.every((p) => p.buildStep.phase === 'site')).toBe(true);
    const post = parts.find((p) => p.role === 'post')!;
    expect(post.materialId).toBe('pt-spf-no2');
    expect(post.position.y).toBeCloseTo(-914.4); // half of 6ft below grade
    const joints = Object.values(res.project.joints);
    expect(joints.filter((j) => j.jointTypeId === 'post-embedded')).toHaveLength(6);
    expect(joints.filter((j) => j.partIds[1] === GROUND)).toHaveLength(6);
    const joined = new Set(joints.flatMap((j) => j.partIds));
    expect(parts.every((p) => joined.has(p.id))).toBe(true);
    expect(res.project.assemblies.M1).toMatchObject({ kind: 'misc', buildStep: { phase: 'site', seq: 0 } });
  });

  it('a 4ft picket fence has two rails per bay and spaced pickets', () => {
    const p = runOk(createProject({ name: 't' }), 'build_fence', { path: path.slice(0, 2), height: '4ft', style: 'picket' }).project;
    const parts = Object.values(p.parts);
    expect(parts.filter((x) => x.role === 'rail')).toHaveLength(6);
    expect(parts.filter((x) => x.role === 'panel').every((x) => x.sectionId === '1x4')).toBe(true);
    // floor((240 + 3.5) / 7) = 34 pickets.
    expect(parts.filter((x) => x.role === 'panel')).toHaveLength(34);
  });

  describe('refusals', () => {
    const p = createProject({ name: 't' });
    it('too tall', () => {
      expect(runErr(p, 'build_fence', { path, height: '9ft' })[0]!.message).toContain('Fences over 8\' 0" need engineering and usually a permit');
    });
    it('repeated points', () => {
      expect(runErr(p, 'build_fence', { path: [path[0], path[0]] })[0]!.message).toBe('path[1] repeats the point before it.');
    });
    it('posts too far apart', () => {
      expect(runErr(p, 'build_fence', { path, postSpacing: '10ft' })[0]!.message).toContain('at most 8\' 0" apart');
    });
    it('fewer than two points (schema)', () => {
      expect(runErr(p, 'build_fence', { path: [path[0]] })[0]!.message).toBe('"path" needs at least 2 items.');
    });
    it('a clash with a house', () => {
      const q = runOk(p, 'place_structure', { kind: 'house', at: { x: '5ft', z: '-5ft' }, width: '10ft', depth: '10ft' }).project;
      expect(runErr(q, 'build_fence', { path })[0]!.message).toContain('The new fence would run through X1 "Existing house"');
    });
  });
});
