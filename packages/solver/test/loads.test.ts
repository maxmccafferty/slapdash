import { KPA_PER_PSF, MS_PER_MPH } from '@slapdash/core';
import { describe, expect, it } from 'vitest';
import { solveModel } from '../src/fem/solve.ts';
import { GRAVITY, buildLoadCases, toFemCases } from '../src/loads/cases.ts';
import { LOAD_COMBINATIONS, combinationsFor } from '../src/loads/combinations.ts';
import { DEFAULT_WIND_SPEED_MS, exposureCKz, flatRoofSnow, siteLoads, slopeFactor, velocityPressure } from '../src/loads/site.ts';
import { buildModel } from '../src/model/build.ts';
import { BASIC_CASES } from '../src/types.ts';
import { INDEX, POOL_HOUSE_COMMANDS, build, poolHouse } from './helpers.ts';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('site loads (ASCE 7-22)', () => {
  it('flat-roof snow pf = 0.7·pg: 30 psf ground → 21 psf', () => {
    expect(flatRoofSnow(30 * KPA_PER_PSF) / KPA_PER_PSF).toBeCloseTo(21, 9);
  });

  it('Cs for a warm, non-slippery roof (Fig. 7.4-1)', () => {
    expect(slopeFactor(26.57)).toBe(1);
    expect(slopeFactor(30)).toBe(1);
    expect(slopeFactor(40)).toBeCloseTo(0.75, 9);
    expect(slopeFactor(70)).toBe(0);
  });

  it('Kz, exposure C, matches Table 26.10-1 (0–15 ft 0.85, 30 ft 0.98, 40 ft 1.04)', () => {
    expect(exposureCKz(0)).toBeCloseTo(0.85, 2);
    expect(exposureCKz(15 * 304.8)).toBeCloseTo(0.85, 2);
    expect(exposureCKz(30 * 304.8)).toBeCloseTo(0.98, 2);
    expect(exposureCKz(40 * 304.8)).toBeCloseTo(1.04, 2);
  });

  it('qh at 115 mph, 15 ft: the US-unit form 0.00256·Kz·Kd·V² = 24.5 psf', () => {
    const psf = 0.00256 * 0.85 * 0.85 * 115 ** 2;
    expect(rel(velocityPressure(115 * MS_PER_MPH, 0.85), psf * KPA_PER_PSF)).toBeLessThan(0.005);
  });

  it('falls back to the defaults and says so', () => {
    const p = poolHouse();
    const s = siteLoads(p, undefined);
    expect(s.groundSnow.value).toBeCloseTo(30 * KPA_PER_PSF, 9);
    expect(s.groundSnow.source).toBe('default 30 psf ground snow (no location set)');
    expect(s.windSpeed.value).toBe(DEFAULT_WIND_SPEED_MS);
    expect(s.windSpeed.source).toMatch(/115 mph/);
  });

  it("the location's table row comes through with its sources", () => {
    const p = structuredClone(poolHouse());
    const table = {
      'bend, or': {
        label: 'Bend, OR',
        loads: {
          groundSnow: { value: 25 * KPA_PER_PSF, unit: 'kPa' as const, source: 'Bend snow source' },
          windSpeed: { value: 98 * MS_PER_MPH, unit: 'm/s' as const, source: 'Bend wind source' },
        },
      },
    };
    const s = siteLoads(p, { location: { label: 'Bend, OR' }, table });
    expect(s.groundSnow).toEqual({ value: 25 * KPA_PER_PSF, unit: 'kPa', source: 'Bend snow source' });
    expect(s.windSpeed).toEqual({ value: 98 * MS_PER_MPH, unit: 'm/s', source: 'Bend wind source' });
    // The project's own location wins over the default; this one isn't in the table.
    p.site.location = { label: 'Nowhere, ZZ', source: 'project' };
    const missing = siteLoads(p, { location: { label: 'Bend, OR' }, table });
    expect(missing.groundSnow.source).toBe('default 30 psf ground snow (Nowhere, ZZ is not in the loads table)');
    expect(missing.windSpeed.source).toBe('default 115 mph basic wind speed (Nowhere, ZZ is not in the loads table)');
  });

  it('a project override wins and keeps its source', () => {
    const p = structuredClone(poolHouse());
    p.site.designLoads.groundSnow = { value: 2.4, unit: 'kPa', source: 'county building dept' };
    const s = siteLoads(p, { loads: { groundSnow: { value: 1, unit: 'kPa', source: 'app default' } } });
    expect(s.groundSnow).toEqual({ value: 2.4, unit: 'kPa', source: 'project: county building dept' });
  });
});

describe('ASD combinations (ASCE 7-22 §2.4.1)', () => {
  it('has the eight forms, wind ones over four directions, with NDS CD', () => {
    expect(LOAD_COMBINATIONS).toHaveLength(6 + 4 + 8 + 4);
    const by = Object.fromEntries(LOAD_COMBINATIONS.map((c) => [c.name, c]));
    expect(by.D!.CD).toBe(0.9);
    expect(by['D+L']!.CD).toBe(1.0);
    expect(by['D+Lr']!.CD).toBe(1.25);
    expect(by['D+S']!.CD).toBe(1.15);
    expect(by['D+0.6W+x']!.factors).toEqual({ D: 1, 'W+x': 0.6 });
    expect(by['D+0.75L+0.45W-z+0.75S']!.factors).toEqual({ D: 1, L: 0.75, 'W-z': 0.45, S: 0.75 });
    expect(by['0.6D+0.6W-x']!.CD).toBe(1.6);
  });

  it('keeps only combinations whose cases ran', () => {
    expect(combinationsFor(['D', 'S']).map((c) => c.name)).toEqual(['D', 'D+S']);
  });
});

describe('load bookkeeping on the pool house', () => {
  const project = poolHouse();
  const model = buildModel(project, INDEX);
  const loads = buildLoadCases(model);

  it('D carries every modelled part with a density or areal mass, exactly once', () => {
    let expected = 0;
    for (const p of Object.values(project.parts)) {
      const role = model.roles.get(p.id);
      if (role === 'ground' || role === 'not-connected') continue;
      const m = INDEX.materials.get(p.materialId)!;
      if (m.density_kg_m3) expected += m.density_kg_m3 * GRAVITY * 1e-9 * p.size.length * p.size.width * p.size.height;
    }
    const applied = -loads.cases.D.reduce((s, l) => s + l.q[1] * (l.t1 - l.t0), 0);
    expect(rel(applied, expected)).toBeLessThan(1e-6);
  });

  it('every sheet passes on exactly its own load', () => {
    for (const [id, W] of loads.weights) {
      if (model.roles.get(id) !== 'panel') continue;
      expect(W).toBeGreaterThan(0);
    }
    const sheetsD = [...loads.weights.entries()].filter(([id]) => model.roles.get(id) === 'panel').reduce((s, [, w]) => s + w, 0);
    const membersD = [...model.members.values()].reduce((s, m) => s + (m.material.density_kg_m3 ?? 0) * GRAVITY * 1e-9 * m.section.A * m.line.length, 0);
    const applied = -loads.cases.D.reduce((s, l) => s + l.q[1] * (l.t1 - l.t0), 0);
    expect(rel(applied, sheetsD + membersD)).toBeLessThan(1e-6);
  });

  it('snow is ps × the roof plan area', () => {
    const roofSheets = Object.values(project.parts).filter((p) => p.assemblyId === 'R1' && p.role === 'sheathing');
    const plan = roofSheets.reduce((s, p) => s + p.size.length * p.size.width * Math.cos(Math.atan(6 / 12)), 0);
    const applied = -loads.cases.S.reduce((s, l) => s + l.q[1] * (l.t1 - l.t0), 0);
    expect(rel(applied, loads.loads.roofSnow.value * 1e-3 * plan)).toBeLessThan(1e-6);
  });

  it('every basic case is in equilibrium: Σ support reactions = Σ applied', () => {
    const fem = toFemCases(model, loads.cases, BASIC_CASES);
    const sol = solveModel(model.fem, fem);
    if (!sol.ok) throw new Error('mechanism');
    sol.cases.forEach((c, ci) => {
      const applied = [0, 0, 0];
      for (const l of fem[ci]!.elementLoads) for (let k = 0; k < 3; k++) applied[k]! += l.q[k]! * (l.b - l.a);
      const reaction = [0, 0, 0];
      model.links.forEach((l, i) => {
        if (l.support) for (let k = 0; k < 3; k++) reaction[k]! -= c.linkForces[i * 6 + k]!;
      });
      const scale = Math.max(...applied.map(Math.abs), 1);
      for (let k = 0; k < 3; k++) expect(Math.abs(reaction[k]! - applied[k]!) / scale, `${c.name} ${k}`).toBeLessThan(1e-6);
    });
  });
});

describe('window and door units weigh what the single-box unit did (LOC-124)', () => {
  it('a barn door drawn as frame, slab and casing weighs density × rough opening × stud depth', () => {
    const p = build([...POOL_HOUSE_COMMANDS.slice(0, 5), ['add_opening', { wallId: 'W1', kind: 'door', centerAt: '10ft', product: 'door-barn' }]], 'Barn door');
    const units = Object.values(p.parts).filter((x) => x.assemblyId === 'O1' && x.tags.includes('unit'));
    expect(units.length).toBeGreaterThan(4);
    const loads = buildLoadCases(buildModel(p, INDEX));
    const total = units.reduce((s, x) => s + (loads.weights.get(x.id) ?? 0), 0);
    const op = p.assemblies.O1!.builder!.params as { width: number; height: number };
    const depth = (p.assemblies.W1!.builder!.params as { depth: number }).depth;
    const rho = INDEX.materials.get('door-barn')!.density_kg_m3!;
    expect(total).toBeCloseTo(rho * GRAVITY * 1e-9 * op.width * op.height * depth, 6);
  });
});
