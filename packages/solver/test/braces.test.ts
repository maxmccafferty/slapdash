/**
 * Shear panels and let-in braces (ADR-0002 §E5).
 */
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/index.ts';
import { panelUnitShear } from '../src/checks/panels.ts';
import { solveModel } from '../src/fem/solve.ts';
import { buildModel } from '../src/model/build.ts';
import { INDEX, handProject, wallBox } from './helpers.ts';

const B = 1219.2;
const H = 2438.4;
const T = 38.1;
const D = 88.9;

/** A 4×8 OSB panel nailed to a pinned 2x4 frame (two studs, two plates), bottom plate pinned to the ground. */
function panelFrame() {
  return handProject(
    [
      { id: 'W1-P01', role: 'plate', materialId: 'spf-no2', sectionId: '2x4', position: { x: 0, y: 0, z: 0 }, size: { length: B, width: T, height: D }, tags: ['bottom'] },
      { id: 'W1-P02', role: 'plate', materialId: 'spf-no2', sectionId: '2x4', position: { x: 0, y: H - T, z: 0 }, size: { length: B, width: T, height: D }, tags: ['top'] },
      { id: 'W1-S01', role: 'stud', materialId: 'spf-no2', sectionId: '2x4', position: { x: T, y: T, z: 0 }, rotation: { x: 0, y: 0, z: 90 }, size: { length: H - 2 * T, width: T, height: D } },
      { id: 'W1-S02', role: 'stud', materialId: 'spf-no2', sectionId: '2x4', position: { x: B, y: T, z: 0 }, rotation: { x: 0, y: 0, z: 90 }, size: { length: H - 2 * T, width: T, height: D } },
      { id: 'W1-SH01', role: 'sheathing', materialId: 'osb-7-16', position: { x: 0, y: 0, z: -11.1125 }, size: { length: B, width: H, height: 11.1125 }, tags: ['brace:panel'] },
    ],
    [
      { id: 'J0001', jointTypeId: 'nailed-16d', partIds: ['W1-S01', 'W1-P01'], at: { x: T / 2, y: T, z: D / 2 } },
      { id: 'J0002', jointTypeId: 'nailed-16d', partIds: ['W1-S01', 'W1-P02'], at: { x: T / 2, y: H - T, z: D / 2 } },
      { id: 'J0003', jointTypeId: 'nailed-16d', partIds: ['W1-S02', 'W1-P01'], at: { x: B - T / 2, y: T, z: D / 2 } },
      { id: 'J0004', jointTypeId: 'nailed-16d', partIds: ['W1-S02', 'W1-P02'], at: { x: B - T / 2, y: H - T, z: D / 2 } },
      { id: 'J0005', jointTypeId: 'anchor-bolt', partIds: ['W1-P01', 'GROUND'], at: { x: 0, y: T / 2, z: D / 2 } },
      { id: 'J0006', jointTypeId: 'anchor-bolt', partIds: ['W1-P01', 'GROUND'], at: { x: B, y: T / 2, z: D / 2 } },
      ...(['W1-P01', 'W1-P02', 'W1-S01', 'W1-S02'] as const).map((id, i) => ({
        id: `J001${i}`,
        jointTypeId: 'nailed-8d',
        partIds: ['W1-SH01', id] as [string, string],
        at: { x: B / 2, y: H / 2, z: 0 },
      })),
    ],
    { W1: { kind: 'wall' } },
  );
}

describe('shear panel', () => {
  const sp = INDEX.materials.get('osb-7-16')!.shearPanel!;
  const model = buildModel(panelFrame(), INDEX);
  // Hold the top plate's ends out of plane (z and y) but leave them free to rack (x).
  const top = model.members.get('W1-P02')!;
  const ends = [top.nodes[0]!.node, top.nodes[top.nodes.length - 1]!.node];
  for (const n of ends) model.fem.links.push({ a: n, b: -1, kt: model.stiffness.kt, kr: 0, release: [1, 0, 0] });
  const P = 4000;
  const sol = solveModel(model.fem, [
    { name: 'H', elementLoads: [], nodalLoads: ends.map((node) => ({ node, f: [P / 2, 0, 0, 0, 0, 0] })) },
  ]);
  if (!sol.ok) throw new Error('mechanism');
  const c = sol.cases[0]!;
  const drift = ends.reduce((s, n) => s + c.u[n * 6]!, 0) / 2;

  it('a 4×8 OSB panel on a pinned 2x4 frame racks at Ga·b/h (within 1%)', () => {
    const K = P / drift;
    expect(Math.abs(K - (sp.Ga_N_per_mm * B) / H) / ((sp.Ga_N_per_mm * B) / H)).toBeLessThan(0.01);
  });

  it('its unit shear is the racking load over its width, checked against vAllowable', () => {
    const k = model.panels.get('W1-SH01')!.shearPanel!;
    const v = panelUnitShear(sp.Ga_N_per_mm, c.panelStrain[k]!);
    expect(Math.abs(v - P / B) / (P / B)).toBeLessThan(0.01);
    expect(v / sp.vAllowable_N_per_mm).toBeCloseTo(P / B / sp.vAllowable_N_per_mm, 1);
  });

  it('carries nothing under uniform squash (unlike an X of diagonals)', () => {
    const squash = solveModel(model.fem, [
      { name: 'V', elementLoads: [], nodalLoads: ends.map((node) => ({ node, f: [0, -5000, 0, 0, 0, 0] })) },
    ]);
    if (!squash.ok) throw new Error('mechanism');
    const k = model.panels.get('W1-SH01')!.shearPanel!;
    expect(Math.abs(panelUnitShear(sp.Ga_N_per_mm, squash.cases[0]!.panelStrain[k]!))).toBeLessThan(1e-3);
  });

  it('a sheet material without shearPanel braces nothing, with a warning', () => {
    const p = panelFrame();
    p.parts['W1-SH01']!.materialId = 'osb-23-32';
    const m = buildModel(p, INDEX);
    expect(m.fem.panels).toHaveLength(0);
    expect(m.warnings.join(' ')).toMatch(/W1-SH01.*no shear-panel values/);
  });
});

describe('braced and unbraced walls', () => {
  it('a sheathed box stands', () => {
    const r = analyze(wallBox('sheathing'), INDEX);
    expect(r.status).toBe('ok');
    expect(r.unstable).toEqual([]);
    const panels = Object.values(r.parts).filter((p) => p.role === 'panel');
    expect(panels.length).toBeGreaterThan(0);
    expect(panels.every((p) => p.checks['panel-shear'] !== undefined)).toBe(true);
  });

  it('with no bracing, every wall racks, in plain words', () => {
    const r = analyze(wallBox('none'), INDEX);
    expect(r.status).toBe('ok');
    expect(r.unstable.map((u) => u.assemblyId).sort()).toEqual(['W1', 'W2', 'W3', 'W4']);
    expect(r.unstable[0]!.message).toMatch(/^W\d racks: it needs sheathing or a let-in brace/);
    expect(r.parts[r.unstable[0]!.partIds[0]!]!.unstable).toBe(true);
  });

  it('with let-in braces it stands, and the braces carry axial force', () => {
    const r = analyze(wallBox('let-in'), INDEX);
    expect(r.status).toBe('ok');
    expect(r.unstable).toEqual([]);
    const braces = Object.values(r.parts).filter((p) => p.role === 'truss');
    expect(braces).toHaveLength(8);
    for (const b of braces) {
      const axial = Math.max(b.checks.tension?.utilization ?? 0, b.checks.compression?.utilization ?? 0);
      expect(axial, b.id).toBeGreaterThan(0.01);
    }
  });
});
