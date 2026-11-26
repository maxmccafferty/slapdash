import { describe, expect, it } from 'vitest';
import { createProject, SAMPLE_CATALOG, takeoff, type PriceTable, type Project } from '../../../src/index.ts';
import { expectRoundTrip, expectSound, runErr, runOk } from '../../helpers.ts';

const FT = 304.8;
const parts = (p: Project) => Object.values(p.parts);
const base = { from: { x: 0, z: 0 }, to: { x: '16ft', z: '12ft' } };

describe('build_pergola', () => {
  it('a 12x16 open pergola: posts on piers, doubled beams, rafters with ties, one misc assembly', () => {
    const res = expectRoundTrip(createProject({ name: 't' }), 'build_pergola', base);
    const p = res.project;
    expectSound(p);
    expect(Object.values(p.assemblies).map((a) => a.kind)).toEqual(['misc']);
    // 16ft beams of doubled 2x8 (8ft spans): 3 posts a row, 2 rows.
    expect(parts(p).filter((x) => x.role === 'post')).toHaveLength(6);
    expect(parts(p).filter((x) => x.role === 'pier')).toHaveLength(6);
    expect(parts(p).filter((x) => x.role === 'beam')).toHaveLength(4);
    const rafters = parts(p).filter((x) => x.role === 'rafter');
    // 16in spacing over 16ft: 0, then 12 between, then the end.
    expect(rafters.length).toBeGreaterThanOrEqual(12);
    expect(Object.values(p.joints).filter((j) => j.jointTypeId === 'hurricane-tie')).toHaveLength(rafters.length * 2);
    expect(res.summary).toContain('Built pergola');
  });

  it('with polycarbonate: a roof assembly of rafters, purlins and polycarbonate sheathing at 1 in 12', () => {
    const res = expectRoundTrip(createProject({ name: 't' }), 'build_pergola', { ...base, roofing: 'polycarbonate' });
    const p = res.project;
    expectSound(p);
    const roof = Object.values(p.assemblies).find((a) => a.kind === 'roof')!;
    expect(roof.builder).toMatchObject({ name: 'build_pergola', params: { part: 'roof' } });
    const panels = parts(p).filter((x) => x.role === 'sheathing');
    expect(panels.length).toBe(8); // 16ft / 24in cover
    for (const x of panels) {
      expect(x.materialId).toBe('polycarbonate-corrugated');
      expect(x.assemblyId).toBe(roof.id);
      expect(x.tags).not.toContain('brace:panel');
    }
    expect(parts(p).filter((x) => x.role === 'rafter').every((x) => x.assemblyId === roof.id)).toBe(true);
    // Slope: the high posts are taller than the low ones by 1/12 of the run between rows.
    const posts = parts(p).filter((x) => x.role === 'post');
    const tallest = Math.max(...posts.map((x) => x.size.length));
    const shortest = Math.min(...posts.map((x) => x.size.length));
    expect(tallest - shortest).toBeCloseTo((12 * FT - 139.7) / 12, 1);
    expect(Object.values(p.joints).filter((j) => j.jointTypeId === 'screwed-roofing').length).toBeGreaterThan(0);
    expect(res.summary).toContain('closure strips');
  });

  it('refuses polycarbonate below 1 in 12', () => {
    expect(runErr(createProject({ name: 't' }), 'build_pergola', { ...base, roofing: 'polycarbonate', slope: '0.5 in 12' })[0]!.message).toContain(
      'at least 1 in 12',
    );
  });

  it('prices the panels per square foot', () => {
    const p = runOk(createProject({ name: 't' }), 'build_pergola', { ...base, roofing: 'polycarbonate' }).project;
    const table: PriceTable = {
      schemaVersion: 1,
      currency: 'USD',
      researchedOn: '2026-11-25',
      region: 'test',
      note: 'Planning estimates, not quotes.',
      entries: [{ key: 'roofing.polycarbonate-corrugated', description: 'x', unit: 'sq-ft', low_usd: 2, high_usd: 3, source: 'test entry for the takeoff' }],
    };
    const cat = { ...SAMPLE_CATALOG, materials: SAMPLE_CATALOG.materials.map((m) => (m.id === 'polycarbonate-corrugated' ? { ...m, priceKey: 'roofing.polycarbonate-corrugated' } : m)) };
    const rows = takeoff(p, cat, table).groups.flatMap((g) => g.rows);
    const row = rows.find((r) => r.materialId === 'polycarbonate-corrugated')!;
    expect(row.measure).toBe('sq-ft');
    expect(row.step).toBe('pergola');
    expect(row.cost?.unit).toBe('sq-ft');
    expect(row.quantity).toBeGreaterThan(16 * 14 - 1);
  });

  it('a long side gets intermediate posts from the beam span table', () => {
    const p = runOk(createProject({ name: 't' }), 'build_pergola', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '10ft' }, beamSize: '2x10' }).project;
    // 20ft of doubled 2x10 (10ft spans) → 3 posts a row.
    expect(parts(p).filter((x) => x.role === 'post')).toHaveLength(6);
  });
});
