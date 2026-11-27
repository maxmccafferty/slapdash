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
import { zPriceUnit } from '../catalog/prices.ts';

/** v2 added optional part `cuts`; v1 files migrate by changing only the version. */
export const PROJECT_SCHEMA_VERSION = 2;

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

/**
 * How a builder tool made an assembly: the builder's name and its fully resolved
 * input (lengths in mm). Builders that edit an assembly later (e.g. add_opening on a
 * wall) read their layout rules from here.
 */
export const zBuilderRecipe = z.strictObject({
  name: z.string(),
  params: z.record(z.string(), z.unknown()),
});
export type BuilderRecipe = z.infer<typeof zBuilderRecipe>;

export const zAssembly = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: zAssemblyKind,
  levelId: z.string(),
  buildStep: zBuildStep.optional(),
  /** Set by builder tools; absent on hand-made assemblies. Optional, so v1 files without it still load. */
  builder: zBuilderRecipe.optional(),
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

/**
 * A planar cut across one end (or edge) of a part. Angles are degrees from square,
 * strictly between −80 and 80.
 *
 * The long-point convention: the cut plane passes through the box's end face along the
 * long-point edge and leans inward, so `size` stays the part's bounding box and
 * `size.length` is the long-point length. For example `end.slope = −θ` keeps
 * x ≤ length − (height − z)·tan θ (long point on the top face).
 */
export const zEndCut = z.strictObject({
  /**
   * Tilt through the depth: rotation about local y (on a width edge, about local x).
   * > 0: the long point is on the bottom face (z = 0); < 0: on the top face (z = height).
   * A rafter's plumb cut at pitch θ is ±θ.
   */
  slope: z.number().gt(-80).lt(80).optional(),
  /**
   * Start/end only. Tilt through the width: rotation about local z, for plan miters.
   * > 0: the long point is on the y = 0 face; < 0: on the y = width face.
   */
  miter: z.number().gt(-80).lt(80).optional(),
  /** The cut-list wording. Derived from the angles if absent. */
  name: z.enum(['plumb', 'level', 'bevel', 'miter', 'trim']).optional(),
});
export type EndCut = z.infer<typeof zEndCut>;

/**
 * Material cut out of a part through its full width (local y): a convex polygon in
 * local x–z, in mm. It may reach outside the box (builders push it ~1 mm past the face
 * it exits, so no slivers are left); only the part inside the box is removed.
 * A birdsmouth's profile is ordered [heel exit, inner corner, seat exit].
 */
export const zNotch = z.strictObject({
  kind: z.enum(['birdsmouth', 'trim', 'notch']),
  profile: z.array(z.strictObject({ x: z.number(), z: z.number() })).min(3).max(8),
});
export type Notch = z.infer<typeof zNotch>;

/** Optional cuts on a part; the part's box stays its bound (see {@link zEndCut}). */
export const zPartCuts = z.strictObject({
  /** At local x = 0. */
  start: zEndCut.optional(),
  /** At local x = length. */
  end: zEndCut.optional(),
  /** At local y = 0 (sheet edges; only `slope` applies). */
  nearEdge: zEndCut.optional(),
  /** At local y = width (e.g. the ridge bevel on roof sheathing; only `slope` applies). */
  farEdge: zEndCut.optional(),
  notches: z.array(zNotch).max(4).optional(),
});
export type PartCuts = z.infer<typeof zPartCuts>;

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
  /** Angled end cuts and notches (schema v2). Absent on plain boxes. */
  cuts: zPartCuts.optional(),
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

/**
 * A price the person gave for this project (ADR-0001 §11: user prices override the table
 * per project). It replaces the table's low–high range with one number. Keyed in
 * `Project.prices` by `materialId`, or `materialId|variant` for one size.
 */
export const zUserPrice = z.strictObject({
  materialId: z.string(),
  /** A section id ("2x4") or sheet thickness ("23/32in"); absent means every size. */
  variant: z.string().optional(),
  usd: z.number().positive(),
  per: zPriceUnit,
  /** The board length a per-piece lumber price is for. */
  length_mm: z.number().positive().optional(),
  note: z.string().optional(),
  source: z.literal('user'),
});
export type UserPrice = z.infer<typeof zUserPrice>;

/** The `Project.prices` key for a material and optional size. */
export function userPriceKey(materialId: string, variant?: string): string {
  return variant === undefined ? materialId : `${materialId}|${variant}`;
}

export const zProject = z.strictObject({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  name: z.string(),
  units: z.strictObject({ display: z.enum(['imperial', 'metric']) }),
  levels: z.array(zLevel).min(1),
  assemblies: z.record(z.string(), zAssembly),
  parts: z.record(z.string(), zPart),
  joints: z.record(z.string(), zJoint),
  site: zSiteSettings,
  /** The person's own prices; optional, so v1 files without it still load. */
  prices: z.record(z.string(), zUserPrice).optional(),
  counters: zIdCounters,
});
export type Project = z.infer<typeof zProject>;
