import { describe, expect, it } from 'vitest';
import { BUILDER_DEFAULTS } from '../../src/builders/defaults.ts';
import { SAMPLE_CATALOG } from '../../src/catalog/sample.ts';
import { validateCatalog } from '../../src/catalog/validate.ts';

describe('builder defaults exist in the sample catalog', () => {
  const ids = (list: ReadonlyArray<{ id: string }>) => new Set(list.map((x) => x.id));
  it('materials, sections and joint types', () => {
    const m = ids(SAMPLE_CATALOG.materials);
    const s = ids(SAMPLE_CATALOG.sections);
    const j = ids(SAMPLE_CATALOG.jointTypes);
    for (const id of Object.values(BUILDER_DEFAULTS.materials)) expect(m.has(id), id).toBe(true);
    for (const id of [...Object.values(BUILDER_DEFAULTS.sections), '2x8', '2x10', '2x12']) expect(s.has(id), id).toBe(true);
    for (const id of Object.values(BUILDER_DEFAULTS.jointTypes)) expect(j.has(id), id).toBe(true);
  });

  it('the extended sample catalog still validates', () => {
    expect(validateCatalog(SAMPLE_CATALOG).ok).toBe(true);
  });

  it('lumber takes ties and anchor bolts; concrete takes anchor bolts and cast-in-place', () => {
    const get = (id: string) => SAMPLE_CATALOG.materials.find((x) => x.id === id)!;
    expect(get('spf-no2').acceptsJoints).toEqual(expect.arrayContaining(['hurricane-tie', 'anchor-bolt', 'nailed-8d']));
    expect(get('pt-spf-no2').flags).toContain('ground-contact');
    expect(get('concrete-3000').acceptsJoints).toEqual(expect.arrayContaining(['anchor-bolt', 'cast-in-place']));
  });
});
