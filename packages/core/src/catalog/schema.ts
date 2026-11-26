/**
 * Catalog schema (ADR-0001 §4). The catalog is data: materials, sections and joint
 * types. It is versioned from the start so files written today can be migrated.
 * Real data lives in `packages/catalog`; this file only defines its shape.
 *
 * Units:
 * - stresses and moduli in MPa (psi × 0.00689476);
 * - density in kg/m³, areal mass in kg/m² (psf × 4.88243);
 * - thermal resistance as RSI per mm (m²·K/W per mm; US R per inch × 0.0069335);
 * - joint capacities in N (lbf × 4.448222), ASD allowable values at normal load
 *   duration unless the joint type's `source` says otherwise;
 * - section dimensions in mm (actual, not nominal).
 */
import { z } from 'zod';

export const CATALOG_SCHEMA_VERSION = 1;

/** Catalog ids and price keys: lower-case words joined by `-`, `.` or `/`. */
export const kebabId = z
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
  /** Compression perpendicular to grain (bearing on plates and supports). */
  Fc_perp_MPa: z.number().positive().optional(),
});
export type StructuralProperties = z.infer<typeof zStructuralProperties>;

/** Render colour for swatches and untextured rendering; it also tints the texture. */
export const zSwatch = z.strictObject({
  color: z.string().regex(/^#[0-9a-f]{6}$/, 'should be a lower-case hex colour like "#c8a46e"'),
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  opacity: z.number().min(0).max(1).optional(),
});
export type Swatch = z.infer<typeof zSwatch>;

/**
 * Strength of materials that aren't beams in the wood sense: concrete (f'c), masonry
 * (f'm), reinforcing steel (fy).
 */
export const zStrength = z
  .strictObject({
    /** Modulus of elasticity. */
    E_MPa: z.number().positive().optional(),
    /** Compressive strength (concrete f'c, masonry f'm). */
    compressive_MPa: z.number().positive().optional(),
    tensile_MPa: z.number().positive().optional(),
    /** Yield strength (steel fy). */
    yield_MPa: z.number().positive().optional(),
  })
  .refine((s) => Object.values(s).some((v) => v !== undefined), 'should give at least one value');
export type Strength = z.infer<typeof zStrength>;

export const zMaterial = z.strictObject({
  id: kebabId,
  name: z.string().min(1),
  category: zMaterialCategory,
  species: z.string().optional(),
  grade: z.string().optional(),
  /** Plain-language description; Claude can quote it. */
  description: z.string().optional(),
  /** Beam properties: lumber, engineered wood, steel members. */
  structural: zStructuralProperties.optional(),
  /** Non-beam strength: concrete, masonry, rebar. */
  strength: zStrength.optional(),
  density_kg_m3: z.number().positive().optional(),
  /** Dead load of sheet products whose thickness isn't modelled (shingles, membranes, siding). */
  arealMass_kg_m2: z.number().positive().optional(),
  /** Thermal resistance per millimetre of thickness (m²·K/W per mm). */
  rValuePerMm: z.number().nonnegative().optional(),
  textureSet: z.string().optional(),
  swatch: zSwatch.optional(),
  /** Joint type ids this material can take. */
  acceptsJoints: z.array(kebabId),
  /** Code-awareness keys (ADR-0001 §12), e.g. "ground-contact". */
  flags: z.array(z.string()).optional(),
  /**
   * Key into the dated price table (`zPriceTable`). Prices live there, not here, so the
   * table can carry one date.
   */
  priceKey: z.string().optional(),
  /** Citation for the property numbers, e.g. "NDS 2018 Supplement Table 4A, No.2". */
  source: z.string().min(1).optional(),
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
  'mortared',
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
  /**
   * The fastener or connector material (category `fastener`) the joint consumes: one per
   * fastener when `capacity.basis` is `per-fastener`, one per joint otherwise. The
   * materials list counts and prices hardware through this.
   */
  hardwareId: kebabId.optional(),
  /** Citation for the capacity numbers, or "Estimate: …" with the reasoning. */
  source: z.string().min(1).optional(),
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
