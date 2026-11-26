/**
 * Stock board lengths (the cut-list optimizer packs pieces into these). Every sawn and
 * engineered section the builders can pick is sold in lengths; glulam is made to order,
 * so it is cut to length.
 */
import { describe, expect, it } from 'vitest';
import { BUILDER_DEFAULTS, HEADER_TABLE, MM_PER_FOOT, MM_PER_INCH } from '@slapdash/core';
import { TIER1_CATALOG } from '../src/index.ts';

const sections = new Map(TIER1_CATALOG.sections.map((s) => [s.id, s]));
const lengths = (id: string) => (sections.get(id)?.stock ?? []).map((s) => s.length_mm);

describe('stock lengths', () => {
  it('every lumber, LVL and I-joist section has stock', () => {
    for (const s of TIER1_CATALOG.sections) {
      const sawn = s.materialCategories.includes('lumber');
      const engineered = s.materialCategories.includes('engineered-wood') && !s.id.startsWith('glulam-');
      if (sawn || engineered) expect(s.stock?.length ?? 0, s.id).toBeGreaterThan(0);
    }
  });

  it('glulam is cut to length', () => {
    for (const s of TIER1_CATALOG.sections.filter((x) => x.id.startsWith('glulam-'))) expect(s.stock, s.id).toBeUndefined();
  });

  it('2x4 and 2x6 come as 104 5/8in precut studs', () => {
    for (const id of ['2x4', '2x6']) {
      const precut = sections.get(id)!.stock!.find((s) => Math.abs(s.length_mm - 104.625 * MM_PER_INCH) < 1e-6);
      expect(precut?.name, id).toBe('precut stud');
    }
  });

  it('no stock is longer than 24ft, and each list is sorted and unique', () => {
    for (const s of TIER1_CATALOG.sections) {
      const l = lengths(s.id);
      for (const mm of l) expect(mm, s.id).toBeLessThanOrEqual(24 * MM_PER_FOOT + 1e-6);
      for (let i = 1; i < l.length; i++) expect(l[i]!, s.id).toBeGreaterThan(l[i - 1]!);
    }
  });

  it('the builder default sections and every header section have stock', () => {
    const ids = new Set<string>([
      ...Object.values(BUILDER_DEFAULTS.sections),
      ...Object.values(HEADER_TABLE).flatMap((rows) => rows.map((r) => r.sectionId)),
    ]);
    for (const id of ids) expect(lengths(id).length, id).toBeGreaterThan(0);
  });
});
