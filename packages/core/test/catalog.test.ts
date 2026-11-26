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

  it('indexCatalog gives O(1) lookups', () => {
    const idx = indexCatalog(SAMPLE_CATALOG);
    expect(idx.materials.get('spf-no2')?.category).toBe('lumber');
    expect(idx.sections.get('2x4')?.dims_mm).toEqual({ width: 38.1, depth: 88.9 });
    expect(idx.jointTypes.get('post-embedded')?.behaviour).toBe('fixed');
    expect(idx.materials.get('nope')).toBeUndefined();
  });
});
