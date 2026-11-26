import { describe, expect, it } from 'vitest';
import { createProject } from '../../../src/index.ts';
import { expectRoundTrip, runErr, runOk } from '../../helpers.ts';

describe('place_structure', () => {
  it('places a house as stippled site context with no joints', () => {
    const res = expectRoundTrip(createProject({ name: 't' }), 'place_structure', { kind: 'house', at: { x: '-50ft', z: 0 } });
    const parts = Object.values(res.project.parts);
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.tags.includes('site-context') && p.tags.includes('stippled') && p.materialId === 'site-context')).toBe(true);
    expect(parts.map((p) => p.tags.at(-1))).toEqual(['body', 'roof-volume']);
    expect(Object.keys(res.project.joints)).toHaveLength(0);
    expect(res.project.assemblies.X1).toMatchObject({ kind: 'structure', name: 'Existing house' });
  });

  it('a pool goes below grade; a tree has a trunk and a canopy', () => {
    let p = runOk(createProject({ name: 't' }), 'place_structure', { kind: 'pool', at: { x: 0, z: 0 }, poolDepth: '5ft' }).project;
    expect(p.parts['X1-X01']!.position.y).toBeCloseTo(-1524);
    p = runOk(p, 'place_structure', { kind: 'tree', at: { x: '40ft', z: '40ft' }, height: '30ft', canopy: '20ft', rotation: 30 }).project;
    expect(Object.values(p.parts).filter((x) => x.assemblyId === 'X2').map((x) => x.tags.at(-1))).toEqual(['trunk', 'canopy']);
  });

  it('context may overlap other context, but not built parts', () => {
    let p = runOk(createProject({ name: 't' }), 'place_structure', { kind: 'tree', at: { x: 0, z: 0 } }).project;
    p = runOk(p, 'place_structure', { kind: 'house', at: { x: '-5ft', z: '-5ft' } }).project;
    p = runOk(p, 'pour_slab', { from: { x: '60ft', z: 0 }, to: { x: '70ft', z: '10ft' } }).project;
    expect(runErr(p, 'place_structure', { kind: 'shed', at: { x: '62ft', z: '2ft' } })[0]!.message).toContain('would run through FD1');
  });

  it('refuses a canopy smaller than the trunk, and bad sizes', () => {
    const p = createProject({ name: 't' });
    expect(runErr(p, 'place_structure', { kind: 'tree', at: { x: 0, z: 0 }, canopy: '6in' })[0]!.message).toContain("can't be smaller than its 1' 0\" trunk");
    expect(runErr(p, 'place_structure', { kind: 'box', at: { x: 0, z: 0 }, width: '-2ft' })[0]!.message).toContain('must be more than zero');
    expect(runErr(p, 'place_structure', { kind: 'castle', at: { x: 0, z: 0 } })[0]!.message).toContain('must be one of');
  });
});
