import { DESIGN_LOAD_RANGES, KPA_PER_PSF, MM_PER_INCH, MS_PER_MPH, normalizeLocationKey, resolveDesignLoads, createProject } from '@slapdash/core';
import { describe, expect, it } from 'vitest';
import raw from '../data/design-loads.json' with { type: 'json' };
import { DESIGN_LOAD_ROWS, DESIGN_LOAD_TABLE, validateDesignLoadRows } from '../src/index.ts';

describe('design loads table', () => {
  it('parses, with a "City, ST" label and a retrieval month on every row', () => {
    expect(validateDesignLoadRows(raw)).toMatchObject({ ok: true });
    expect(DESIGN_LOAD_ROWS.length).toBeGreaterThanOrEqual(20);
    for (const row of DESIGN_LOAD_ROWS) {
      expect(row.label).toMatch(/^[^,]+, [A-Z]{2}$/);
      expect(row.retrieved).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('keys are unique after normalising', () => {
    const keys = DESIGN_LOAD_ROWS.map((r) => normalizeLocationKey(r.label));
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(DESIGN_LOAD_TABLE).sort()).toEqual([...keys].sort());
  });

  it('every value is in the plausible range and has a non-empty source and a URL', () => {
    for (const [key, entry] of Object.entries(DESIGN_LOAD_TABLE)) {
      const row = DESIGN_LOAD_ROWS.find((r) => normalizeLocationKey(r.label) === key)!;
      expect(Object.keys(entry.loads).length, entry.label).toBeGreaterThan(0);
      for (const [k, v] of Object.entries(entry.loads)) {
        const range = DESIGN_LOAD_RANGES[k as keyof typeof DESIGN_LOAD_RANGES];
        expect(v.value, `${entry.label} ${k}`).toBeGreaterThanOrEqual(range.min);
        expect(v.value, `${entry.label} ${k}`).toBeLessThanOrEqual(range.max);
        expect(v.source.trim().length, `${entry.label} ${k}`).toBeGreaterThan(10);
        expect(row.urls?.[k as 'groundSnow'], `${entry.label} ${k} url`).toMatch(/^https:\/\//);
      }
    }
  });

  it('refuses a value without a source, a duplicate place and an implausible value', () => {
    const base = { label: 'Test, ST', groundSnowPsf: 30, windMph: null, frostDepthIn: null, sources: { groundSnow: 'x' }, retrieved: '2026-11' };
    expect(validateDesignLoadRows([{ ...base, sources: {} }])).toMatchObject({ ok: false, errors: ['Test, ST: groundSnow has no source.'] });
    expect(validateDesignLoadRows([base, { ...base, label: 'test,  ST' }])).toMatchObject({ ok: false });
    expect(validateDesignLoadRows([{ ...base, groundSnowPsf: 400 }])).toMatchObject({ ok: false, errors: ['Test, ST: groundSnow 400 is outside the plausible range.'] });
    expect(validateDesignLoadRows([{ ...base, label: 'Test' }])).toMatchObject({ ok: false });
  });

  it('converts to SI: Denver, CO (2025 Denver Residential Code, Table R301.2)', () => {
    const denver = DESIGN_LOAD_TABLE['denver, co']!;
    expect(denver.label).toBe('Denver, CO');
    expect(denver.loads.groundSnow!.value).toBeCloseTo(43 * KPA_PER_PSF, 9);
    expect(denver.loads.groundSnow!.unit).toBe('kPa');
    expect(denver.loads.windSpeed!.value).toBeCloseTo(115 * MS_PER_MPH, 9);
    expect(denver.loads.frostDepth!.value).toBeCloseTo(36 * MM_PER_INCH, 9);
    expect(denver.loads.groundSnow!.source).toBe('2025 Denver Residential Code, Table R301.2 (Denver amendments), retrieved 2026-11');
  });

  it('a partial row leaves the gap for the app fallback', () => {
    const r = resolveDesignLoads(createProject({ name: 't' }), {
      location: { label: 'Bend, OR' },
      table: DESIGN_LOAD_TABLE,
      loads: { groundSnow: { value: 30 * KPA_PER_PSF, unit: 'kPa', source: 'app default' } },
    });
    expect(r.locationInTable).toBe(true);
    expect(r.loads.groundSnow).toMatchObject({ origin: 'default', source: 'app default' });
    expect(r.loads.windSpeed).toMatchObject({ origin: 'table' });
  });
});
