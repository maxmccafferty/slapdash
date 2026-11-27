/**
 * Reusable checks for eval scenarios. Each returns a plain-language failure, or null when it
 * passes (some return a list). Lengths are millimetres inside, feet and inches in messages.
 * Tolerance is ±1in unless stated.
 */
import type { TurnResult } from '@slapdash/agent';
import { MUTATING_TOOLS } from '@slapdash/agent';
import {
  aabbOf,
  checkJoint,
  findAllClashes,
  formatFeetInches,
  MM_PER_FOOT,
  MM_PER_INCH,
  partBox,
  type Aabb,
  type Assembly,
  type CatalogIndex,
  type Part,
  type PartRole,
  type Project,
} from '@slapdash/core';
import type { EvalSession, TurnRecord } from './harness.ts';
import { undoSteps, type Baseline } from './scenario.ts';

export const IN = MM_PER_INCH;
export const FT = MM_PER_FOOT;
const TOL = IN;

export type Fail = string | null;
type TurnLike = TurnResult & { record: TurnRecord };
type Count = number | { min?: number; max?: number };

export const fi = (mm: number): string => formatFeetInches(mm);

function countOk(n: number, want: Count): boolean {
  if (typeof want === 'number') return n === want;
  return (want.min === undefined || n >= want.min) && (want.max === undefined || n <= want.max);
}

function countText(want: Count): string {
  if (typeof want === 'number') return String(want);
  if (want.min !== undefined && want.max !== undefined) return `${want.min}–${want.max}`;
  return want.min !== undefined ? `at least ${want.min}` : `at most ${want.max}`;
}

const near = (a: number, b: number, tol = TOL) => Math.abs(a - b) <= tol;

// ── Turn shape ──────────────────────────────────────────────────────────────

/**
 * No tool call this turn was rejected because its input couldn't be parsed (see
 * `classifyToolError`). Claude retries, so a scenario still passes without this; it catches the
 * wasted round trips. On for every turn unless the scenario sets `allowBadInput`.
 */
export function noBadInput(t: Pick<TurnRecord, 'badInput'>, which = 'this turn'): Fail {
  const n = t.badInput.length;
  if (n === 0) return null;
  return `${which} had ${n} tool call${n === 1 ? '' : 's'} rejected for input that couldn't be parsed (first: ${t.badInput[0]!.slice(0, 160)})`;
}

export const planShown = (t: TurnLike, which = 'this turn'): Fail => (t.plan !== null ? null : `${which} should end with a plan (propose_plan)`);

export const noPlan = (t: TurnLike, which = 'this turn'): Fail => (t.plan === null ? null : `${which} should not ask for a plan (got "${t.plan.text.slice(0, 80)}")`);

/** History and parts are exactly as they were before the turn(s). */
export function nothingChanged(s: EvalSession, baseline: Baseline, which = 'the model'): Fail {
  const steps = undoSteps(s);
  if (steps !== baseline.historyLength) return `${which} should be unchanged (undo steps ${baseline.historyLength} → ${steps})`;
  const ids = Object.keys(s.bus.project.parts);
  const added = ids.filter((id) => !baseline.partIds.has(id));
  const removed = [...baseline.partIds].filter((id) => !(id in s.bus.project.parts));
  if (added.length > 0 || removed.length > 0) return `${which} should be unchanged (${added.length} parts added, ${removed.length} removed)`;
  return null;
}

/** Exactly one new undo step, made by Claude in this turn. */
export function oneUndoStep(s: EvalSession, baseline: Baseline, t: TurnLike): Fail {
  const history = s.bus.listHistory(Number.MAX_SAFE_INTEGER).filter((h) => !h.isUndone);
  const added = history.length - baseline.historyLength;
  if (added !== 1) return `the turn should add exactly one undo step (got ${added})`;
  const last = history.at(-1)!;
  if (last.source !== 'claude' || last.turnId !== t.turnId) return `the new undo step should be Claude's turn ${t.turnId} (got ${last.source} ${last.turnId ?? '-'})`;
  return null;
}

export function offeredOptions(t: TurnLike, min = 2): Fail {
  const n = t.options?.length ?? 0;
  return n >= min ? null : `Claude should offer at least ${min} alternatives with offer_options (got ${n})`;
}

export const calledTool = (t: TurnLike, name: string): Fail =>
  t.record.toolCalls.includes(name) ? null : `Claude should call ${name} (called: ${t.record.toolCalls.join(', ') || 'nothing'})`;

export const didNotCall = (t: TurnLike, name: string): Fail => (t.record.toolCalls.includes(name) ? `Claude should not call ${name}` : null);

/** No tool that changes the model was called. */
export function noMutatingCalls(t: TurnLike): Fail {
  const bad = t.record.toolCalls.filter((n) => MUTATING_TOOLS.has(n));
  return bad.length === 0 ? null : `Claude should not change anything (called ${[...new Set(bad)].join(', ')})`;
}

/** Used sparingly: for refusals and answers only. */
export const textMentions = (t: TurnLike, re: RegExp, what: string): Fail => (re.test(t.text) ? null : `Claude's reply should mention ${what}`);

/**
 * Feet and inch marks as Claude may write them: words, straight quotes, the primes the app
 * formats with (9′ 0″) and curly quotes. Use these in any regex that matches a length.
 */
export const FEET_MARK = String.raw`(?:ft\b|foot|feet|['′’])`;
export const INCH_MARK = String.raw`(?:in\b|inch|inches|["″”])`;

/** Matches a whole number of feet, e.g. 9ft, 9 feet, 9-foot, 9', 9′ or 9’ (not 19ft). */
export const feetRe = (n: number): RegExp => new RegExp(String.raw`(?<![\d.])${n}(?:\s*|-)${FEET_MARK}`, 'i');

/** The turn ended with a real reply: not aborted, not cut off or refused, and Claude said something. */
export function answered(t: TurnLike, which = 'this turn'): Fail {
  if (t.aborted) return `${which} was aborted`;
  if (t.stopReason !== 'end_turn' && t.stopReason !== 'stop_sequence') return `${which} should end normally (stop reason ${t.stopReason ?? 'none'})`;
  if (t.text.trim() === '') return `${which} should get a reply from Claude (it said nothing)`;
  return null;
}

// ── Counts ──────────────────────────────────────────────────────────────────

export const assembliesOf = (p: Project, kind: Assembly['kind']): Assembly[] => Object.values(p.assemblies).filter((a) => a.kind === kind);

export const partsOf = (p: Project, role: PartRole, filter?: (x: Part) => boolean): Part[] =>
  Object.values(p.parts).filter((x) => x.role === role && (!filter || filter(x)));

export const partsIn = (p: Project, asmId: string): Part[] => Object.values(p.parts).filter((x) => x.assemblyId === asmId);

export function assemblyCount(p: Project, kind: Assembly['kind'], want: Count, label: string = `${kind} assemblies`): Fail {
  const n = assembliesOf(p, kind).length;
  return countOk(n, want) ? null : `${countText(want)} ${label} (got ${n})`;
}

export function partCount(p: Project, role: PartRole, want: Count, filter?: (x: Part) => boolean, label: string = `${role} parts`): Fail {
  const n = partsOf(p, role, filter).length;
  return countOk(n, want) ? null : `${countText(want)} ${label} (got ${n})`;
}

// ── Dimensions ──────────────────────────────────────────────────────────────

/** The one slab is w × d feet (either way round), ±1in. */
export function slabFootprint(p: Project, wFt: number, dFt: number): Fail {
  const slabs = partsOf(p, 'slab');
  if (slabs.length !== 1) return `one slab (got ${slabs.length})`;
  const s = slabs[0]!;
  const [short, long] = [s.size.length, s.size.width].sort((a, b) => a - b) as [number, number];
  const [ws, wl] = [wFt * FT, dFt * FT].sort((a, b) => a - b) as [number, number];
  return near(short, ws) && near(long, wl) ? null : `slab footprint should be ${wFt}×${dFt} ±1in (got ${fi(short)} × ${fi(long)})`;
}

/** Every common stud is this long: 9ft walls → 103 1/2in, 8ft walls → 91 1/2in (height less three 1 1/2in plates). */
export function commonStudLength(p: Project, inches: number): Fail {
  const studs = partsOf(p, 'stud', (x) => x.tags.includes('common'));
  if (studs.length === 0) return 'there should be common studs';
  const off = studs.filter((x) => !near(x.size.length, inches * IN, 1));
  return off.length === 0 ? null : `common studs should be ${fi(inches * IN)} (${off.length} are not, e.g. ${off[0]!.id} at ${fi(off[0]!.size.length)})`;
}

export function boundsOf(parts: readonly Part[]): Aabb | null {
  if (parts.length === 0) return null;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const part of parts) {
    const b = aabbOf(partBox(part));
    for (const k of ['x', 'y', 'z'] as const) {
      min[k] = Math.min(min[k], b.min[k]);
      max[k] = Math.max(max[k], b.max[k]);
    }
  }
  return { min, max };
}

/** World bounding box of an assembly's parts. */
export const assemblyBounds = (p: Project, asmId: string): Aabb | null => boundsOf(partsIn(p, asmId));

/** The top of the assembly is this many feet above grade, ±1in. */
export function heightAboveGrade(p: Project, asmId: string, ft: number): Fail {
  const b = assemblyBounds(p, asmId);
  if (!b) return `${asmId} has no parts`;
  return near(b.max.y, ft * FT) ? null : `${asmId} should stand ${fi(ft * FT)} above grade (got ${fi(b.max.y)})`;
}

// ── Walls and openings ──────────────────────────────────────────────────────

export type Side = 'north' | 'south' | 'east' | 'west';

interface PlanPt {
  x: number;
  z: number;
}

interface WallInfo {
  id: string;
  start: PlanPt;
  end: PlanPt;
  length: number;
  side: Side | null;
}

/** Walls made with build_wall, with the side of the building each is on. */
export function walls(p: Project): WallInfo[] {
  const raw = assembliesOf(p, 'wall')
    .map((a) => ({ id: a.id, params: a.builder?.params as { start?: PlanPt; end?: PlanPt; length?: number } | undefined }))
    .filter((w): w is { id: string; params: { start: PlanPt; end: PlanPt; length?: number } } => !!w.params?.start && !!w.params?.end);
  if (raw.length === 0) return [];
  const xs = raw.flatMap((w) => [w.params.start.x, w.params.end.x]);
  const zs = raw.flatMap((w) => [w.params.start.z, w.params.end.z]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  return raw.map(({ id, params: { start, end, length } }) => {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const mx = (start.x + end.x) / 2;
    const mz = (start.z + end.z) / 2;
    let side: Side | null;
    if (Math.abs(dx) >= Math.abs(dz)) side = mz < cz - 1 ? 'north' : mz > cz + 1 ? 'south' : null;
    else side = mx < cx - 1 ? 'west' : mx > cx + 1 ? 'east' : null;
    return { id, start, end, length: length ?? Math.hypot(dx, dz), side };
  });
}

export interface OpeningInfo {
  asmId: string;
  kind: string;
  wallId: string;
  side: Side | null;
  roWidth: number;
  roHeight: number;
  /** Distance along the wall from its start to the opening's centre. */
  centerU: number;
  /** The opening's centre on the plan. */
  center: PlanPt;
}

/** Every framed opening, read from its add_opening recipe (falling back to the door/window panel). */
export function openings(p: Project): OpeningInfo[] {
  const ws = new Map(walls(p).map((w) => [w.id, w]));
  return assembliesOf(p, 'opening').flatMap((a) => {
    const params = (a.builder?.params ?? {}) as { wallId?: string; kind?: string; at?: number; width?: number; height?: number };
    const panel = partsIn(p, a.id).find((x) => x.role === 'panel');
    const kind = params.kind ?? (panel ? (['sliding-door', 'door', 'window'].find((k) => panel.tags.includes(k)) ?? '?') : '?');
    const wallId = params.wallId ?? '?';
    const width = params.width ?? panel?.size.length ?? 0;
    const height = params.height ?? panel?.size.width ?? 0;
    const w = ws.get(wallId);
    const centerU = (params.at ?? 0) + width / 2;
    let center: PlanPt = { x: NaN, z: NaN };
    if (w && w.length > 0) {
      const ux = (w.end.x - w.start.x) / w.length;
      const uz = (w.end.z - w.start.z) / w.length;
      center = { x: w.start.x + ux * centerU, z: w.start.z + uz * centerU };
    } else if (panel) {
      const b = aabbOf(partBox(panel));
      center = { x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2 };
    }
    return [{ asmId: a.id, kind, wallId, side: w?.side ?? null, roWidth: width, roHeight: height, centerU, center }];
  });
}

/** Exactly one opening of this kind on this wall (side or wall id), and returns it for further checks. */
/** Width bounds for a door whose prompt names no width: any standard exterior door, 32in to 38in. */
export const STANDARD_DOOR = { minWidthIn: 32, maxWidthIn: 38 } as const;

export function hasOpening(p: Project, want: { kind?: string; wall: Side | string; minWidthIn?: number; maxWidthIn?: number; widthIn?: number }): { fail: Fail; opening: OpeningInfo | null } {
  const isSide = ['north', 'south', 'east', 'west'].includes(want.wall);
  const all = openings(p);
  const on = all.filter((o) => (isSide ? o.side === want.wall : o.wallId === want.wall) && (!want.kind || o.kind === want.kind));
  const desc = `${want.kind ?? 'opening'} on the ${isSide ? `${want.wall} wall` : want.wall}`;
  if (on.length !== 1) {
    const got = all.map((o) => `${o.kind} on ${o.side ?? o.wallId}`).join(', ') || 'none';
    return { fail: `one ${desc} (got: ${got})`, opening: null };
  }
  const o = on[0]!;
  if (want.minWidthIn !== undefined && o.roWidth < want.minWidthIn * IN - TOL) {
    return { fail: `the ${desc} should be at least ${fi(want.minWidthIn * IN)} wide (got ${fi(o.roWidth)})`, opening: o };
  }
  if (want.maxWidthIn !== undefined && o.roWidth > want.maxWidthIn * IN + TOL) {
    return { fail: `the ${desc} should be at most ${fi(want.maxWidthIn * IN)} wide (got ${fi(o.roWidth)})`, opening: o };
  }
  if (want.widthIn !== undefined && !near(o.roWidth, want.widthIn * IN)) {
    return { fail: `the ${desc} should be ${fi(want.widthIn * IN)} wide ±1in (got ${fi(o.roWidth)})`, opening: o };
  }
  return { fail: null, opening: o };
}

/** The walls are exactly these IDs, each still a build_wall assembly: an edit didn't rebuild or delete any. */
export function sameWalls(p: Project, ids: readonly string[]): Fail {
  const got = assembliesOf(p, 'wall').map((a) => a.id).sort();
  const want = [...ids].sort();
  if (got.join(',') !== want.join(',')) return `the walls should still be ${want.join(', ')} (got ${got.join(', ') || 'none'})`;
  const rebuilt = ids.filter((id) => p.assemblies[id]?.builder?.name !== 'build_wall');
  return rebuilt.length === 0 ? null : `${rebuilt.join(', ')} should still be made with build_wall`;
}

/** How many pieces the wall's bottom plate is in (one when no door cuts it). */
export const bottomPlatePieces = (p: Project, wallId: string): number => partsIn(p, wallId).filter((x) => x.role === 'plate' && x.tags.includes('bottom')).length;

/** A header (tagged with the opening) spans the whole rough opening. */
export function headerOverOpening(p: Project, o: OpeningInfo | null): Fail {
  if (!o) return null; // hasOpening already failed
  const headers = partsOf(p, 'header', (x) => x.tags.includes(`opening:${o.asmId}`));
  if (headers.length === 0) return `${o.asmId} should have a header`;
  const longest = Math.max(...headers.map((h) => h.size.length));
  return longest >= o.roWidth - 1 ? null : `${o.asmId}'s header (${fi(longest)}) should span the ${fi(o.roWidth)} rough opening`;
}

/** Plan distance from the opening's centre to the end of its wall on the given side (e.g. the north end of the west wall). */
export function distanceFromWallEnd(p: Project, o: OpeningInfo, end: Side): number {
  const w = walls(p).find((x) => x.id === o.wallId);
  if (!w) return NaN;
  const key = end === 'north' || end === 'south' ? 'z' : 'x';
  const pickMin = end === 'north' || end === 'west';
  const a = w.start[key] <= w.end[key] ? w.start : w.end;
  const b = a === w.start ? w.end : w.start;
  const pt = pickMin ? a : b;
  return Math.hypot(o.center.x - pt.x, o.center.z - pt.z);
}

/** Where a scenario can ask for a new window: a wall, a corner to measure from, and the centre's distance from it. */
export interface WindowSpot {
  wallId: string;
  side: Side;
  /** The wall end the distance is measured from (west for north/south walls, north for east/west walls). */
  corner: Side;
  /** Plan distance from that end of the wall to the window's centre, in whole feet. */
  fromCornerFt: number;
}

/**
 * Finds a place for a new window of `widthFt` on an outside wall: centred on a whole foot, with
 * `clearFt` of wall around the centre clear of every opening (each widened by 6in for its jack
 * and king studs) and the centre at least `cornerFt` from either end of the wall. Tries the
 * north, east, south and west walls in turn and prefers 4ft from the corner, so the same model
 * always gives the same spot. Fails when there is no such span, so a scenario can stop cleanly
 * instead of asking for a window that would overlap one.
 */
export function freeWindowSpot(p: Project, opts: { clearFt?: number; cornerFt?: number } = {}): { spot: WindowSpot | null; fail: Fail } {
  const half = ((opts.clearFt ?? 4) * FT) / 2;
  const cornerFt = opts.cornerFt ?? 3;
  const ws = walls(p);
  const ops = openings(p);
  for (const side of ['north', 'east', 'south', 'west'] as const) {
    for (const w of ws.filter((x) => x.side === side)) {
      const corner: Side = side === 'north' || side === 'south' ? 'west' : 'north';
      const key = corner === 'west' ? 'x' : 'z';
      // u runs from the wall's start; measure from whichever end is the corner (smaller x or z).
      const fromStart = w.start[key] <= w.end[key];
      const taken = ops.filter((o) => o.wallId === w.id).map((o) => [o.centerU - o.roWidth / 2 - 6 * IN, o.centerU + o.roWidth / 2 + 6 * IN] as const);
      const maxFt = Math.floor(w.length / FT - cornerFt);
      // 4ft from the corner first, then further along, then 3ft if the corner margin allows it.
      const tries: number[] = [];
      for (let d = Math.max(4, Math.ceil(cornerFt)); d <= maxFt; d++) tries.push(d);
      if (cornerFt <= 3 && maxFt >= 3) tries.push(3);
      for (const d of tries) {
        const u = fromStart ? d * FT : w.length - d * FT;
        if (taken.every(([a, b]) => u + half <= a || u - half >= b)) return { spot: { wallId: w.id, side, corner, fromCornerFt: d }, fail: null };
      }
    }
  }
  const got = ops.map((o) => `${o.kind} on ${o.side ?? o.wallId}`).join(', ') || 'none';
  return { spot: null, fail: `no outside wall has ${fi(2 * half)} clear of openings at least ${fi(cornerFt * FT)} from its corners, so there is nowhere to ask for a new window (walls: ${ws.length}, openings: ${got})` };
}

/** The request for a 3ft window at the spot, e.g. "Add a 3ft window to the north wall, centred 4ft from the west corner". */
export const windowSpotPrompt = (s: WindowSpot): string => `Add a 3ft window to the ${s.side} wall, centred ${s.fromCornerFt}ft from the ${s.corner} corner`;

/** Exactly one opening is new since `before` (opening assembly ids): a window of `widthIn` on the spot's wall, centred where asked ±1in. */
export function newWindowAt(p: Project, before: ReadonlySet<string>, spot: WindowSpot, widthIn = 36): Fail {
  const added = openings(p).filter((o) => !before.has(o.asmId));
  const where = `the ${spot.side} wall, ${spot.fromCornerFt}ft from the ${spot.corner} corner`;
  if (added.length !== 1) return `exactly one new opening on ${where} (got ${added.length}: ${added.map((o) => `${o.kind} on ${o.side ?? o.wallId}`).join(', ') || 'none'})`;
  const o = added[0]!;
  if (o.kind !== 'window') return `the new opening on ${where} should be a window (got ${o.kind})`;
  if (o.wallId !== spot.wallId) return `the new window should be on the ${spot.side} wall ${spot.wallId} (got ${o.side ?? '?'} ${o.wallId})`;
  if (!near(o.roWidth, widthIn * IN)) return `the new window should be ${fi(widthIn * IN)} wide ±1in (got ${fi(o.roWidth)})`;
  const d = distanceFromWallEnd(p, o, spot.corner);
  if (!near(d, spot.fromCornerFt * FT)) return `the new window's centre should be ${fi(spot.fromCornerFt * FT)} from the ${spot.corner} corner ±1in (got ${fi(d)})`;
  return null;
}

/** Opening assembly ids now, to pass to `newWindowAt` after the turn. */
export const openingIds = (p: Project): Set<string> => new Set(assembliesOf(p, 'opening').map((a) => a.id));

// ── Joints ──────────────────────────────────────────────────────────────────

/**
 * Every joint passes the checks connect applies: the joint type exists, GROUND is only ever
 * second, two different parts that both exist, and both materials accept the joint type.
 * connect's duplicate rule ("already joined by…") is left out: builders legitimately nail
 * the same pair at several places (e.g. a rafter tie toenailed to a plate at both ends).
 * Reports the first 3 problems.
 */
export function jointsValid(p: Project, catalog: CatalogIndex): string[] {
  const problems: string[] = [];
  for (const j of Object.values(p.joints)) {
    const errors = checkJoint(p, { jointTypeId: j.jointTypeId, partIds: j.partIds, selfId: j.id }, catalog).filter((e) => e.code !== 'conflict');
    if (errors.length > 0) problems.push(`${j.id}: ${errors[0]!.message}`);
  }
  if (problems.length === 0) return [];
  return [`${problems.length} invalid joints: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? '…' : ''}`];
}

/**
 * Roles every builder joins to something; self-check confirms the builders leave none of
 * these unjoined (walls, openings, gable and shed roofs, floors on piers, fences). Sheathing,
 * panels, slabs and site context are left out: they are fastened or simply sit in place.
 */
export const FRAMING_ROLES: readonly PartRole[] = ['stud', 'plate', 'header', 'sill', 'rafter', 'ridge', 'joist', 'rim', 'blocking', 'beam', 'post', 'pier', 'rail'];

/** Every framing part appears in at least one joint: nothing floats. */
export function framingConnected(p: Project, roles: readonly PartRole[] = FRAMING_ROLES): Fail {
  const joined = new Set(Object.values(p.joints).flatMap((j) => j.partIds));
  const loose = Object.values(p.parts).filter((x) => roles.includes(x.role) && !joined.has(x.id));
  if (loose.length === 0) return null;
  return `${loose.length} framing parts have no joint (e.g. ${loose
    .slice(0, 3)
    .map((x) => `${x.id} ${x.role}`)
    .join(', ')})`;
}

// ── Clashes ─────────────────────────────────────────────────────────────────

/** Joint types that set one part inside the other (a fence post cast in its concrete pier), so the two overlap by design. */
export const EMBEDDING_JOINTS: ReadonlySet<string> = new Set(['post-embedded']);

/** No two parts interpenetrate, except pairs joined by an embedding joint. */
export function noClashes(p: Project): Fail {
  const embedded = new Set(
    Object.values(p.joints)
      .filter((j) => EMBEDDING_JOINTS.has(j.jointTypeId))
      .map((j) => [...j.partIds].sort().join('|')),
  );
  const clashes = findAllClashes(p, { skip: (a, b) => embedded.has([a.id, b.id].sort().join('|')) });
  return clashes.length === 0 ? null : `no clashes (got ${clashes.length}: ${clashes.slice(0, 3).map((c) => c.join('×')).join(', ')})`;
}

/** No part runs through a part matching `target` (e.g. site context), whatever else overlaps. */
export function noClashesWith(p: Project, target: (x: Part) => boolean, what: string): Fail {
  const hits = findAllClashes(p).filter(([a, b]) => target(p.parts[a]!) !== target(p.parts[b]!));
  return hits.length === 0 ? null : `nothing should run through ${what} (got ${hits.length}: ${hits.slice(0, 3).map((c) => c.join('×')).join(', ')})`;
}

export const isSiteContext = (x: Part): boolean => x.tags.includes('site-context');

// ── Composite ───────────────────────────────────────────────────────────────

/** Valid joints, nothing floating, nothing running through anything. Every building scenario runs it. */
export function soundBuild(p: Project, catalog: CatalogIndex): Fail[] {
  return [...jointsValid(p, catalog), framingConnected(p), noClashes(p)];
}

// ── Tier 3: pergolas and pool fences ────────────────────────────────────────

/** The project's pool water parts (site context tagged kind:pool and water). */
export const poolWater = (p: Project): Part[] => Object.values(p.parts).filter((x) => x.tags.includes('kind:pool') && x.tags.includes('water'));

/**
 * One build_pergola with a roof of clear polycarbonate panels on at least four posts, sloped
 * at least 1 in 12.
 */
export function pergolaPolycarbonate(p: Project): Fail[] {
  const pergolas = Object.values(p.assemblies).filter((a) => a.builder?.name === 'build_pergola' && a.builder.params.part === undefined);
  if (pergolas.length !== 1) return [`one pergola (got ${pergolas.length})`];
  const main = pergolas[0]!;
  const roof = Object.values(p.assemblies).find((a) => a.kind === 'roof' && a.builder?.name === 'build_pergola' && a.builder.params.frame === main.id);
  const fails: Fail[] = [];
  if (!roof) return ['the pergola should have a roof assembly'];
  const panels = partsIn(p, roof.id).filter((x) => x.role === 'sheathing');
  fails.push(panels.length > 0 ? null : 'the pergola roof has no panels');
  const notPoly = panels.filter((x) => x.materialId !== 'polycarbonate-corrugated');
  fails.push(notPoly.length === 0 ? null : `roof panels should be polycarbonate-corrugated (got ${[...new Set(notPoly.map((x) => x.materialId))].join(', ')})`);
  const posts = partsIn(p, main.id).filter((x) => x.role === 'post').length;
  fails.push(posts >= 4 ? null : `at least 4 posts (got ${posts})`);
  const rise = Number(main.builder!.params.slopeRise);
  fails.push(rise >= 1 - 1e-6 ? null : `slope at least 1 in 12 (got ${rise} in 12)`);
  return fails;
}

/**
 * A build_fence pool barrier at least 4ft tall that encloses the pool, with a gate on
 * self-closing hinges and a magnetic latch at least 54in up, and nothing running through
 * the pool.
 */
export function poolFence(p: Project): Fail[] {
  const pools = poolWater(p);
  if (pools.length === 0) return ['there is no pool to fence'];
  const fences = Object.values(p.assemblies).filter((a) => a.builder?.name === 'build_fence' && a.builder.params.poolBarrier === true);
  if (fences.length === 0) return ['a build_fence with "poolBarrier": true'];
  const fails: Fail[] = [];
  const ids = new Set(fences.flatMap((f) => partsIn(p, f.id).map((x) => x.id)));
  for (const f of fences) {
    const b = assemblyBounds(p, f.id);
    fails.push(b && b.max.y >= 48 * IN - TOL ? null : `${f.id} should stand at least 4ft above grade (got ${b ? fi(b.max.y) : 'nothing'})`);
  }
  const joints = Object.values(p.joints).filter((j) => j.partIds.some((id) => ids.has(id)));
  const hinges = joints.filter((j) => j.jointTypeId === 'gate-hinge-self-closing');
  const latches = joints.filter((j) => j.jointTypeId === 'gate-latch-magnetic');
  fails.push(hinges.length > 0 ? null : 'a gate on self-closing hinges (gate-hinge-self-closing)');
  fails.push(latches.length > 0 ? null : 'a magnetic self-latching gate latch (gate-latch-magnetic)');
  fails.push(latches.every((j) => j.at.y >= 54 * IN - 0.5) ? null : 'the pool gate latch should be at least 54in up');
  fails.push(noClashesWith(p, (x) => x.tags.includes('kind:pool'), 'the pool'));
  // Encloses: the fence's plan bounds contain the pool footprint.
  const fb = boundsOf(Object.values(p.parts).filter((x) => ids.has(x.id)));
  const pb = boundsOf(pools);
  const encloses = fb !== null && pb !== null && fb.min.x <= pb.min.x && fb.max.x >= pb.max.x && fb.min.z <= pb.min.z && fb.max.z >= pb.max.z;
  fails.push(encloses ? null : 'the pool barrier should go all the way around the pool');
  return fails;
}
