import { describe, expect, it } from 'vitest';
import { validatePriceTable, type Material, type PriceUnit } from '@slapdash/core';
import { CATALOG_VERSION, PRICE_TABLE, CATALOG } from '../src/index.ts';

const C = CATALOG;
const entries = (key: string) => PRICE_TABLE.entries.filter((e) => e.key === key);
const materialByKey = new Map(C.materials.flatMap((m) => (m.priceKey ? [[m.priceKey, m] as const] : [])));
const sections = new Map(C.sections.map((s) => [s.id, s]));

/** Linear-foot items in categories that are otherwise priced by area. */
const LINEAR = new Set([
  'drip-edge-aluminum',
  'gutter-k5-aluminum',
  'downspout-2x3-aluminum',
  'flashing-aluminum',
  'flashing-tape',
  'trim-pvc',
  'trim-primed-pine',
  'fascia-primed-pine',
  // Tiers 2 and 3.
  'ridge-vent',
  'coping-precast-concrete',
  'coping-travertine',
  'cable-rail-infill',
  'composite-decking',
  'fence-post-aluminum',
  'drain-pipe-perforated-4in',
]);

/** Pieces in categories that are otherwise priced by area or length. */
const EACH = new Set(['cmu-standard', 'retaining-wall-block', 'pool-equipment-pad', 'shade-sail-hdpe', 'thinset-mortar', 'grout-sanded']);

/** Things sold by the foot in categories that are otherwise counted as pieces. */
const PLUMBING_ELECTRICAL_LINEAR = /^(pipe-|conduit-|wire-|cable-)/;

/** The unit each material is priced in (plan step 6), so a materials list can multiply. */
function expectedUnit(m: Material): PriceUnit {
  switch (m.id) {
    case 'rebar-gr60':
    case 'sonotube-form':
      return 'linear-ft';
    case 'gravel-base':
      return 'cu-yd';
    case 'glass-tempered':
      return 'sq-ft';
  }
  if (LINEAR.has(m.id)) return 'linear-ft';
  if (EACH.has(m.id)) return 'each';
  switch (m.category) {
    case 'lumber':
    case 'engineered-wood':
      return 'linear-ft';
    case 'sheet':
      return 'sheet';
    case 'concrete':
      return 'cu-yd';
    case 'steel':
      return 'linear-ft';
    case 'fastener':
    case 'opening':
    case 'mechanical':
    case 'sealant':
      return 'each';
    case 'plumbing':
    case 'electrical':
      return PLUMBING_ELECTRICAL_LINEAR.test(m.id) ? 'linear-ft' : 'each';
    case 'masonry':
    case 'roofing':
    case 'envelope':
    case 'insulation':
    case 'finish':
    case 'fencing':
    case 'decking':
    case 'other':
      return 'sq-ft';
    default:
      throw new Error(`no expected unit for ${m.id} (${m.category})`);
  }
}

describe('price table', () => {
  it('validates against the catalog', () => {
    const r = validatePriceTable(PRICE_TABLE, C);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it('carries its date, region and caveat; the catalog version is the same day', () => {
    expect(PRICE_TABLE.researchedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(PRICE_TABLE.researchedOn).toBe(CATALOG_VERSION);
    expect(C.catalogVersion).toBe(CATALOG_VERSION);
    expect(PRICE_TABLE.region.length).toBeGreaterThan(5);
    expect(PRICE_TABLE.note).toMatch(/not quotes/i);
  });

  it('every entry has a source note', () => {
    for (const e of PRICE_TABLE.entries) expect(e.source.trim().length, `${e.key} ${e.variant ?? ''}`).toBeGreaterThan(10);
  });

  it('every material except site context has a price key', () => {
    const missing = C.materials.filter((m) => m.category !== 'site' && m.priceKey === undefined).map((m) => m.id);
    expect(missing).toEqual([]);
    expect(C.materials.find((m) => m.id === 'site-context')!.priceKey).toBeUndefined();
  });

  it('each price key is used by exactly one material', () => {
    const keys = C.materials.flatMap((m) => (m.priceKey ? [m.priceKey] : []));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every entry is priced in the unit for its material', () => {
    for (const e of PRICE_TABLE.entries) {
      if (e.unit === undefined) continue;
      const m = materialByKey.get(e.key)!;
      expect(e.unit, `${e.key} ${e.variant ?? ''}`).toBe(expectedUnit(m));
    }
  });

  it('sectioned lumber and engineered-wood prices are per section the material can use', () => {
    for (const e of PRICE_TABLE.entries) {
      const m = materialByKey.get(e.key)!;
      if (m.category !== 'lumber' && m.category !== 'engineered-wood') continue;
      expect(e.variant, e.key).toBeDefined();
      const s = sections.get(e.variant!);
      expect(s, `${e.key} ${e.variant}`).toBeDefined();
      expect(s!.materialCategories, `${e.key} ${e.variant}`).toContain(m.category);
    }
  });

  it('the builder default sizes are priced in the default lumber', () => {
    const spf = new Set(entries('lumber.spf-no2').map((e) => e.variant));
    for (const s of ['1x4', '1x6', '2x4', '2x6', '2x8', '2x10', '2x12']) expect(spf.has(s), s).toBe(true);
    const pt = new Set(entries('lumber.pt-spf-no2').map((e) => e.variant));
    for (const s of ['2x4', '2x6', '4x4']) expect(pt.has(s), s).toBe(true);
  });

  it('pipe and conduit prices are per pipe section; steel and chain-link per its own sections', () => {
    for (const m of C.materials.filter((x) => PLUMBING_ELECTRICAL_LINEAR.test(x.id) && (x.category === 'plumbing' || x.category === 'electrical'))) {
      for (const e of entries(m.priceKey!)) {
        if (e.variant === undefined) continue;
        expect(e.variant, `${e.key}`).toMatch(/^pipe-/);
        expect(sections.get(e.variant)!.materialCategories).toContain(m.category);
      }
    }
    expect(entries('plumbing.pipe-pvc-dwv').map((e) => e.variant)).toEqual(expect.arrayContaining(['pipe-2', 'pipe-3', 'pipe-4']));
    for (const m of C.materials.filter((x) => x.category === 'steel')) {
      for (const e of entries(m.priceKey!)) if (e.variant !== undefined) expect(sections.get(e.variant)!.materialCategories, `${e.key} ${e.variant}`).toContain('steel');
    }
  });

  it('sheet-good variants are thicknesses', () => {
    for (const m of C.materials.filter((x) => x.category === 'sheet')) {
      for (const e of entries(m.priceKey!)) if (e.variant !== undefined) expect(e.variant).toMatch(/^\d+(\/\d+)?in$/);
    }
    expect(entries('sheet.plywood-cdx').map((e) => e.variant)).toEqual(['1/2in', '5/8in', '23/32in']);
    expect(entries('sheet.drywall-gypsum').map((e) => e.variant)).toEqual(['1/2in', '5/8in']);
  });

  it('hardware sized by what it holds has those variants', () => {
    expect(entries('fastener.joist-hanger').map((e) => e.variant)).toEqual(['2x6', '2x8', '2x10']);
    expect(entries('fastener.post-base').map((e) => e.variant)).toEqual(['4x4', '6x6']);
  });

  it('the generic opening unit is unpriced, with the reason', () => {
    const [e] = entries('opening.opening-unit');
    expect(e?.unpriced).toMatch(/specific window or door/);
  });

  it('prices are within sanity bounds for their unit (catches unit mix-ups)', () => {
    const bounds: Record<PriceUnit, [number, number]> = {
      each: [0.005, 5000],
      'linear-ft': [0.05, 60],
      'sq-ft': [0.05, 60],
      sheet: [5, 150],
      'cu-yd': [20, 600],
      lb: [0.1, 50],
    };
    for (const e of PRICE_TABLE.entries) {
      if (e.unit === undefined) continue;
      const [lo, hi] = bounds[e.unit];
      const label = `${e.key} ${e.variant ?? ''}`;
      expect(e.low_usd!, label).toBeGreaterThanOrEqual(lo);
      expect(e.high_usd!, label).toBeLessThanOrEqual(hi);
    }
    for (const m of C.materials.filter((x) => x.category === 'lumber')) {
      for (const e of entries(m.priceKey!)) {
        if (e.unit === undefined) continue;
        expect(e.low_usd!, `${e.key} ${e.variant}`).toBeGreaterThanOrEqual(0.1);
        expect(e.high_usd!, `${e.key} ${e.variant}`).toBeLessThanOrEqual(40);
      }
    }
  });
});
