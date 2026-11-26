import { describe, expect, it } from 'vitest';
import { createProject, GROUND } from '../../../src/index.ts';
import { expectRoundTrip, runErr, runOk } from '../../helpers.ts';

const slab = (extra: Record<string, unknown> = {}) => ({ from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' }, ...extra });

describe('pour_slab', () => {
  it('pours a slab with four thickened-edge footings, all cast in place', () => {
    const res = expectRoundTrip(createProject({ name: 't' }), 'pour_slab', slab());
    const p = res.project;
    expect(p.assemblies.FD1).toMatchObject({ kind: 'foundation', buildStep: { phase: 'foundation', seq: 0 }, builder: { name: 'pour_slab' } });
    const parts = Object.values(p.parts);
    expect(parts.filter((x) => x.role === 'slab')).toHaveLength(1);
    expect(parts.filter((x) => x.role === 'footing')).toHaveLength(4);
    expect(parts.every((x) => x.buildStep.phase === 'foundation')).toBe(true);
    const s = p.parts['FD1-SB01']!;
    expect(s.position.y).toBeCloseTo(0);
    expect(s.size.height).toBeCloseTo(101.6);
    const joints = Object.values(p.joints);
    expect(joints).toHaveLength(8);
    expect(joints.every((j) => j.jointTypeId === 'cast-in-place')).toBe(true);
    expect(joints.filter((j) => j.partIds[1] === GROUND)).toHaveLength(4);
    expect(res.created).toEqual(['FD1', 'FD1-SB01', 'FD1-FT01', 'FD1-FT02', 'FD1-FT03', 'FD1-FT04']);
    expect(res.redo.name).toBe('patch_entities');
    expect(res.summary).toContain(`Poured slab FD1 "Slab": 20' 0" × 16' 0"`);
  });

  it('uses the frost depth for footings when the project sets one', () => {
    let p = runOk(createProject({ name: 't' }), 'set_design_load', { key: 'frostDepth', value: '36in', source: 'user' }).project;
    p = runOk(p, 'pour_slab', slab()).project;
    expect(p.parts['FD1-FT01']!.position.y).toBeCloseTo(-914.4);
  });

  it('without thickened edges the slab sits on the ground', () => {
    const p = runOk(createProject({ name: 't' }), 'pour_slab', slab({ thickenedEdge: false })).project;
    expect(Object.values(p.joints)).toEqual([expect.objectContaining({ partIds: ['FD1-SB01', GROUND] })]);
  });

  describe('refusals', () => {
    const p = createProject({ name: 't' });
    it('no area', () => {
      expect(runErr(p, 'pour_slab', slab({ to: { x: '20ft', z: 0 } }))[0]!.message).toContain('needs both a length and a width');
    });
    it('too thin', () => {
      expect(runErr(p, 'pour_slab', slab({ thickness: '3in' }))[0]!.message).toBe(`A structural slab is at least 3 1/2" thick (you gave 3").`);
    });
    it('too long', () => {
      expect(runErr(p, 'pour_slab', slab({ to: { x: '120ft', z: '16ft' } }))[0]!.message).toContain(`longer than 100' 0"`);
    });
    it('a clash with a placed structure', () => {
      const q = runOk(p, 'place_structure', { kind: 'house', at: { x: '10ft', z: '10ft' }, width: '30ft', depth: '30ft' }).project;
      expect(runErr(q, 'pour_slab', slab())[0]).toMatchObject({
        code: 'conflict',
        message: `The new slab would run through X1 "Existing house" (X1-X01).`,
        hint: 'Move it, or delete those parts first.',
      });
    });
    it('schema error: a length with no unit', () => {
      expect(runErr(p, 'pour_slab', slab({ thickness: '4' }))[0]!.message).toContain('has no unit');
    });
  });
});
