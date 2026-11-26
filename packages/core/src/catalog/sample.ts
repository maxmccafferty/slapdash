/**
 * SAMPLE DATA ONLY — a tiny catalog for tests and the smoke script. It is not the
 * tier-1 catalog (that lives in `packages/catalog`) and its numbers are rounded
 * placeholders, not design values.
 */
import type { Catalog } from './schema.ts';

export const SAMPLE_CATALOG: Catalog = {
  schemaVersion: 1,
  catalogVersion: 'sample-2026-11-25',
  materials: [
    {
      id: 'spf-no2',
      name: 'SPF No.2 lumber',
      category: 'lumber',
      species: 'spruce-pine-fir',
      grade: 'No.2',
      structural: { E_MPa: 9500, Fb_MPa: 6.0, Fv_MPa: 0.9, Ft_MPa: 3.0, Fc_MPa: 7.2 },
      density_kg_m3: 420,
      acceptsJoints: ['nailed-16d', 'joist-hanger', 'post-base', 'post-embedded'],
      priceKey: 'lumber.spf-no2',
    },
    {
      id: 'plywood-cdx',
      name: 'CDX plywood',
      category: 'sheet',
      density_kg_m3: 500,
      acceptsJoints: ['nailed-8d'],
    },
    {
      id: 'concrete-3000',
      name: '3000 psi concrete',
      category: 'concrete',
      density_kg_m3: 2400,
      acceptsJoints: ['post-base', 'post-embedded'],
      flags: ['ground-contact'],
    },
    {
      id: 'steel-a36',
      name: 'A36 structural steel',
      category: 'steel',
      structural: { E_MPa: 200000, Fb_MPa: 150, Fv_MPa: 100 },
      density_kg_m3: 7850,
      acceptsJoints: ['welded-fillet'],
    },
  ],
  sections: [
    {
      id: '2x4',
      name: '2x4',
      nominal: '2x4',
      shape: 'rect',
      dims_mm: { width: 38.1, depth: 88.9 },
      materialCategories: ['lumber'],
    },
    {
      id: '2x6',
      name: '2x6',
      nominal: '2x6',
      shape: 'rect',
      dims_mm: { width: 38.1, depth: 139.7 },
      materialCategories: ['lumber'],
    },
    {
      id: '4x4',
      name: '4x4',
      nominal: '4x4',
      shape: 'rect',
      dims_mm: { width: 88.9, depth: 88.9 },
      materialCategories: ['lumber'],
    },
    {
      id: 'hss-2x2',
      name: 'HSS 2x2x1/4',
      shape: 'tube',
      dims_mm: { width: 50.8, depth: 50.8, wall: 6.35 },
      materialCategories: ['steel'],
    },
  ],
  jointTypes: [
    {
      id: 'nailed-16d',
      name: '16d nails',
      category: 'nailed',
      behaviour: 'pinned',
      capacity: { shear_N: 600, withdrawal_N: 200, basis: 'per-fastener' },
      defaultFastenerCount: 2,
      fastener: '16d common nail',
    },
    {
      id: 'nailed-8d',
      name: '8d nails',
      category: 'nailed',
      behaviour: 'pinned',
      capacity: { shear_N: 400, withdrawal_N: 150, basis: 'per-fastener' },
      defaultFastenerCount: 4,
      fastener: '8d common nail',
    },
    {
      id: 'joist-hanger',
      name: 'Joist hanger',
      category: 'hanger',
      behaviour: 'pinned',
      capacity: { shear_N: 5000, uplift_N: 1000, basis: 'per-joint' },
      defaultFastenerCount: 1,
    },
    {
      id: 'post-base',
      name: 'Post base',
      category: 'post-base',
      behaviour: 'pinned',
      capacity: { shear_N: 4000, uplift_N: 2500, basis: 'per-joint' },
      defaultFastenerCount: 1,
    },
    {
      id: 'post-embedded',
      name: 'Post embedded in concrete',
      category: 'embedded',
      behaviour: 'fixed',
      capacity: { shear_N: 8000, withdrawal_N: 6000, basis: 'per-joint' },
      defaultFastenerCount: 1,
    },
    {
      id: 'welded-fillet',
      name: 'Fillet weld',
      category: 'welded',
      behaviour: 'fixed',
      capacity: { shear_N: 20000, basis: 'per-joint' },
      defaultFastenerCount: 1,
    },
  ],
};
