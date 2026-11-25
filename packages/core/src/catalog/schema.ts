/**
 * Catalog schema (ADR-0001 §4). The catalog is data: materials, sections and joint
 * types. It is versioned from the start so files written today can be migrated.
 * Real data lives in `packages/catalog`; this file only defines its shape.
 */
import { z } from 'zod';

export const CATALOG_SCHEMA_VERSION = 1;

const kebabId = z
  .string()
  .regex(/^[a-z0-9]+(?:[-./][a-z0-9]+)*$/, 'should be lower-case words joined by hyphens, e.g. "spf-no2"');

export const MATERIAL_CATEGORIES = [
  'lumber',
  'engineered-wood',
  'sheet',
  'concrete',
  'masonry',
  'steel',
  'fastener',
  'roofing',
  'envelope',
  'insulation',
  'opening',
  'finish',
  'site',
  'other',
] as const;
export const zMaterialCategory = z.enum(MATERIAL_CATEGORIES);
export type MaterialCategory = z.infer<typeof zMaterialCategory>;

export const zStructuralProperties = z.strictObject({
  /** Modulus of elasticity. */
  E_MPa: z.number().positive(),
  /** Bending strength. */
  Fb_MPa: z.number().positive(),
  /** Shear strength. */
  Fv_MPa: z.number().positive(),
  /** Tension parallel to grain. */
  Ft_MPa: z.number().positive().optional(),
  /** Compression parallel to grain. */
  Fc_MPa: z.number().positive().optional(),
});
export type StructuralProperties = z.infer<typeof zStructuralProperties>;

export const zMaterial = z.strictObject({
  id: kebabId,
  name: z.string().min(1),
  category: zMaterialCategory,
  species: z.string().optional(),
  grade: z.string().optional(),
  structural: zStructuralProperties.optional(),
  density_kg_m3: z.number().positive().optional(),
  /** Thermal resistance per millimetre of thickness (m²·K/W per mm). */
  rValuePerMm: z.number().nonnegative().optional(),
  textureSet: z.string().optional(),
  /** Joint type ids this material can take. */
  acceptsJoints: z.array(kebabId),
  /** Code-awareness keys (ADR-0001 §12), e.g. "ground-contact". */
  flags: z.array(z.string()).optional(),
  /** Key into the price table (a later ticket). No prices live in the catalog. */
  priceKey: z.string().optional(),
});
export type Material = z.infer<typeof zMaterial>;

export const SECTION_SHAPES = ['rect', 'sheet', 'round', 'tube', 'i-beam', 'angle'] as const;
export const zSectionShape = z.enum(SECTION_SHAPES);
export type SectionShape = z.infer<typeof zSectionShape>;

export const zSection = z.strictObject({
  id: kebabId,
  name: z.string().min(1),
  /** Nominal size as sold, e.g. "2x4". */
  nominal: z.string().optional(),
  shape: zSectionShape,
  /** Actual dimensions in mm. A 2x4 is 38.1 wide × 88.9 deep. */
  dims_mm: z.strictObject({
    width: z.number().positive(),
    depth: z.number().positive(),
    thickness: z.number().positive().optional(),
    wall: z.number().positive().optional(),
  }),
  /** Material categories this section is made in. */
  materialCategories: z.array(zMaterialCategory).min(1),
});
export type Section = z.infer<typeof zSection>;

export const JOINT_CATEGORIES = [
  'nailed',
  'screwed',
  'bolted',
  'hanger',
  'tie',
  'post-base',
  'embedded',
  'notched',
  'mortise-tenon',
  'welded',
  'glued',
  'threaded',
  'crimped',
  'sweated',
] as const;
export const zJointCategory = z.enum(JOINT_CATEGORIES);
export type JointCategory = z.infer<typeof zJointCategory>;

/** How a joint behaves in the solver (ADR-0002 §E5). No semi-rigid joints. */
export const zJointBehaviour = z.enum(['pinned', 'fixed']);
export type JointBehaviour = z.infer<typeof zJointBehaviour>;

export const zJointCapacity = z.strictObject({
  shear_N: z.number().nonnegative(),
  withdrawal_N: z.number().nonnegative().optional(),
  uplift_N: z.number().nonnegative().optional(),
  /** Whether the numbers are per fastener (multiplied by the fastener count) or for the whole joint. */
  basis: z.enum(['per-fastener', 'per-joint']),
});
export type JointCapacity = z.infer<typeof zJointCapacity>;

export const zJointType = z.strictObject({
  id: kebabId,
  name: z.string().min(1),
  category: zJointCategory,
  behaviour: zJointBehaviour,
  capacity: zJointCapacity,
  defaultFastenerCount: z.number().int().min(1),
  /** The fastener used, e.g. "16d common nail". */
  fastener: z.string().optional(),
});
export type JointType = z.infer<typeof zJointType>;

export const zCatalog = z.strictObject({
  schemaVersion: z.literal(CATALOG_SCHEMA_VERSION),
  /** Data version, e.g. "2026-11-25". */
  catalogVersion: z.string().min(1),
  materials: z.array(zMaterial),
  sections: z.array(zSection),
  jointTypes: z.array(zJointType),
});
export type Catalog = z.infer<typeof zCatalog>;
