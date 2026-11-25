/**
 * Pinned vs fixed through the catalog's joint types, on a project model: the same beam
 * held by nailed-16d joints (pinned) behaves simply supported, and by post-embedded
 * joints (fixed) behaves fixed–fixed. Self-weight is the load.
 */
import { describe, expect, it } from 'vitest';
import { internalForces } from '../src/fem/element.ts';
import { solveModel } from '../src/fem/solve.ts';
import { buildLoadCases, toFemCases } from '../src/loads/cases.ts';
import { buildModel } from '../src/model/build.ts';
import { INDEX, beamOnSupports, SECTION } from './helpers.ts';

const L = 3600;

function solveBeam(jointTypeId: string) {
  const project = beamOnSupports({ length: L, section: '2x8', jointTypeId });
  const model = buildModel(project, INDEX);
  const loads = buildLoadCases(model);
  const sol = solveModel(model.fem, toFemCases(model, loads.cases, ['D']));
  if (!sol.ok) throw new Error('mechanism');
  const info = model.members.get('B1-J01')!;
  const c = sol.cases[0]!;
  const w = -loads.cases.D[0]!.q[1]; // N/mm, self-weight
  const EI = info.material.structural!.E_MPa * info.section.Iy;
  const momentAt = (t: number) => {
    const el = [...info.elements].reverse().find((e) => e.t0 <= t + 1e-6)!;
    const out = new Float64Array(6);
    internalForces(c.endForces.subarray(el.index * 12, el.index * 12 + 6), c.localLoads[el.index]!, t - el.t0, out, 0);
    return Math.abs(out[4]!);
  };
  // Midspan deflection: the beam has nodes only at its ends, so use the element's interior shape.
  return { w, EI, momentAt, model, c, info };
}

describe('joint behaviour from the catalog', () => {
  it('nailed-16d supports: simply supported (M_mid = wL²/8, ends ≈ 0)', () => {
    const { w, momentAt } = solveBeam('nailed-16d');
    expect(momentAt(L / 2)).toBeCloseTo((w * L ** 2) / 8, -1);
    expect(Math.abs(momentAt(L / 2) - (w * L ** 2) / 8) / ((w * L ** 2) / 8)).toBeLessThan(0.005);
    expect(momentAt(0)).toBeLessThan(0.005 * ((w * L ** 2) / 8));
  });

  it('post-embedded supports: fixed (M_end = wL²/12, M_mid = wL²/24)', () => {
    const { w, momentAt } = solveBeam('post-embedded');
    expect(Math.abs(momentAt(0) - (w * L ** 2) / 12) / ((w * L ** 2) / 12)).toBeLessThan(0.005);
    expect(Math.abs(momentAt(L / 2) - (w * L ** 2) / 24) / ((w * L ** 2) / 24)).toBeLessThan(0.005);
  });

  it('the section is the 2x8 on edge (strong axis vertical)', () => {
    const { info } = solveBeam('nailed-16d');
    const [b, h] = SECTION['2x8'];
    expect(info.section.Iy).toBeCloseTo((b * h ** 3) / 12, 3);
  });
});
