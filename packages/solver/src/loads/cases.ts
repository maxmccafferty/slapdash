/**
 * Basic load cases (D, L, Lr, S and wind from four directions) as uniform line loads on
 * members.
 *
 * - D: member self-weight (density × A) and the weight of sheets and mass-only parts.
 * - Area loads (L, Lr, S, superimposed dead, wind) act on the sheathing of floor, roof
 *   and wall assemblies.
 * - A sheet or mass-only part passes its load to the members it is nailed to as a
 *   uniform line load over the stretch of each member it covers, shared by covered
 *   length. Never as point loads, which would double the moment.
 * - An assembly with no sheathing gets its area loads straight on its rafters, joists
 *   or studs over a tributary width: the builder's spacing, or 16 in.
 */
import { KPA_PER_PSF, MM_PER_INCH, isUnitPart, type CatalogIndex, type Part, type Project, type Section } from '@slapdash/core';
import type { V3 } from '../fem/element.ts';
import type { FemLoadCase } from '../fem/solve.ts';
import type { AnalyticalModel } from '../model/build.ts';
import { centre, dot, length, overlapInterval, partAxes, project as projectOnto, scale, sheetNormal, sub, fromVec } from '../model/geometry.ts';
import { BASIC_CASES, type AnalysisLoads, type AnalysisOptions, type BasicCase } from '../types.ts';
import { exposureCKz, flatRoofSnow, siteLoads, slopeFactor, velocityPressure } from './site.ts';

export const GRAVITY = 9.80665;
/** N/mm³ per kg/m³. */
const WEIGHT_DENSITY = GRAVITY * 1e-9;
/** N/mm² per kg/m². */
const WEIGHT_AREAL = GRAVITY * 1e-6;
/** kPa → N/mm². */
const KPA = 1e-3;

export const FLOOR_LIVE_KPA = 40 * KPA_PER_PSF;
export const ROOF_LIVE_KPA = 20 * KPA_PER_PSF;
export const DEFAULT_TRIBUTARY_MM = 16 * MM_PER_INCH;
/** Simplified envelope coefficients (GCp-like) for walls and roof. */
export const WIND_COEFFICIENTS = { windward: 0.8, leeward: 0.5, roof: 0.9 } as const;

const WIND_DIRS: Record<string, V3> = { 'W+x': [1, 0, 0], 'W-x': [-1, 0, 0], 'W+z': [0, 0, 1], 'W-z': [0, 0, -1] };

/** A uniform load on a member between t0 and t1 (mm along it), world axes, N/mm. */
export interface MemberLoad {
  partId: string;
  t0: number;
  t1: number;
  q: V3;
}

export interface CaseLoads {
  cases: Record<BasicCase, MemberLoad[]>;
  loads: AnalysisLoads;
  /** Weight of each mass-only part or sheet (N), for the joint checks. */
  weights: Map<string, number>;
  warnings: string[];
}

export function spacingOf(params: Record<string, unknown> | undefined): number | undefined {
  const s = params?.spacing;
  if (typeof s === 'number' && s > 0) return s;
  if (typeof s === 'string') {
    const m = /^(\d+(?:\.\d+)?)in$/.exec(s);
    if (m) return Number(m[1]) * MM_PER_INCH;
  }
  return undefined;
}

/**
 * Cross-section area of a hollow or shaped section (pipe, tube, steel shapes), mm², or
 * undefined for solid rectangles and sheets, which fill their box.
 */
export function shapedSectionArea(section: Section | undefined): number | undefined {
  if (!section) return undefined;
  const { width: b, depth: d, thickness: tf, wall: t } = section.dims_mm;
  switch (section.shape) {
    case 'round': {
      const r = Math.max(b, d) / 2;
      return t !== undefined && t < r ? Math.PI * (r * r - (r - t) ** 2) : Math.PI * r * r;
    }
    case 'tube':
      return t !== undefined && 2 * t < Math.min(b, d) ? b * d - (b - 2 * t) * (d - 2 * t) : undefined;
    case 'i-beam':
      return tf !== undefined && t !== undefined ? 2 * b * tf + (d - 2 * tf) * t : undefined;
    case 'angle': {
      const leg = tf ?? t;
      return leg !== undefined ? leg * (b + d - leg) : undefined;
    }
    case 'channel':
      return t !== undefined ? t * (d + 2 * b - 2 * t) : undefined;
    default:
      return undefined;
  }
}

/** Material volume of a part: its box, or its section area × length for pipe, tube and steel shapes. */
function partVolume(p: Part, catalog: CatalogIndex): number {
  const A = shapedSectionArea(p.sectionId ? catalog.sections.get(p.sectionId) : undefined);
  return A !== undefined ? A * p.size.length : p.size.length * p.size.width * p.size.height;
}

/** The largest face, mm²: what an areal mass applies to. */
function partFaceArea(p: Part): number {
  const [a, b] = [p.size.length, p.size.width, p.size.height].sort((x, y) => y - x);
  return a! * b!;
}

/**
 * Weight factors for window and door unit parts. A unit is drawn as many pieces (frame,
 * sashes, glass) but its catalog density is for the whole unit as a box filling the rough
 * opening through the wall's stud depth, so each opening's pieces are scaled to weigh
 * that together. Parts without an add_opening recipe (and pre-unit panels) aren't scaled.
 */
export function unitWeightFactors(project: Project, catalog: CatalogIndex): Map<string, number> {
  const byOpening = new Map<string, Part[]>();
  for (const p of Object.values(project.parts)) {
    if (!isUnitPart(p)) continue;
    const list = byOpening.get(p.assemblyId) ?? [];
    list.push(p);
    byOpening.set(p.assemblyId, list);
  }
  const out = new Map<string, number>();
  for (const [openingId, units] of byOpening) {
    const asm = project.assemblies[openingId];
    const op = asm?.builder?.name === 'add_opening' ? (asm.builder.params as Record<string, unknown>) : null;
    const wallAsm = typeof op?.wallId === 'string' ? project.assemblies[op.wallId] : undefined;
    const wall = wallAsm?.builder?.name === 'build_wall' ? (wallAsm.builder.params as Record<string, unknown>) : null;
    if (!op || !wall || typeof op.width !== 'number' || typeof op.height !== 'number' || typeof wall.depth !== 'number') continue;
    const volume = units.reduce((sum, p) => sum + partVolume(p, catalog), 0);
    if (volume <= 0) continue;
    const factor = (op.width * op.height * wall.depth) / volume;
    for (const p of units) out.set(p.id, factor);
  }
  return out;
}

export function buildLoadCases(model: AnalyticalModel, options: AnalysisOptions = {}): CaseLoads {
  const { project, catalog, members } = model;
  const warnings: string[] = [];
  const o = options.loads ?? {};
  const cases = Object.fromEntries(BASIC_CASES.map((c) => [c, [] as MemberLoad[]])) as Record<BasicCase, MemberLoad[]>;
  const weights = new Map<string, number>();
  const parts = Object.values(project.parts);
  const kindOf = (p: Part) => project.assemblies[p.assemblyId]?.kind;

  // --- Site values -------------------------------------------------------------------
  const site = siteLoads(project, options.siteDefaults);
  const pg = site.groundSnow.value;
  const pf = flatRoofSnow(pg);
  const roofParts = parts.filter((p) => kindOf(p) === 'roof');
  let roofLo = Infinity;
  let roofHi = -Infinity;
  for (const p of roofParts) {
    const c = centre(p);
    roofLo = Math.min(roofLo, c[1]);
    roofHi = Math.max(roofHi, c[1]);
  }
  if (!Number.isFinite(roofLo)) {
    for (const n of model.fem.nodes) roofHi = Math.max(roofHi, n[1]);
    roofLo = roofHi;
  }
  const meanRoofHeight = Number.isFinite(roofHi) ? Math.max(0, (roofLo + roofHi) / 2) : 0;
  const Kz = exposureCKz(meanRoofHeight);
  const qh = velocityPressure(site.windSpeed.value, Kz);
  const roofSlopes = roofParts.filter((p) => p.role === 'sheathing' || p.role === 'rafter').map((p) => slopeOf(p));
  const steepest = roofSlopes.length ? Math.max(...roofSlopes) : 0;
  const psOverride = o.roofSnow_kPa;
  const psFor = (slopeDeg: number) => psOverride ?? slopeFactor(slopeDeg) * pf;

  const floorLive = o.floorLive_kPa ?? FLOOR_LIVE_KPA;
  const roofLive = o.roofLive_kPa ?? ROOF_LIVE_KPA;
  const superDead = o.superimposedDead_kPa ?? 0;

  const loads: AnalysisLoads = {
    groundSnow: { ...site.groundSnow },
    roofSnow:
      psOverride !== undefined
        ? { value: psOverride, unit: 'kPa', source: 'given' }
        : {
            value: psFor(steepest),
            unit: 'kPa',
            source: `ASCE 7-22 §7.3–7.4: ps = Cs·0.7·Ce·Ct·Is·pg with Ce = Ct = Is = 1.0, Cs = ${slopeFactor(steepest).toFixed(2)} (warm roof, ${steepest.toFixed(1)}°, Fig. 7.4-1), on the horizontal projection`,
          },
    windSpeed: { ...site.windSpeed },
    qh: {
      value: qh,
      unit: 'kPa',
      source: `ASCE 7-22 Eq. 26.10-1: qh = 0.613·Kz·Kzt·Kd·Ke·V² with exposure C Kz = ${Kz.toFixed(3)}, Kzt = Ke = 1.0, Kd = 0.85`,
    },
    meanRoofHeight: { value: meanRoofHeight, unit: 'mm', source: 'mean height of the roof parts above y = 0' },
    floorLive: { value: floorLive, unit: 'kPa', source: o.floorLive_kPa !== undefined ? 'given' : 'ASCE 7-22 Table 4.3-1, residential 40 psf' },
    roofLive: { value: roofLive, unit: 'kPa', source: o.roofLive_kPa !== undefined ? 'given' : 'ASCE 7-22 §4.8, ordinary roof 20 psf' },
    superimposedDead: { value: superDead, unit: 'kPa', source: o.superimposedDead_kPa !== undefined ? 'given' : 'none: only modelled parts weigh anything' },
    windCoefficients: {
      ...WIND_COEFFICIENTS,
      source: 'simplified envelope: windward wall +0.8, leeward wall −0.5, roof −0.9 normal to the surface (side walls not loaded)',
    },
  };

  // --- Building centroid, for windward/leeward ---------------------------------------
  const nodes = model.fem.nodes;
  const centroid: V3 = nodes.length
    ? (scale(
        nodes.reduce((s, n) => [s[0] + n[0], s[1] + n[1], s[2] + n[2]] as V3, [0, 0, 0] as V3),
        1 / nodes.length,
      ) as V3)
    : [0, 0, 0];

  // --- Distribution through joints ---------------------------------------------------
  const lost: string[] = [];
  const distribute = (from: Part, F: V3, kase: BasicCase, visited = new Set<string>()) => {
    if (length(F) === 0) return;
    visited.add(from.id);
    const neigh = [...new Set(model.neighbours.get(from.id) ?? [])];
    const frames = neigh.filter((n) => members.has(n));
    if (frames.length) {
      const spans = frames.map((id) => {
        const info = members.get(id)!;
        let [a, b] = overlapInterval(info.line, from);
        if (!(b - a > 1)) {
          const tj = projectOnto(info.line, centre(from)).t;
          a = Math.max(0, tj - 25);
          b = Math.min(info.line.length, tj + 25);
        }
        return { id, a, b };
      });
      const total = spans.reduce((s, x) => s + (x.b - x.a), 0);
      for (const s of spans) {
        const share = (s.b - s.a) / total;
        cases[kase].push({ partId: s.id, t0: s.a, t1: s.b, q: scale(F, share / (s.b - s.a)) });
      }
      return;
    }
    const onward = neigh.filter((n) => !visited.has(n) && model.roles.get(n) !== 'ground' && model.roles.get(n) !== 'not-connected');
    if (onward.length) {
      for (const n of onward) distribute(project.parts[n]!, scale(F, 1 / onward.length), kase, visited);
      return;
    }
    if (!neigh.some((n) => model.roles.get(n) === 'ground') && !hasGroundJoint(from.id)) lost.push(from.id);
  };
  const groundJointed = new Set<string>();
  for (const j of Object.values(project.joints)) {
    if (j.partIds[1] === 'GROUND') groundJointed.add(j.partIds[0]);
    if (j.partIds[0] === 'GROUND') groundJointed.add(j.partIds[1]);
  }
  const hasGroundJoint = (id: string) => groundJointed.has(id);

  // --- D: self-weight -----------------------------------------------------------------
  const selfWeight = o.selfWeight ?? true;
  const noDensity: string[] = [];
  if (selfWeight) {
    for (const [id, info] of members) {
      const rho = info.material.density_kg_m3;
      if (!rho) {
        noDensity.push(id);
        continue;
      }
      cases.D.push({ partId: id, t0: 0, t1: info.line.length, q: [0, -rho * WEIGHT_DENSITY * info.section.A, 0] });
    }
    const unitFactor = unitWeightFactors(project, catalog);
    for (const p of parts) {
      const role = model.roles.get(p.id);
      if (role !== 'panel' && role !== 'mass-only') continue;
      const m = catalog.materials.get(p.materialId);
      const W = m?.density_kg_m3
        ? m.density_kg_m3 * WEIGHT_DENSITY * partVolume(p, catalog) * (unitFactor.get(p.id) ?? 1)
        : m?.arealMass_kg_m2
          ? m.arealMass_kg_m2 * WEIGHT_AREAL * partFaceArea(p)
          : 0;
      if (W === 0) {
        noDensity.push(p.id);
        continue;
      }
      weights.set(p.id, W);
      distribute(p, [0, -W, 0], 'D');
    }
  }
  if (noDensity.length) {
    warnings.push(`No density or areal mass in the catalog for ${noDensity.length === 1 ? 'the material of' : 'the materials of'} ${list(noDensity)}; their weight is left out.`);
  }

  // --- Area loads on sheathing, or on framing at a tributary width -------------------
  const area = (p: Part) => p.size.length * p.size.width;
  const sheets = parts.filter((p) => model.roles.get(p.id) === 'panel');
  const assembliesWithSheets = new Set(sheets.map((p) => p.assemblyId));

  const windOnWall = (pos: V3, normal: V3, kase: BasicCase): { coeff: number; dir: V3 } | null => {
    const d = WIND_DIRS[kase]!;
    if (Math.abs(dot(normal, d)) < 0.5) return null;
    const s = dot(sub(pos, centroid), d);
    return { coeff: s > 10 ? WIND_COEFFICIENTS.leeward : WIND_COEFFICIENTS.windward, dir: d };
  };

  for (const p of sheets) {
    const kind = kindOf(p);
    const A = area(p);
    const n = sheetNormal(p);
    const plan = A * Math.abs(n[1]);
    if (kind === 'roof') {
      const slope = slopeOf(p);
      distribute(p, [0, -psFor(slope) * KPA * plan, 0], 'S');
      distribute(p, [0, -roofLive * KPA * plan, 0], 'Lr');
      if (superDead) distribute(p, [0, -superDead * KPA * plan, 0], 'D');
      for (const w of Object.keys(WIND_DIRS) as BasicCase[]) distribute(p, scale(n, WIND_COEFFICIENTS.roof * qh * KPA * A), w);
    } else if (kind === 'floor') {
      distribute(p, [0, -floorLive * KPA * plan, 0], 'L');
      if (superDead) distribute(p, [0, -superDead * KPA * plan, 0], 'D');
    } else if (kind === 'wall') {
      for (const w of Object.keys(WIND_DIRS) as BasicCase[]) {
        const hit = windOnWall(centre(p), n, w);
        if (hit) distribute(p, scale(hit.dir, hit.coeff * qh * KPA * A), w);
      }
    }
  }

  // Tributary fallback for assemblies with no sheathing.
  for (const asm of Object.values(project.assemblies)) {
    if (assembliesWithSheets.has(asm.id)) continue;
    const primary = asm.kind === 'roof' ? 'rafter' : asm.kind === 'floor' ? 'joist' : asm.kind === 'wall' ? 'stud' : null;
    if (!primary) continue;
    const spacing = spacingOf(asm.builder?.params) ?? DEFAULT_TRIBUTARY_MM;
    for (const [id, info] of members) {
      const p = info.part;
      if (p.assemblyId !== asm.id || p.role !== primary) continue;
      const L = info.line.length;
      const ex = info.line.axes[0];
      const horizontal = Math.hypot(ex[0], ex[2]);
      const gravity = (kpa: number, kase: BasicCase) => {
        if (kpa) cases[kase].push({ partId: id, t0: 0, t1: L, q: [0, -kpa * KPA * spacing * horizontal, 0] });
      };
      if (asm.kind === 'roof') {
        gravity(psFor(slopeOf(p)), 'S');
        gravity(roofLive, 'Lr');
        gravity(superDead, 'D');
        const up = upwardSide(info.line.axes);
        for (const w of Object.keys(WIND_DIRS) as BasicCase[]) {
          cases[w].push({ partId: id, t0: 0, t1: L, q: scale(up, WIND_COEFFICIENTS.roof * qh * KPA * spacing) });
        }
      } else if (asm.kind === 'floor') {
        gravity(floorLive, 'L');
        gravity(superDead, 'D');
      } else {
        const normal = info.line.axes[2];
        for (const w of Object.keys(WIND_DIRS) as BasicCase[]) {
          const hit = windOnWall(fromVec(p.position), normal, w);
          if (hit) cases[w].push({ partId: id, t0: 0, t1: L, q: scale(hit.dir, hit.coeff * qh * KPA * spacing) });
        }
      }
    }
  }

  if (lost.length) warnings.push(`${list(lost)}: not fastened to any framing, so ${lost.length === 1 ? 'its' : 'their'} load goes nowhere.`);
  return { cases, loads, weights, warnings };
}

function list(ids: string[], max = 6): string {
  return ids.length <= max ? ids.join(', ') : `${ids.slice(0, max).join(', ')} and ${ids.length - max} more`;
}

/** Slope of a part in degrees: of its surface for a sheet, of its length for a member. */
function slopeOf(p: Part): number {
  if (p.role === 'sheathing') {
    const n = sheetNormal(p);
    return (Math.acos(Math.min(1, Math.abs(n[1]))) * 180) / Math.PI;
  }
  const ex = partAxes(p)[0];
  return (Math.asin(Math.min(1, Math.abs(ex[1]))) * 180) / Math.PI;
}

/** The member's cross axis (local y or z) closest to vertical, pointing up. */
function upwardSide(axes: readonly [V3, V3, V3]): V3 {
  const pick = Math.abs(axes[1][1]) > Math.abs(axes[2][1]) ? axes[1] : axes[2];
  return pick[1] >= 0 ? pick : scale(pick, -1);
}

/** Split member loads over each member's elements into FEM element loads. */
export function toFemCases(model: AnalyticalModel, cases: Record<BasicCase, MemberLoad[]>, which: readonly BasicCase[]): FemLoadCase[] {
  return which.map((name) => {
    const elementLoads: FemLoadCase['elementLoads'] = [];
    for (const l of cases[name]) {
      const info = model.members.get(l.partId);
      if (!info) continue;
      for (const e of info.elements) {
        const L = model.fem.elements[e.index]!.L;
        const a = Math.max(l.t0, e.t0);
        const b = Math.min(l.t1, e.t0 + L);
        if (b - a > 1e-9) elementLoads.push({ element: e.index, a: a - e.t0, b: b - e.t0, q: l.q });
      }
    }
    return { name, elementLoads, nodalLoads: [] };
  });
}
