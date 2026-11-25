import { describe, expect, it } from 'vitest';
import { SAMPLE_CATALOG, indexCatalog, migrateCatalog, validateCatalog, type Catalog } from '../src/index.ts';

const clone = (): Catalog => structuredClone(SAMPLE_CATALOG);

describe('catalog', () => {
  it('the sample catalog validates', () => {
    const r = validateCatalog(SAMPLE_CATALOG);
    expect(r).toEqual({ ok: true, catalog: SAMPLE_CATALOG });
  });

  it('reports duplicate ids', () => {
    const c = clone();
    c.materials.push({ ...c.materials[0]! });
    c.sections.push({ ...c.sections[0]! });
    const r = validateCatalog(c);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContain('Two materials share the id "spf-no2"; ids must be unique.');
      expect(r.errors).toContain('Two sections share the id "2x4"; ids must be unique.');
    }
  });

  it('reports dangling acceptsJoints references', () => {
    const c = clone();
    c.materials[0]!.acceptsJoints.push('glued-magic');
    const r = validateCatalog(c);
    expect(r).toEqual({
      ok: false,
      errors: ['Material "spf-no2" accepts joint type "glued-magic", which isn\'t in the catalog.'],
    });
  });

  it('reports shape errors in plain language', () => {
    const c = clone() as unknown as { jointTypes: Array<Record<string, unknown>> };
    c.jointTypes[0]!.behaviour = 'semi-rigid';
    const r = validateCatalog(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('"jointTypes[0].behaviour" must be one of "pinned", "fixed"');
  });

  it('rejects unknown and missing schema versions', () => {
    expect(validateCatalog({ ...clone(), schemaVersion: 7 })).toEqual({
      ok: false,
      errors: ['This catalog is version 7; this app understands up to 1.'],
    });
    const { schemaVersion: _v, ...noVersion } = clone();
    const r = migrateCatalog(noVersion);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('no schemaVersion');
    expect(migrateCatalog([]).ok).toBe(false);
  });

  it('accepts the optional tier-1 fields', () => {
    const c = clone();
    c.materials.push({
      id: 'nail-16d-common',
      name: '16d common nail',
      category: 'fastener',
      acceptsJoints: [],
      swatch: { color: '#9a9ca0', metalness: 0.8, roughness: 0.4 },
    });
    c.materials[0]!.swatch = { color: '#d9b98a' };
    c.materials[0]!.structural!.Fc_perp_MPa = 2.93;
    c.materials[0]!.source = 'NDS 2018 Supplement Table 4A';
    c.materials[4]!.strength = { compressive_MPa: 20.7, E_MPa: 24855 };
    c.jointTypes[0]!.hardwareId = 'nail-16d-common';
    c.jointTypes[0]!.source = 'NDS 2018 Table 12N';
    expect(validateCatalog(c).ok).toBe(true);
  });

  it('a swatch colour must be lower-case #rrggbb', () => {
    const c = clone();
    c.materials[0]!.swatch = { color: 'tan' };
    const r = validateCatalog(c);
    expect(r).toEqual({
      ok: false,
      errors: ['"materials[0].swatch.color" should be a lower-case hex colour like "#c8a46e".'],
    });
  });

  it('a strength block needs at least one value', () => {
    const c = clone();
    c.materials[4]!.strength = {};
    const r = validateCatalog(c);
    expect(r).toEqual({ ok: false, errors: ['"materials[4].strength" should give at least one value.'] });
  });

  it('reports a joint type whose hardware is missing or not a fastener', () => {
    const c = clone();
    c.jointTypes[0]!.hardwareId = 'nail-99d';
    c.jointTypes[1]!.hardwareId = 'plywood-cdx';
    const r = validateCatalog(c);
    expect(r).toEqual({
      ok: false,
      errors: [
        'Joint type "nailed-16d" uses hardware "nail-99d", which isn\'t in the catalog.',
        'Joint type "nailed-8d" uses hardware "plywood-cdx", but "plywood-cdx" is sheet, not a fastener.',
      ],
    });
  });

  it('reports stock lengths that are out of order or repeated', () => {
    const c = clone();
    c.sections[0]!.stock = [{ length_mm: 3048 }, { length_mm: 2438.4 }];
    c.sections[1]!.stock = [{ length_mm: 2438.4 }, { length_mm: 2438.4 }];
    const r = validateCatalog(c);
    expect(r).toEqual({
      ok: false,
      errors: [
        'Section "2x4" lists its stock lengths out of order; put them shortest first.',
        'Section "2x6" lists the stock length 2438.4 mm twice.',
      ],
    });
  });

  it('a stock length must be more than zero', () => {
    const c = clone();
    c.sections[0]!.stock = [{ length_mm: 0 }];
    expect(validateCatalog(c).ok).toBe(false);
  });

  it('indexCatalog gives O(1) lookups', () => {
    const idx = indexCatalog(SAMPLE_CATALOG);
    expect(idx.materials.get('spf-no2')?.category).toBe('lumber');
    expect(idx.sections.get('2x4')?.dims_mm).toEqual({ width: 38.1, depth: 88.9 });
    expect(idx.jointTypes.get('post-embedded')?.behaviour).toBe('fixed');
    expect(idx.materials.get('nope')).toBeUndefined();
  });
});
