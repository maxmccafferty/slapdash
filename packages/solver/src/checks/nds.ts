/**
 * NDS 2018 (ASD) member checks. The catalog stores unadjusted reference values; the
 * adjustment factors live here:
 *
 * - CD, load duration: from the load combination.
 * - CF, size factor for visually graded dimension lumber (NDS Supplement Table 4A),
 *   by depth, on Fb, Ft and Fc. Lumber only, and not southern pine, whose tabulated
 *   values are already size-specific (Table 4B).
 * - Cfu, flat use: on Fb about the weak axis of dimension lumber.
 * - Cr = 1.15, repetitive member: on Fb for studs, joists and rafters when the builder
 *   spaced them at 24 in or less.
 * - CP, column stability (NDS 3.7.1). le is the longest stretch between the points
 *   where joints brace the member (an overhang past the last joint counts double, as a
 *   cantilever). About the weak axis it is 0 when the member is nailed to a bracing
 *   sheet, which holds it continuously.
 * - CL = 1: the compression edge is taken as braced by sheathing or decking.
 *
 * Wet service, temperature, incising and the like are 1.0.
 */
import type { Material } from '@slapdash/core';
import type { MemberSection } from '../model/section.ts';

const IN = 25.4;

/** NDS Supplement Table 4A size factors for 2"–4" thick lumber, by nominal width. */
export const SIZE_FACTOR_TABLE = [
  { maxDepthIn: 3.5, Fb: 1.5, Ft: 1.5, Fc: 1.15 }, // 2", 3", 4"
  { maxDepthIn: 4.5, Fb: 1.4, Ft: 1.4, Fc: 1.1 }, // 5"
  { maxDepthIn: 5.5, Fb: 1.3, Ft: 1.3, Fc: 1.1 }, // 6"
  { maxDepthIn: 7.25, Fb: 1.2, Ft: 1.2, Fc: 1.05 }, // 8"
  { maxDepthIn: 9.25, Fb: 1.1, Ft: 1.1, Fc: 1.0 }, // 10"
  { maxDepthIn: 11.25, Fb: 1.0, Ft: 1.0, Fc: 1.0 }, // 12"
  { maxDepthIn: Infinity, Fb: 0.9, Ft: 0.9, Fc: 0.9 }, // 14" and wider
] as const;

/** NDS Supplement Table 4A flat-use factors for 2"–3" thick lumber, by nominal width. */
export const FLAT_USE_TABLE = [
  { maxDepthIn: 3.5, Cfu: 1.1 }, // 4" (2" and 3" wide are 1.0, handled below)
  { maxDepthIn: 4.5, Cfu: 1.1 },
  { maxDepthIn: 7.25, Cfu: 1.15 },
  { maxDepthIn: Infinity, Cfu: 1.2 },
] as const;

export const REPETITIVE_ROLES = new Set(['stud', 'joist', 'rafter']);
export const REPETITIVE_MAX_SPACING_MM = 24 * IN;

export function sizeFactors(material: Material, depthMm: number): { Fb: number; Ft: number; Fc: number } {
  if (material.category !== 'lumber' || material.species === 'southern-pine') return { Fb: 1, Ft: 1, Fc: 1 };
  const d = depthMm / IN + 1e-6;
  const row = SIZE_FACTOR_TABLE.find((r) => d <= r.maxDepthIn + 0.01)!;
  return { Fb: row.Fb, Ft: row.Ft, Fc: row.Fc };
}

export function flatUseFactor(material: Material, depthMm: number, thicknessMm: number): number {
  if (material.category !== 'lumber' || thicknessMm / IN > 3.6) return 1;
  const d = depthMm / IN;
  if (d < 3.4) return 1;
  return FLAT_USE_TABLE.find((r) => d <= r.maxDepthIn + 0.01)!.Cfu;
}

/** Emin from E (NDS Appendix D): E·(1 − 1.645·COV)·1.03 / 1.66; COV 0.25 for sawn lumber, 0.10 otherwise. */
export function eMin(material: Material): number {
  const E = material.structural!.E_MPa;
  const cov = material.category === 'lumber' ? 0.25 : 0.1;
  return (E * (1 - 1.645 * cov) * 1.03) / 1.66;
}

/** Column stability factor, NDS Eq. 3.7-1. */
export function columnStability(FcStar: number, FcE: number, c: number): number {
  if (!Number.isFinite(FcE)) return 1;
  const a = FcE / FcStar;
  const t = (1 + a) / (2 * c);
  return t - Math.sqrt(t * t - a / c);
}

export interface MemberCapacity {
  /** Fb' about the strong (deeper) axis and the weak axis. */
  Fb1: number;
  Fb2: number;
  Fv: number;
  Ft: number | undefined;
  /** Fc' including CP. */
  Fc: number | undefined;
  /** Euler buckling stresses about the two axes (Infinity when braced). */
  FcE1: number;
  FcE2: number;
  FcPerp: number | undefined;
}

export interface MemberFactors {
  material: Material;
  section: MemberSection;
  /** Effective column length about the deeper (1) and the shallower (2) axis, mm; 0 = braced. */
  le1: number;
  le2: number;
  repetitive: boolean;
}

/**
 * Unbraced length from the positions of the joints along a member (mm from its start):
 * the longest gap between joints, or twice an overhang past the end joints.
 */
export function unbracedLength(length: number, bracePoints: readonly number[]): number {
  const ts = [...bracePoints].sort((a, b) => a - b);
  if (ts.length === 0) return length;
  let le = Math.max(2 * ts[0]!, 2 * (length - ts[ts.length - 1]!));
  for (let i = 1; i < ts.length; i++) le = Math.max(le, ts[i]! - ts[i - 1]!);
  return Math.min(le, 2 * length);
}

/** Adjusted design values for a member under a given CD. Axis 1 is the deeper one. */
export function memberCapacity(f: MemberFactors, CD: number): MemberCapacity {
  const s = f.material.structural!;
  const depth = Math.max(f.section.b, f.section.h);
  const thick = Math.min(f.section.b, f.section.h);
  const CF = sizeFactors(f.material, depth);
  const Cfu = flatUseFactor(f.material, depth, thick);
  const Cr = f.repetitive ? 1.15 : 1;
  const Fb1 = s.Fb_MPa * CD * CF.Fb * Cr;
  const Fb2 = s.Fb_MPa * CD * CF.Fb * Cfu * Cr;
  const em = eMin(f.material);
  const { le1, le2 } = f;
  const FcE1 = le1 > 0 ? (0.822 * em) / (le1 / depth) ** 2 : Infinity;
  const FcE2 = le2 > 0 ? (0.822 * em) / (le2 / thick) ** 2 : Infinity;
  let Fc: number | undefined;
  if (s.Fc_MPa) {
    const FcStar = s.Fc_MPa * CD * CF.Fc;
    const c = f.material.category === 'lumber' ? 0.8 : 0.9;
    const CP = Math.min(columnStability(FcStar, FcE1, c), columnStability(FcStar, FcE2, c));
    Fc = FcStar * CP;
  }
  return {
    Fb1,
    Fb2,
    Fv: s.Fv_MPa * CD,
    Ft: s.Ft_MPa ? s.Ft_MPa * CD * CF.Ft : undefined,
    Fc,
    FcE1,
    FcE2,
    FcPerp: s.Fc_perp_MPa,
  };
}

export interface StationUtilization {
  bending: number;
  shear: number;
  tension: number;
  compression: number;
  combined: number;
}

/** Keep a ratio finite when an amplification denominator runs out. */
const amp = (x: number) => Math.max(1e-3, 1 - x);

/**
 * Utilizations at one station from N (tension +), Vy, Vz, My, Mz. Axis 1 is the deeper
 * one: My (about local y) when h ≥ b, else Mz.
 */
export function stationUtilization(
  sec: MemberSection,
  cap: MemberCapacity,
  N: number,
  Vy: number,
  Vz: number,
  My: number,
  Mz: number,
  out: StationUtilization,
): StationUtilization {
  const strongIsY = sec.h >= sec.b;
  const fb1 = strongIsY ? Math.abs(My) / sec.Sy : Math.abs(Mz) / sec.Sz;
  const fb2 = strongIsY ? Math.abs(Mz) / sec.Sz : Math.abs(My) / sec.Sy;
  const r1 = fb1 / cap.Fb1;
  const r2 = fb2 / cap.Fb2;
  out.bending = r1 + r2;
  // Shear: 1.5·V/A for a rectangle; for an I section the web carries it.
  const V = Math.hypot(Vy, Vz);
  const fv = sec.shape === 'rect' ? (1.5 * V) / sec.A : V / (sec.h * Math.min(sec.b, sec.A / sec.h));
  out.shear = fv / cap.Fv;
  out.tension = 0;
  out.compression = 0;
  if (N > 0) {
    const ft = N / sec.A;
    out.tension = cap.Ft ? ft / cap.Ft : 0;
    out.combined = out.tension + r1 + r2; // NDS Eq. 3.9-1
  } else {
    const fc = -N / sec.A;
    out.compression = cap.Fc ? fc / cap.Fc : 0;
    // NDS Eq. 3.9-3 with CL = 1 (FbE → ∞).
    out.combined = out.compression ** 2 + r1 / amp(fc / cap.FcE1) + r2 / amp(fc / cap.FcE2);
  }
  return out;
}

/** IRC R301.7 deflection limits by role (span ÷ ratio), and the basic cases they use. */
export interface DeflectionRule {
  ratio: number;
  cases: readonly string[];
}

export function deflectionRule(role: string, assemblyKind: string | undefined, hasCeiling: boolean): DeflectionRule | null {
  if (role === 'joist' && assemblyKind === 'floor') return { ratio: 360, cases: ['L'] };
  if (role === 'rafter') return { ratio: hasCeiling ? 240 : 180, cases: ['Lr', 'S'] };
  if (role === 'header' || role === 'beam' || role === 'ridge') return { ratio: 240, cases: ['L', 'Lr', 'S'] };
  if (role === 'stud') return { ratio: 180, cases: ['W+x', 'W-x', 'W+z', 'W-z'] };
  return null;
}
