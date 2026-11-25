/**
 * Public types of the structural analysis. Forces in N, lengths in mm, stresses in MPa.
 * Results are keyed by the project's own part and joint IDs so the UI and Claude can
 * point at them.
 */
import type { SiteDefaults } from '@slapdash/core';

/** Basic load cases: dead, floor live, roof live, snow, and wind from four directions. */
export const BASIC_CASES = ['D', 'L', 'Lr', 'S', 'W+x', 'W-x', 'W+z', 'W-z'] as const;
export type BasicCase = (typeof BASIC_CASES)[number];
export const WIND_CASES = ['W+x', 'W-x', 'W+z', 'W-z'] as const satisfies readonly BasicCase[];

export interface LoadOverrides {
  /** Include the modelled parts' own weight in D. Default true. */
  selfWeight?: boolean;
  /** Extra dead load on roof and floor areas (finishes not modelled), kPa. Default 0. */
  superimposedDead_kPa?: number;
  /** Floor live load, kPa. Default 40 psf. */
  floorLive_kPa?: number;
  /** Roof live load, kPa. Default 20 psf. */
  roofLive_kPa?: number;
  /** Sloped-roof snow load ps on the horizontal projection, kPa; replaces the ASCE 7 calculation. */
  roofSnow_kPa?: number;
}

export interface AnalysisOptions {
  /** App defaults for location and design loads; project overrides win. */
  siteDefaults?: SiteDefaults;
  /** Which basic cases to run. Default all. Combinations that need a missing case are skipped. */
  cases?: readonly BasicCase[];
  /** Load overrides, mainly for tests and what-ifs. */
  loads?: LoadOverrides;
  /** Warn when the analysis takes longer than this, ms. Default 1000. */
  perfBudget?: number;
}

/** A number and where it came from, so it can be quoted. */
export interface SourcedValue {
  value: number;
  unit: string;
  source: string;
}

export interface AnalysisLoads {
  groundSnow: SourcedValue;
  /** Sloped roof snow ps = Cs · 0.7 · Ce · Ct · Is · pg. */
  roofSnow: SourcedValue;
  windSpeed: SourcedValue;
  /** Velocity pressure at mean roof height. */
  qh: SourcedValue;
  meanRoofHeight: SourcedValue;
  floorLive: SourcedValue;
  roofLive: SourcedValue;
  superimposedDead: SourcedValue;
  /** Wind pressure coefficients used (windward wall, leeward wall, roof suction). */
  windCoefficients: { windward: number; leeward: number; roof: number; source: string };
}

export const CHECKS = [
  'bending',
  'shear',
  'tension',
  'compression',
  'combined',
  'bearing',
  'deflection',
  'panel-shear',
  'joint-shear',
  'joint-withdrawal',
  'joint-uplift',
] as const;
export type Check = (typeof CHECKS)[number];

export interface Governing {
  check: Check;
  /** The load combination (or basic case, for deflection). */
  combo: string;
}

export type PartAnalysisRole = 'member' | 'truss' | 'panel' | 'mass-only' | 'ground' | 'not-connected';

export interface PartResult {
  id: string;
  role: PartAnalysisRole;
  /** Demand ÷ capacity of the governing check; > 1 fails. 0 for parts that aren't checked. */
  utilization: number;
  governing?: Governing;
  /** Every check that ran, with its worst combination. */
  checks: Partial<Record<Check, { utilization: number; combo: string }>>;
  /** Worst transverse deflection between supports under the deflection case, mm. */
  deflection_mm?: number;
  /** Set when the part moves so far that it's a mechanism (see `AnalysisResult.unstable`). */
  unstable?: boolean;
  note?: string;
}

export interface JointForces {
  shear: number;
  withdrawal: number;
  uplift: number;
}

export interface JointResult {
  id: string;
  utilization: number;
  governing?: Governing;
  /** Demand in the governing combination, N. */
  forces_N: JointForces;
  /** Capacity in the governing combination (after count and duration), N; absent = not checked. */
  capacity_N: Partial<JointForces>;
  notes: string[];
}

export interface Instability {
  assemblyId: string;
  partIds: string[];
  case: BasicCase;
  displacement_mm: number;
  message: string;
}

export interface AnalysisStats {
  nodes: number;
  dofs: number;
  elements: number;
  links: number;
  /** Stored entries of the skyline matrix. */
  profile: number;
  ms: number;
}

export interface AnalysisResult {
  /** `mechanism`: the model can't be solved because something isn't held at all. */
  status: 'ok' | 'mechanism';
  mechanism?: { partId: string | null; message: string };
  parts: Record<string, PartResult>;
  joints: Record<string, JointResult>;
  unstable: Instability[];
  warnings: string[];
  loads: AnalysisLoads;
  /** Names of the load combinations that ran. */
  combinations: string[];
  stats: AnalysisStats;
}
