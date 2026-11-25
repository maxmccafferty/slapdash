/**
 * Tier 3 builders through the solver: a polycarbonate pergola puts snow on its panels and
 * through purlins and rafters to the ground; a deck carries its live load through the
 * decking to the joists. No load is lost on the way.
 */
import { describe, expect, it } from 'vitest';
import { buildLoadCases } from '../src/loads/cases.ts';
import { buildModel } from '../src/model/build.ts';
import { INDEX, build } from './helpers.ts';

describe('pergola and deck load paths', () => {
  it('a 12x16 polycarbonate pergola: snow goes on the panels, nothing is left unfastened', () => {
    const p = build([['build_pergola', { from: { x: 0, z: 0 }, to: { x: '16ft', z: '12ft' }, roofing: 'polycarbonate' }]]);
    const model = buildModel(p, INDEX);
    const loads = buildLoadCases(model);
    expect(loads.warnings.filter((w) => /not fastened|goes nowhere|No density/.test(w))).toEqual([]);
    const panels = Object.values(p.parts).filter((x) => x.role === 'sheathing').map((x) => x.id);
    expect(panels.length).toBeGreaterThan(0);
    expect(loads.cases.S.length).toBeGreaterThan(0);
    // The rafters and purlins are frame members the snow reaches.
    const members = new Set(model.members.keys());
    expect(Object.values(p.parts).filter((x) => x.role === 'rafter').every((x) => members.has(x.id))).toBe(true);
    expect(Object.values(p.parts).filter((x) => x.tags.includes('pergola-purlin')).every((x) => members.has(x.id))).toBe(true);
  });

  it('an open pergola gets no roof snow', () => {
    const p = build([['build_pergola', { from: { x: 0, z: 0 }, to: { x: '16ft', z: '12ft' } }]]);
    const loads = buildLoadCases(buildModel(p, INDEX));
    expect(loads.cases.S).toEqual([]);
  });

  it('a 12x16 deck at 4ft: live load through the decking, no lost loads', () => {
    const p = build([['build_deck', { from: { x: 0, z: 0 }, to: { x: '16ft', z: '12ft' }, height: '4ft', stairs: { side: 'south', at: '6ft' } }]]);
    const loads = buildLoadCases(buildModel(p, INDEX));
    expect(loads.warnings.filter((w) => /not fastened|goes nowhere|No density/.test(w))).toEqual([]);
    // 40 psf over the boards (25 rows of 5 1/2in on a 16ft deck; the 1/8in gaps carry nothing) reaches the joists.
    const joists = new Set(Object.values(p.parts).filter((x) => x.role === 'joist').map((x) => x.id));
    const onJoists = loads.cases.L.filter((l) => joists.has(l.partId));
    expect(onJoists.length).toBeGreaterThan(0);
    const total = loads.cases.L.reduce((s, l) => s + -l.q[1]! * (l.t1 - l.t0), 0);
    expect(total / 4.448222).toBeCloseTo(40 * 16 * ((25 * 5.5) / 12), -1);
  });
});

describe('weights of hollow and shaped sections', () => {
  it('pipe, tube and steel shapes weigh their section area, not their bounding box', async () => {
    const { shapedSectionArea } = await import('../src/loads/cases.ts');
    const sec = (id: string) => INDEX.sections.get(id)!;
    const IN = 25.4;
    // W8x10: AISC lists A = 2.96 in²; the flange-and-web sum from the catalog dims is within 5%.
    expect(shapedSectionArea(sec('w8x10'))! / (2.96 * IN * IN)).toBeCloseTo(1, 1);
    // 2in Sch 40 pipe: A = 1.07 in².
    expect(shapedSectionArea(sec('pipe-2'))! / (1.07 * IN * IN)).toBeCloseTo(1, 1);
    // HSS 3x3x3/16: A = 1.89 in² (design wall 0.174in).
    expect(shapedSectionArea(sec('hss-3x3x3-16'))! / (1.89 * IN * IN)).toBeCloseTo(1, 1);
    // Sawn lumber fills its box.
    expect(shapedSectionArea(sec('2x4'))).toBeUndefined();
  });
});
