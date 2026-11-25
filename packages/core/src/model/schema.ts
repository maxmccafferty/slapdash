/**
 * The project model (ADR-0001 §3): parts connected by joints, grouped into named
 * assemblies on levels. Undo, saves, materials lists and exploded views all come
 * from this one structure.
 *
 * Coordinates: y-up, millimetres, origin (0,0,0) at the project's fixed ground
 * corner — by convention the south-west corner, +x east, +z south, so a top view
 * reads like a plan. Positions are world-absolute, not relative to a level.
 *
 * Projects are immutable: every command returns a new object that shares unchanged
 * parts with the old one, so readers can compare by reference.
 */
import { z } from 'zod';
import { ASSEMBLY_KINDS, PART_ROLES } from './ids.ts';

export const PROJECT_SCHEMA_VERSION = 1;

export const zVec3 = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
export const zRotation = zVec3;

export const BUILD_PHASES = [
  'site',
  'foundation',
  'floor',
  'framing',
  'sheathing',
  'roofing',
  'envelope',
  'openings',
  'finish',
] as const;
export const zBuildPhase = z.enum(BUILD_PHASES);
export type BuildPhase = z.infer<typeof zBuildPhase>;

/** Build-step tag that feeds the assembly sequence (ADR-0001 §7). */
export const zBuildStep = z.strictObject({
  phase: zBuildPhase.describe('Construction phase this belongs to.'),
  seq: z.number().int().nonnegative().optional().describe('Order within the phase (0 first).'),
});
export type BuildStep = z.infer<typeof zBuildStep>;

export const zAssemblyKind = z.enum(ASSEMBLY_KINDS);
export const zPartRole = z.enum(PART_ROLES);

export const zLevel = z.strictObject({
  id: z.string(),
  name: z.string(),
  elevation_mm: z.number(),
});
export type Level = z.infer<typeof zLevel>;

export const zAssembly = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: zAssemblyKind,
  levelId: z.string(),
  buildStep: zBuildStep.optional(),
});
export type Assembly = z.infer<typeof zAssembly>;

export const zPartSize = z.strictObject({
  /** Along the part's local x axis. The free dimension of a sectioned member. */
  length: z.number(),
  /** Local y. For a sectioned member, the section width (a 2x4 is 38.1). */
  width: z.number(),
  /** Local z. For a sectioned member, the section depth (a 2x4 is 88.9). */
  height: z.number(),
});
export type PartSize = z.infer<typeof zPartSize>;

export const zPart = z.strictObject({
  id: z.string(),
  assemblyId: z.string(),
  levelId: z.string(),
  name: z.string().optional(),
  role: zPartRole,
  materialId: z.string(),
  sectionId: z.string().optional(),
  /** The part's local origin (its start / min corner), in mm. */
  position: zVec3,
  /** Degrees, intrinsic X then Y then Z. */
  rotation: zRotation,
  size: zPartSize,
  buildStep: zBuildStep,
  tags: z.array(z.string()),
});
export type Part = z.infer<typeof zPart>;

export const zCapacityOverride = z.strictObject({
  shear_N: z.number().nonnegative().optional(),
  withdrawal_N: z.number().nonnegative().optional(),
  uplift_N: z.number().nonnegative().optional(),
});
export type CapacityOverride = z.infer<typeof zCapacityOverride>;

export const zJoint = z.strictObject({
  id: z.string(),
  jointTypeId: z.string(),
  /** The two parts joined. The second may be "GROUND" for a support on the ground. */
  partIds: z.tuple([z.string(), z.string()]),
  /** Where the joint is, in mm. */
  at: zVec3,
  fastenerCount: z.number().int().min(1),
  capacityOverride: zCapacityOverride.optional(),
  note: z.string().optional(),
});
export type Joint = z.infer<typeof zJoint>;

export const DESIGN_LOAD_KEYS = ['groundSnow', 'windSpeed', 'frostDepth'] as const;
export const zDesignLoadKey = z.enum(DESIGN_LOAD_KEYS);
export type DesignLoadKey = z.infer<typeof zDesignLoadKey>;

/** SI unit each design load is stored in. */
export const DESIGN_LOAD_UNITS = { groundSnow: 'kPa', windSpeed: 'm/s', frostDepth: 'mm' } as const;
export type DesignLoadUnit = (typeof DESIGN_LOAD_UNITS)[DesignLoadKey];

export const zDesignLoadOverride = z.strictObject({
  value: z.number(),
  unit: z.enum(['kPa', 'm/s', 'mm']),
  /** Where the number came from, e.g. "user" or "county building dept". */
  source: z.string(),
  note: z.string().optional(),
});
export type DesignLoadOverride = z.infer<typeof zDesignLoadOverride>;

export const zSiteLocation = z.strictObject({
  label: z.string(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  source: z.literal('project'),
});
export type SiteLocation = z.infer<typeof zSiteLocation>;

/** Per-project site settings; each overrides the app's defaults (ADR-0002 §D3). */
export const zSiteSettings = z.strictObject({
  location: zSiteLocation.optional(),
  designLoads: z.strictObject({
    groundSnow: zDesignLoadOverride.optional(),
    windSpeed: zDesignLoadOverride.optional(),
    frostDepth: zDesignLoadOverride.optional(),
  }),
});
export type SiteSettings = z.infer<typeof zSiteSettings>;

export const zIdCounters = z.strictObject({
  assemblies: z.record(z.string(), z.number()),
  parts: z.record(z.string(), z.number()),
  joints: z.number(),
});

export const zProject = z.strictObject({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  name: z.string(),
  units: z.strictObject({ display: z.enum(['imperial', 'metric']) }),
  levels: z.array(zLevel).min(1),
  assemblies: z.record(z.string(), zAssembly),
  parts: z.record(z.string(), zPart),
  joints: z.record(z.string(), zJoint),
  site: zSiteSettings,
  counters: zIdCounters,
});
export type Project = z.infer<typeof zProject>;
