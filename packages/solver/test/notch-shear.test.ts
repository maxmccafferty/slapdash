/**
 * The birdsmouth notch-shear check (NDS 3.4.3.2): at a support where the member is notched,
 * (a) on the tension face V'r = ⅔·F'v·b·dn·(dn/d)², (b) on the compression face
 * V'r = ⅔·F'v·b·[d − ((d − dn)/dn)·e].
 */
import type { PartCuts, Project } from '@slapdash/core';
import { describe, expect, it } from 'vitest';
import { analyze, notchShearCapacity, notchShearCapacityCompression, notchedFaceInCompression } from '../src/index.ts';
import { internalForces } from '../src/fem/element.ts';
import { solveModel } from '../src/fem/solve.ts';
import { GRAVITY, buildLoadCases, toFemCases } from '../src/loads/cases.ts';
import { buildModel } from '../src/model/build.ts';
import { CATALOG, INDEX, SECTION, handProject, poolHouse } from './helpers.ts';

const L = 3000;
const [b, d] = SECTION['2x6'];
const mat = CATALOG.materials.find((m) => m.id === 'spf-no2')!;
/** Self-weight per mm, N/mm, and F'v under D (CD = 0.9). */
const w = mat.density_kg_m3! * 1e-9 * GRAVITY * b * d;
const FvD = mat.structural!.Fv_MPa * 0.9;

/**
 * A 2x6 rafter along +x with its local z (depth) pointing UP, so local z = 0 is the bottom
 * face: rotation x = −90° takes local y to world −z and local z to world +y. Supports to
 * GROUND on the centreline at each of `supports` (x, mm).
 */
function rafter(supports: number[], cuts?: PartCuts): Project {
  const p = handProject(
    [
      {
        id: 'B1-R01',
        role: 'rafter',
        materialId: 'spf-no2',
        sectionId: '2x6',
        assemblyId: 'B1',
        position: { x: 0, y: 0, z: b },
        rotation: { x: -90, y: 0, z: 0 },
        size: { length: L, width: b, height: d },
      },
    ],
    supports.map((x, i) => ({ id: `J000${i + 1}`, jointTypeId: 'nailed-16d', partIds: ['B1-R01', 'GROUND'] as [string, string], at: { x, y: d / 2, z: b / 2 } })),
    { B1: { kind: 'structure' } },
  );
  if (cuts) p.parts['B1-R01'] = { ...p.parts['B1-R01']!, cuts };
  return p;
}

/** A d/3 seat cut up from the bottom face over x0…x1, pushed 1 mm past the faces it exits. */
const seat = (x0: number, x1: number): PartCuts => ({
  notches: [{ kind: 'birdsmouth', profile: [{ x: x0, z: -1 }, { x: x1, z: -1 }, { x: x1, z: d / 3 }, { x: x0, z: d / 3 }] }],
});

describe('notch shear', () => {
  it('moment sign: a simply supported member under gravity sags, My < 0, bottom face in tension', () => {
    const model = buildModel(rafter([0, L]), INDEX);
    const cases = buildLoadCases(model, {});
    const sol = solveModel(model.fem, toFemCases(model, cases.cases, ['D']));
    if (!sol.ok) throw new Error('mechanism');
    const c = sol.cases[0]!;
    // The member is one element between its two supports.
    const out = new Float64Array(6);
    internalForces(c.endForces.subarray(0, 6), c.localLoads[0]!, L / 2, out, 0);
    const My = out[4]!;
    expect(My).toBeCloseTo(-(w * L * L) / 8, 0);
    expect(notchedFaceInCompression('bottom', My)).toBe(false);
    expect(notchedFaceInCompression('top', My)).toBe(true);
  });

  it('(a) a d/3 birdsmouth on the tension face at a pinned end matches the hand calculation', () => {
    const r = analyze(rafter([0, L], seat(-1, 100)), INDEX, { cases: ['D'] });
    const res = r.parts['B1-R01']!;
    const got = res.checks['notch-shear'];
    expect(got).toBeDefined();
    // The notch starts at the end, so only its span side is checked: the section 5 mm past
    // x1 = 100, where V = w·(L/2 − 105) and the member sags (My < 0): NDS (a).
    const V = w * (L / 2 - 105);
    const dn = d - d / 3;
    const hand = V / ((2 / 3) * FvD * b * dn * (dn / d) ** 2);
    expect(Math.abs(got!.utilization - hand) / hand).toBeLessThan(0.01);
    expect(notchShearCapacity(FvD, b, d, dn)).toBeCloseTo((2 / 3) * FvD * b * dn * (4 / 9), 9);
    // (d/dn)³ = 3.375 times the full-section shear there; the shear check's own worst is
    // at the support, wL/2.
    expect(got!.utilization / res.checks.shear!.utilization).toBeCloseTo(3.375 * (1 - 105 / (L / 2)), 2);
  });

  it('(b) a seat with a tail past it: the tail hogs over the support, so the bottom face is in compression', () => {
    // Supports at x = a and x = L; the tail (0…a) cantilevers past the first. The seat runs
    // from 40 mm before the support to 50 mm past it. Both sections just outside it (5 mm)
    // still hog (the tail moment w·x²/2 beats R1·(x − a) at a + 55), so both are (b); the
    // span side governs: V = R1 − w·(a + 55), e = 50 mm (< dn). The tail side has
    // V = w·(a − 45), e = 40 mm.
    const a = 600;
    const r = analyze(rafter([a, L], seat(a - 40, a + 50)), INDEX, { cases: ['D'] });
    const got = r.parts['B1-R01']!.checks['notch-shear'];
    expect(got).toBeDefined();
    const R1 = (w * L * L) / 2 / (L - a);
    const V = R1 - w * (a + 55);
    expect(V).toBeGreaterThan(w * (a - 45));
    const dn = d - d / 3;
    const capB = (2 / 3) * FvD * b * (d - ((d - dn) / dn) * 50);
    expect(notchShearCapacityCompression(FvD, b, d, dn, 50)).toBeCloseTo(capB, 9);
    expect(Math.abs(got!.utilization - V / capB) / (V / capB)).toBeLessThan(0.01);
    // (a) would have read (d/dn)²·… higher: (b) is the gentler formula for a short e.
    expect(got!.utilization).toBeLessThan(V / notchShearCapacity(FvD, b, d, dn));
  });

  it('a load passing between two connections on the seat is not shear across the notch', () => {
    // The rafter (seat 400…500 mm) rests on GROUND at x = 470 and x = L. A long 2x12 rests
    // on it at x = 430 and on GROUND at its far end, so about half its weight goes into the
    // rafter at 430 and straight out at 470, both inside the seat.
    const base = rafter([470, L], seat(400, 500));
    const plain = analyze(base, INDEX, { cases: ['D'] }).parts['B1-R01']!;
    const [bb, hb] = SECTION['2x12'];
    const loaded = structuredClone(base);
    loaded.parts['B1-B01'] = {
      ...loaded.parts['B1-R01']!,
      id: 'B1-B01',
      role: 'beam',
      sectionId: '2x12',
      cuts: undefined,
      // On edge along +z: local x → +z, y → +x, z → +y, which is Euler XYZ (−90°, 0, −90°).
      // It runs from z = b − 6000 to z = b, its end over the rafter.
      position: { x: 430 - bb / 2, y: d, z: b - 6000 },
      rotation: { x: -90, y: 0, z: -90 },
      size: { length: 6000, width: bb, height: hb },
    };
    delete (loaded.parts['B1-B01'] as { cuts?: unknown }).cuts;
    loaded.joints.J0010 = { id: 'J0010', jointTypeId: 'nailed-16d', partIds: ['B1-B01', 'B1-R01'], at: { x: 430, y: d, z: b / 2 }, fastenerCount: 3 };
    loaded.joints.J0011 = { id: 'J0011', jointTypeId: 'nailed-16d', partIds: ['B1-B01', 'GROUND'], at: { x: 430, y: d + hb / 2, z: b - 6000 }, fastenerCount: 3 };
    const res = analyze(loaded, INDEX, { cases: ['D'] });
    const withBeam = res.parts['B1-R01']!;
    expect(res.status).toBe('ok');
    // The transfer shows in the full-section shear between the two links …
    expect(withBeam.checks.shear!.utilization).toBeGreaterThan(3 * plain.checks.shear!.utilization);
    // … but not across the notch.
    expect(withBeam.checks['notch-shear']!.utilization).toBeLessThan(1.2 * plain.checks['notch-shear']!.utilization);
  });

  it('the same rafter uncut has no notch-shear check', () => {
    const r = analyze(rafter([0, L]), INDEX, { cases: ['D'] });
    expect(r.parts['B1-R01']!.checks['notch-shear']).toBeUndefined();
  });

  it('builder gable rafters (16 × 20 at 6/12) are checked at their birdsmouths', () => {
    const p = poolHouse();
    const r = analyze(p, INDEX);
    const rafters = Object.values(p.parts).filter((x) => x.role === 'rafter' && x.tags.includes('common'));
    const notch = (id: string) => r.parts[id]!.checks['notch-shear']!;
    for (const x of rafters) expect(notch(x.id).utilization, x.id).toBeGreaterThan(0);
    // Taken across the notch (the sections just outside the seat), every rafter is well
    // under its limit: interior rafters peak about 0.28 and the gable-end rafters about
    // 0.17–0.22, all under wind (0.6D+0.6W). The end rafters' heel-joint-to-plate transfer
    // (inside the seat) no longer counts.
    const ends = new Set([0, 1, rafters.length - 2, rafters.length - 1].map((i) => rafters[i]!.id));
    const interior = rafters.filter((x) => !ends.has(x.id)).map((x) => notch(x.id).utilization);
    expect(Math.max(...interior)).toBeLessThan(0.4);
    for (const id of ends) expect(notch(id).utilization, id).toBeLessThan(0.4);
  });
});
