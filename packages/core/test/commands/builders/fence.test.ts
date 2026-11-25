import { describe, expect, it } from 'vitest';
import { createProject, GROUND, type Project } from '../../../src/index.ts';
import { expectRoundTrip, expectSound, runErr, runOk } from '../../helpers.ts';

const IN = 25.4;
const FT = 304.8;

const parts = (p: Project) => Object.values(p.parts);
const joints = (p: Project) => Object.values(p.joints);

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

  describe('styles', () => {
    const line = [
      { x: 0, z: 0 },
      { x: '24ft', z: 0 },
      { x: '24ft', z: '12ft' },
    ];
    it.each(['privacy', 'picket', 'chain-link', 'aluminum', 'glass'] as const)('%s builds clean, with a gate', (style) => {
      const res = expectRoundTrip(createProject({ name: 't' }), 'build_fence', {
        path: line,
        style,
        height: '4ft',
        gates: [{ centerAt: '12ft' }],
      });
      expectSound(res.project);
      const js = joints(res.project);
      expect(js.filter((j) => j.jointTypeId.startsWith('gate-hinge'))).toHaveLength(1);
      expect(js.filter((j) => j.jointTypeId.startsWith('gate-latch'))).toHaveLength(1);
      expect(parts(res.project).filter((p) => p.tags.includes('gate-post'))).toHaveLength(2);
      expect(res.project.assemblies.M1!.builder!.params).toMatchObject({ style, gates: [{ at: 10 * FT, width: 4 * FT, hinge: 'start', swing: 'out' }] });
    });

    it('chain-link: terminal posts at the ends and corner, line posts at most 10ft apart, one fabric panel per bay', () => {
      const p = runOk(createProject({ name: 't' }), 'build_fence', { path: line, style: 'chain-link' }).project;
      const posts = parts(p).filter((x) => x.role === 'post');
      expect(posts.filter((x) => x.sectionId === 'chainlink-terminal-2-3-8')).toHaveLength(3);
      // 24ft → 3 bays, 12ft → 2 bays: 3 line posts.
      expect(posts.filter((x) => x.sectionId === 'chainlink-line-1-5-8')).toHaveLength(3);
      expect(parts(p).filter((x) => x.tags.includes('fence-fabric'))).toHaveLength(5);
      expect(parts(p).filter((x) => x.tags.includes('top-rail'))).toHaveLength(2);
      expect(parts(p).find((x) => x.tags.includes('fence-fabric'))!.materialId).toBe('chain-link-fabric-2in');
    });

    it('aluminum: posts at the 6ft panel width; glass: panels at most 4ft wide on two spigots each', () => {
      const a = runOk(createProject({ name: 't' }), 'build_fence', { path: line.slice(0, 2), style: 'aluminum', height: '4ft' }).project;
      expect(parts(a).filter((x) => x.role === 'post')).toHaveLength(5);
      expect(parts(a).filter((x) => x.role === 'panel').every((x) => x.materialId === 'fence-panel-aluminum')).toBe(true);
      expect(runErr(createProject({ name: 't' }), 'build_fence', { path: line, style: 'aluminum', postSpacing: '8ft' })[0]!.message).toContain('6ft wide');

      const g = runOk(createProject({ name: 't' }), 'build_fence', { path: line.slice(0, 2), style: 'glass' }).project;
      const panels = parts(g).filter((x) => x.role === 'panel');
      expect(panels.length).toBe(6);
      expect(panels.every((x) => x.size.length <= 4 * FT + 1)).toBe(true);
      const spigots = joints(g).filter((j) => j.jointTypeId === 'glass-spigot');
      expect(spigots).toHaveLength(6);
      expect(spigots.every((j) => j.partIds[1] === GROUND && j.fastenerCount === 2)).toBe(true);
      expect(runErr(createProject({ name: 't' }), 'build_fence', { path: line, style: 'glass', height: '7ft' })[0]!.message).toContain('6\' 0"');
    });

    it('infill must suit the style', () => {
      expect(runErr(createProject({ name: 't' }), 'build_fence', { path: line, style: 'chain-link', infill: 'spf-no2' })[0]!.message).toContain('needs fencing');
    });

    it('a gate must sit inside one straight run', () => {
      const e = runErr(createProject({ name: 't' }), 'build_fence', { path: line, gates: [{ centerAt: '24ft' }] })[0]!;
      expect(e.message).toContain('inside one straight run');
    });

    it('a plain privacy fence keeps its recipe params (no new keys)', () => {
      const p = runOk(createProject({ name: 't' }), 'build_fence', { path: line }).project;
      expect(Object.keys(p.assemblies.M1!.builder!.params).sort()).toEqual(['height', 'materials', 'path', 'postSpacing', 'style']);
    });
  });

  describe('pool barrier', () => {
    const withPool = () => runOk(createProject({ name: 't' }), 'place_structure', { kind: 'pool', at: { x: '4ft', z: '4ft' }, width: '12ft', depth: '20ft' }).project;
    // Clockwise around the pool in a north-up plan (+z south): the pool is on the right.
    const around = [
      { x: 0, z: 0 },
      { x: '20ft', z: 0 },
      { x: '20ft', z: '28ft' },
      { x: 0, z: '28ft' },
      { x: 0, z: 0 },
    ];

    it('builds a 4ft picket barrier: 1 3/4in gaps, rails on the pool side, self-closing gate with a magnetic latch at 54in', () => {
      const res = expectRoundTrip(withPool(), 'build_fence', { path: around, style: 'picket', height: '4ft', poolBarrier: true, gates: [{ centerAt: '10ft' }] });
      const p = res.project;
      expectSound(p);
      const asm = Object.values(p.assemblies).find((a) => a.builder?.name === 'build_fence')!;
      expect(asm.builder!.params).toMatchObject({ poolBarrier: true, poolSide: 'right' });
      // Pickets on the first (north) run: spacing 1 3/4in between 3 1/2in boards.
      const north = parts(p)
        .filter((x) => x.tags.includes('fence-board') && !x.tags.includes('gate-leaf') && Math.abs(x.position.z) < 300 && x.position.x > 5 * FT)
        .map((x) => x.position.x)
        .sort((a, b) => a - b);
      const gaps = north.slice(1).map((x, i) => x - north[i]! - 3.5 * IN).filter((g) => g < 2 * IN);
      expect(gaps.length).toBeGreaterThan(5);
      for (const g of gaps) expect(g).toBeLessThanOrEqual(1.75 * IN + 0.5);
      // The pool is south of the north run, so rails (pool side) are south of the boards.
      const rail = parts(p).find((x) => x.role === 'rail' && Math.abs(x.position.z) < 300 && !x.tags.includes('gate-frame'))!;
      const boardOnRun = parts(p).find((x) => x.tags.includes('fence-board') && Math.abs(x.position.z) < 300)!;
      expect(rail.position.z + rail.size.width / 2).toBeGreaterThan(boardOnRun.position.z);
      const hinge = joints(p).find((j) => j.jointTypeId === 'gate-hinge-self-closing');
      const latch = joints(p).find((j) => j.jointTypeId === 'gate-latch-magnetic');
      expect(hinge).toBeDefined();
      expect(latch!.at.y).toBeGreaterThanOrEqual(54 * IN - 0.5);
      expect(res.summary).toContain('Pool barrier (reminder, not a code check)');
    });

    it('refuses a short barrier, 2in chain link and a gate swinging toward the pool', () => {
      const q = withPool();
      expect(runErr(q, 'build_fence', { path: around, height: '3ft', poolBarrier: true })[0]!.message).toContain('at least 4\' 0" tall');
      expect(runErr(q, 'build_fence', { path: around, style: 'chain-link', height: '4ft', poolBarrier: true, infill: 'chain-link-fabric-2in' })[0]!.message).toContain(
        "isn't used for pool barriers",
      );
      expect(runErr(q, 'build_fence', { path: around, height: '4ft', poolBarrier: true, gates: [{ centerAt: '10ft', swing: 'in' }] })[0]!.message).toContain(
        'must swing out',
      );
    });

    it('chain-link pool barrier uses mini mesh', () => {
      const p = runOk(withPool(), 'build_fence', { path: around, style: 'chain-link', height: '4ft', poolBarrier: true }).project;
      expect(parts(p).filter((x) => x.tags.includes('fence-fabric')).every((x) => x.materialId === 'chain-link-fabric-mini-mesh')).toBe(true);
      expectSound(p);
    });
  });
});
