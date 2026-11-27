/**
 * Defensive readers for the builder recipes stored on assemblies (`assembly.builder`), in
 * mm. A project file can be old or hand-edited, so every reader checks the shape and
 * returns `null` rather than throwing. Shared by the renderer's dimensions and the 2D
 * drawing sheet.
 */
import type { Assembly } from '@slapdash/core';

export interface PlanPoint {
  x: number;
  z: number;
}

export interface WallRecipe {
  name: string | null;
  /** The outside face of the framing, start and end, in plan. */
  start: PlanPoint;
  end: PlanPoint;
  exterior: 'left' | 'right';
  length: number;
  height: number;
  baseElevation: number;
  /** Framing depth, inward from the start→end line. */
  depth: number;
  /** Sheathing thickness, outward from the start→end line (0 when there is none). */
  sheathingThickness: number;
  /** Where the framing and the sheathing run along the wall (they differ at butted corners). */
  frameU0: number;
  frameU1: number;
  sheathU0: number;
  sheathU1: number;
}

export type OpeningKind = 'door' | 'sliding-door' | 'window';

export interface OpeningRecipe {
  wallId: string;
  kind: OpeningKind;
  /** Rough-opening start along the wall from its start, and its width. */
  at: number;
  width: number;
  height: number;
  /** Rough-opening bottom and top, above the wall's base. */
  roBottom: number;
  roTop: number;
  /** The window or door unit's style (casement, entry, sliding, …) when it has one. */
  style?: string;
}

export interface RoofRecipe {
  type: 'gable' | 'shed';
  from: PlanPoint;
  to: PlanPoint;
  /** Rise in inches per 12 of run. */
  pitchRise: number;
  ridgeAxis: 'x' | 'z';
  lowSide: 'north' | 'south' | 'east' | 'west' | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown, fallback: number): number => (isNum(v) ? v : fallback);

function point(v: unknown): PlanPoint | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  return isNum(p.x) && isNum(p.z) ? { x: p.x, z: p.z } : null;
}

function paramsOf(assembly: Assembly | undefined, builder: string): Record<string, unknown> | null {
  const b = assembly?.builder;
  if (!b || b.name !== builder || !b.params || typeof b.params !== 'object') return null;
  return b.params as Record<string, unknown>;
}

export function readWall(assembly: Assembly | undefined): WallRecipe | null {
  const p = paramsOf(assembly, 'build_wall');
  if (!p) return null;
  const start = point(p.start);
  const end = point(p.end);
  if (!start || !end) return null;
  const length = num(p.length, Math.hypot(end.x - start.x, end.z - start.z));
  return {
    name: typeof p.name === 'string' ? p.name : (assembly?.name ?? null),
    start,
    end,
    exterior: p.exterior === 'right' ? 'right' : 'left',
    length,
    height: num(p.height, 0),
    baseElevation: num(p.baseElevation, 0),
    depth: num(p.depth, 88.9),
    sheathingThickness: num(p.sheathingThickness, 0),
    frameU0: num(p.frameU0, 0),
    frameU1: num(p.frameU1, length),
    sheathU0: num(p.sheathU0, 0),
    sheathU1: num(p.sheathU1, length),
  };
}

const OPENING_KINDS: readonly OpeningKind[] = ['door', 'sliding-door', 'window'];

export function readOpening(assembly: Assembly | undefined): OpeningRecipe | null {
  const p = paramsOf(assembly, 'add_opening');
  if (!p || typeof p.wallId !== 'string' || !isNum(p.at) || !isNum(p.width)) return null;
  const kind = OPENING_KINDS.includes(p.kind as OpeningKind) ? (p.kind as OpeningKind) : 'door';
  const height = num(p.height, 0);
  const roBottom = num(p.roBottom, 0);
  return {
    wallId: p.wallId,
    kind,
    at: p.at,
    width: p.width,
    height,
    roBottom,
    roTop: num(p.roTop, roBottom + height),
    ...(typeof p.style === 'string' ? { style: p.style } : {}),
  };
}

export function readRoof(assembly: Assembly | undefined): RoofRecipe | null {
  const p = paramsOf(assembly, 'build_roof');
  if (!p || (p.type !== 'gable' && p.type !== 'shed')) return null;
  const from = point(p.from);
  const to = point(p.to);
  if (!from || !to || !isNum(p.pitchRise)) return null;
  const lowSide = p.lowSide === 'north' || p.lowSide === 'south' || p.lowSide === 'east' || p.lowSide === 'west' ? p.lowSide : null;
  return { type: p.type, from, to, pitchRise: p.pitchRise, ridgeAxis: p.ridgeAxis === 'z' ? 'z' : 'x', lowSide };
}

export interface WallFrame {
  /** Unit vector from start to end, in plan. */
  u: PlanPoint;
  /** Unit exterior normal, in plan. */
  n: PlanPoint;
  len: number;
}

/** The wall's direction and exterior normal, or null for a zero-length wall. */
export function wallFrame(wall: Pick<WallRecipe, 'start' | 'end' | 'exterior'>): WallFrame | null {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.z - wall.start.z;
  const len = Math.hypot(dx, dz);
  if (len === 0) return null;
  const ux = dx / len;
  const uz = dz / len;
  // Left of the wall direction, seen from above (y up), is (uz, -ux).
  const side = wall.exterior === 'right' ? -1 : 1;
  return { u: { x: ux, z: uz }, n: { x: uz * side, z: -ux * side }, len };
}
