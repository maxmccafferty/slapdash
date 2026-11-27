/**
 * The exact shape of a part with cuts (schema v2 `Part.cuts`).
 *
 * A part is a box (see `obb.ts`); cuts only ever remove material from it, so the box stays
 * a valid, conservative bound and `size.length` is the long-point length. This module turns
 * `(size, cuts)` into the exact solid, as a list of disjoint convex pieces in the part's
 * local frame (mm), and is the one place everything that needs the real shape reads it:
 * clash checks, the renderer's cut meshes and outlines, the 2D sheet, the cut list and the
 * solver's notch check.
 *
 * - With no notches the solid is one convex polyhedron: the box clipped by each end/edge
 *   cut plane (compound slope + miter cuts included).
 * - With notches, end cuts may only have `slope` (no miter or edge cuts), so the solid is
 *   a prism along local y of a 2D region in x–z: the clipped rectangle minus each convex
 *   notch, split into disjoint convex polygons.
 */
import type { PartCuts, PartSize, EndCut } from '../model/schema.ts';
import { formatFeetInches } from '../units/length.ts';
import { cross, dot, norm, partBox, rotationAxes, scale, boxesOverlap, type Aabb, type PartLike } from './obb.ts';
import { toWorld, type PlanFrame } from './frame.ts';
import type { Vec3 } from './vec3.ts';

const EPS = 1e-6;
const WELD = 1e-4;
const RAD = Math.PI / 180;
const MAX_ANGLE = 80;

export interface CutPartLike extends PartLike {
  cuts?: PartCuts | undefined;
}

/** A convex piece of a solid, in local mm. Faces are wound counter-clockwise seen from outside. */
export interface ConvexPiece {
  vertices: Vec3[];
  /** Outward unit normals of the piece's faces. */
  normals: Vec3[];
  /** Unit directions of the piece's edges (deduplicated). */
  edgeDirs: Vec3[];
}

export interface Solid {
  pieces: ConvexPiece[];
  /** Surface triangles in local mm, outward winding (9 numbers per triangle). */
  triangles: Float64Array;
  /** Every distinct vertex of the solid, local mm. */
  vertices: Vec3[];
  /** Feature edges (between surface faces on different planes), local mm. */
  edges: Array<[Vec3, Vec3]>;
  volume: number;
}

export function hasCuts(part: { cuts?: PartCuts | undefined }): boolean {
  const c = part.cuts;
  return c !== undefined && (c.start !== undefined || c.end !== undefined || c.nearEdge !== undefined || c.farEdge !== undefined || (c.notches?.length ?? 0) > 0);
}

// ---------------------------------------------------------------------------------------
// Half-spaces for the end and edge cuts.

interface Plane {
  /** Unit normal pointing out of the kept side: keep n·p ≤ d. */
  n: Vec3;
  d: number;
}

const tan = (deg: number | undefined) => Math.tan((deg ?? 0) * RAD);

/**
 * The kept half-space of an end cut. At the start the kept side is x ≥ f(y, z); at the end
 * x ≤ L − f(y, z), where f is zero along the long-point edge and grows inward.
 */
function endPlane(cut: EndCut, at: 'start' | 'end', size: PartSize): Plane | null {
  const s = cut.slope ?? 0;
  const m = cut.miter ?? 0;
  if (s === 0 && m === 0) return null;
  const ts = tan(Math.abs(s));
  const tm = tan(Math.abs(m));
  // f(y, z) = ts·(s > 0 ? z : h − z) + tm·(m > 0 ? y : w − y) = a·y + b·z + c
  const b = s > 0 ? ts : -ts;
  const a = m > 0 ? tm : -tm;
  const c = (s < 0 ? ts * size.height : 0) + (m < 0 ? tm * size.width : 0);
  if (at === 'start') {
    // keep x ≥ a·y + b·z + c  ⇔  −x + a·y + b·z ≤ −c
    const n = { x: -1, y: a, z: b };
    const k = 1 / norm(n);
    return { n: scale(n, k), d: -c * k };
  }
  // keep x ≤ L − (a·y + b·z + c)  ⇔  x + a·y + b·z ≤ L − c
  const n = { x: 1, y: a, z: b };
  const k = 1 / norm(n);
  return { n: scale(n, k), d: (size.length - c) * k };
}

/** The kept half-space of a width-edge cut (slope only: rotation about local x). */
function edgePlane(cut: EndCut, at: 'near' | 'far', size: PartSize): Plane | null {
  const s = cut.slope ?? 0;
  if (s === 0) return null;
  const ts = tan(Math.abs(s));
  const b = s > 0 ? ts : -ts;
  const c = s < 0 ? ts * size.height : 0;
  if (at === 'near') {
    const n = { x: 0, y: -1, z: b };
    const k = 1 / norm(n);
    return { n: scale(n, k), d: -c * k };
  }
  const n = { x: 0, y: 1, z: b };
  const k = 1 / norm(n);
  return { n: scale(n, k), d: (size.width - c) * k };
}

function cutPlanes(size: PartSize, cuts: PartCuts | undefined): Plane[] {
  if (!cuts) return [];
  const out: Plane[] = [];
  const push = (p: Plane | null) => {
    if (p) out.push(p);
  };
  if (cuts.start) push(endPlane(cuts.start, 'start', size));
  if (cuts.end) push(endPlane(cuts.end, 'end', size));
  if (cuts.nearEdge) push(edgePlane(cuts.nearEdge, 'near', size));
  if (cuts.farEdge) push(edgePlane(cuts.farEdge, 'far', size));
  return out;
}

// ---------------------------------------------------------------------------------------
// Convex polyhedra by plane clipping (the no-notch path).

interface Poly3 {
  faces: Vec3[][];
}

function boxPoly(size: PartSize): Poly3 {
  const { length: L, width: W, height: H } = size;
  const p = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
  return {
    faces: [
      [p(0, 0, 0), p(0, 0, H), p(0, W, H), p(0, W, 0)], // x = 0
      [p(L, 0, 0), p(L, W, 0), p(L, W, H), p(L, 0, H)], // x = L
      [p(0, 0, 0), p(L, 0, 0), p(L, 0, H), p(0, 0, H)], // y = 0
      [p(0, W, 0), p(0, W, H), p(L, W, H), p(L, W, 0)], // y = W
      [p(0, 0, 0), p(0, W, 0), p(L, W, 0), p(L, 0, 0)], // z = 0
      [p(0, 0, H), p(L, 0, H), p(L, W, H), p(0, W, H)], // z = H
    ],
  };
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const dist = (a: Vec3, b: Vec3) => norm(sub(a, b));

function dedupeRing(ring: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of ring) if (out.length === 0 || dist(out[out.length - 1]!, p) > WELD) out.push(p);
  while (out.length > 1 && dist(out[0]!, out[out.length - 1]!) <= WELD) out.pop();
  return out;
}

function clipPoly(poly: Poly3, pl: Plane): Poly3 | null {
  const side = (p: Vec3) => dot(pl.n, p) - pl.d;
  let anyOut = false;
  let anyIn = false;
  for (const f of poly.faces) {
    for (const p of f) {
      const s = side(p);
      if (s > EPS) anyOut = true;
      if (s < -EPS) anyIn = true;
    }
  }
  if (!anyOut) return poly;
  if (!anyIn) return null;
  const faces: Vec3[][] = [];
  const onPlane: Vec3[] = [];
  for (const f of poly.faces) {
    const out: Vec3[] = [];
    for (let i = 0; i < f.length; i++) {
      const a = f[i]!;
      const b = f[(i + 1) % f.length]!;
      const sa = side(a);
      const sb = side(b);
      if (sa <= EPS) out.push(a);
      if (Math.abs(sa) <= EPS) onPlane.push(a);
      if ((sa < -EPS && sb > EPS) || (sa > EPS && sb < -EPS)) {
        const q = lerp(a, b, sa / (sa - sb));
        out.push(q);
        onPlane.push(q);
      }
    }
    const ring = dedupeRing(out);
    if (ring.length >= 3 && polygonArea3(ring) > EPS) faces.push(ring);
  }
  const cap = orderOnPlane(onPlane, pl.n);
  if (cap.length >= 3) faces.push(cap);
  return { faces };
}

function polygonArea3(ring: Vec3[]): number {
  let acc = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < ring.length; i++) acc = add(acc, cross(ring[i]!, ring[(i + 1) % ring.length]!));
  return norm(acc) / 2;
}

/** Unique points on a plane, ordered counter-clockwise about `n` (their convex hull). */
function orderOnPlane(points: Vec3[], n: Vec3): Vec3[] {
  const uniq: Vec3[] = [];
  for (const p of points) if (!uniq.some((q) => dist(p, q) <= WELD)) uniq.push(p);
  if (uniq.length < 3) return [];
  const ref = Math.abs(n.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = scale(cross(n, ref), 1 / norm(cross(n, ref)));
  const v = cross(n, u);
  const pts2 = uniq.map((p) => ({ p, a: dot(p, u), b: dot(p, v) }));
  const hull = convexHull2(pts2.map((q) => ({ x: q.a, z: q.b })));
  return hull.map((h) => pts2.find((q) => Math.abs(q.a - h.x) <= EPS * 10 && Math.abs(q.b - h.z) <= EPS * 10)!.p);
}

/** Counter-clockwise convex hull (x right, z up), collinear points dropped. */
function convexHull2(points: P2[]): P2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (pts.length < 3) return pts;
  const crossO = (o: P2, a: P2, b: P2) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: P2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossO(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= EPS) lower.pop();
    lower.push(p);
  }
  const upper: P2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && crossO(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= EPS) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// ---------------------------------------------------------------------------------------
// 2D convex polygons in local x–z (the notch path). Counter-clockwise with x right, z up.

export interface P2 {
  x: number;
  z: number;
}

const cross2 = (a: P2, b: P2, c: P2) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

function area2(poly: readonly P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a.x * b.z - b.x * a.z;
  }
  return s / 2;
}

/** Keep the side of the line where `f(p) ≤ 0`. */
function clip2(poly: readonly P2[], f: (p: P2) => number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const fa = f(a);
    const fb = f(b);
    if (fa <= EPS) out.push(a);
    if ((fa < -EPS && fb > EPS) || (fa > EPS && fb < -EPS)) {
      const t = fa / (fa - fb);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  const ring: P2[] = [];
  for (const p of out) if (ring.length === 0 || Math.hypot(ring[ring.length - 1]!.x - p.x, ring[ring.length - 1]!.z - p.z) > WELD) ring.push(p);
  while (ring.length > 1 && Math.hypot(ring[0]!.x - ring[ring.length - 1]!.x, ring[0]!.z - ring[ring.length - 1]!.z) <= WELD) ring.pop();
  return ring.length >= 3 && area2(ring) > EPS ? ring : [];
}

/** The line through a→b as f(p) = cross(b − a, p − a): > 0 left of it (inside a ccw polygon). */
const leftOf = (a: P2, b: P2) => (p: P2) => cross2(a, b, p);

/** Counter-clockwise copy of a notch profile; null if it is not strictly convex. */
function ccwConvex(profile: readonly P2[]): P2[] | null {
  const a = area2(profile);
  if (Math.abs(a) <= EPS) return null;
  const ring = a > 0 ? [...profile] : [...profile].reverse();
  for (let i = 0; i < ring.length; i++) {
    if (cross2(ring[i]!, ring[(i + 1) % ring.length]!, ring[(i + 2) % ring.length]!) <= EPS) return null;
  }
  return ring;
}

/** Split `piece` into the disjoint convex parts outside the convex ccw `notch`. */
function subtractConvex(piece: P2[], notch: P2[]): P2[][] {
  const out: P2[][] = [];
  let rest = piece;
  for (let i = 0; i < notch.length && rest.length > 0; i++) {
    const f = leftOf(notch[i]!, notch[(i + 1) % notch.length]!);
    // The part of what's left that is outside this edge (f ≤ 0) is a finished piece;
    // carry on with the part inside it.
    const outside = clip2(rest, f);
    if (outside.length > 0) out.push(outside);
    rest = clip2(rest, (p) => -f(p));
  }
  return out;
}

function endLine2(cut: EndCut | undefined, at: 'start' | 'end', size: PartSize): ((p: P2) => number) | null {
  const s = cut?.slope ?? 0;
  if (s === 0) return null;
  const ts = tan(Math.abs(s));
  const off = (z: number) => ts * (s > 0 ? z : size.height - z);
  return at === 'start' ? (p) => off(p.z) - p.x : (p) => p.x - (size.length - off(p.z));
}

function profileSection(size: PartSize, cuts: PartCuts | undefined): P2[] {
  let poly: P2[] = [
    { x: 0, z: 0 },
    { x: size.length, z: 0 },
    { x: size.length, z: size.height },
    { x: 0, z: size.height },
  ];
  for (const f of [endLine2(cuts?.start, 'start', size), endLine2(cuts?.end, 'end', size)]) {
    if (f) poly = clip2(poly, f);
    if (poly.length === 0) return [];
  }
  return poly;
}

// ---------------------------------------------------------------------------------------
// Building the solid.

function emptySolid(): Solid {
  return { pieces: [], triangles: new Float64Array(0), vertices: [], edges: [], volume: 0 };
}

function pieceFromFaces(faces: Vec3[][]): ConvexPiece {
  const vertices: Vec3[] = [];
  for (const f of faces) for (const p of f) if (!vertices.some((q) => dist(p, q) <= WELD)) vertices.push(p);
  const normals = faces.map((f) => {
    let acc = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < f.length; i++) acc = add(acc, cross(f[i]!, f[(i + 1) % f.length]!));
    return scale(acc, 1 / norm(acc));
  });
  const edgeDirs: Vec3[] = [];
  for (const f of faces) {
    for (let i = 0; i < f.length; i++) {
      const d = sub(f[(i + 1) % f.length]!, f[i]!);
      const n = norm(d);
      if (n <= WELD) continue;
      const u = scale(d, 1 / n);
      if (!edgeDirs.some((e) => Math.abs(Math.abs(dot(e, u)) - 1) < 1e-9)) edgeDirs.push(u);
    }
  }
  return { vertices, normals, edgeDirs };
}

function polyhedronSolid(size: PartSize, cuts: PartCuts | undefined): Solid {
  let poly: Poly3 | null = boxPoly(size);
  for (const pl of cutPlanes(size, cuts)) {
    poly = clipPoly(poly, pl);
    if (!poly) return emptySolid();
  }
  if (poly.faces.length < 4) return emptySolid();
  // Weld vertices shared between faces.
  const verts: Vec3[] = [];
  const weld = (p: Vec3) => {
    const hit = verts.find((q) => dist(p, q) <= WELD);
    if (hit) return hit;
    verts.push(p);
    return p;
  };
  const faces = poly.faces.map((f) => dedupeRing(f.map(weld))).filter((f) => f.length >= 3);
  const tris: number[] = [];
  let volume = 0;
  const edgeKeys = new Set<string>();
  const edges: Array<[Vec3, Vec3]> = [];
  for (const f of faces) {
    const c = scale(f.reduce(add, { x: 0, y: 0, z: 0 }), 1 / f.length);
    for (let i = 0; i < f.length; i++) {
      const a = f[i]!;
      const b = f[(i + 1) % f.length]!;
      tris.push(c.x, c.y, c.z, a.x, a.y, a.z, b.x, b.y, b.z);
      volume += dot(c, cross(a, b)) / 6;
      const ia = verts.indexOf(a);
      const ib = verts.indexOf(b);
      const key = ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push([a, b]);
      }
    }
  }
  return { pieces: [pieceFromFaces(faces)], triangles: Float64Array.from(tris), vertices: verts, edges: mergeCollinear(edges), volume };
}

/** Join edge segments that continue each other in a straight line (from split face edges). */
function mergeCollinear(edges: Array<[Vec3, Vec3]>): Array<[Vec3, Vec3]> {
  const list = edges.map((e) => [...e] as [Vec3, Vec3]);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        for (const [p, q] of [
          [0, 0],
          [0, 1],
          [1, 0],
          [1, 1],
        ] as const) {
          if (dist(a[p], b[q]) > WELD) continue;
          const shared = a[p];
          const ea = a[1 - p]!;
          const eb = b[1 - q]!;
          const da = sub(ea, shared);
          const db = sub(eb, shared);
          const c = norm(cross(da, db));
          if (c > 1e-6 * norm(da) * norm(db) || dot(da, db) >= 0) continue;
          // Only merge through a vertex no other edge uses (a true collinear split point).
          const others = list.filter((e, k) => k !== i && k !== j && (dist(e[0], shared) <= WELD || dist(e[1], shared) <= WELD));
          if (others.length > 0) continue;
          list[i] = [ea, eb];
          list.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return list;
}

function prismSolid(size: PartSize, cuts: PartCuts): Solid {
  const W = size.width;
  let pieces2: P2[][] = [];
  const section = profileSection(size, cuts);
  if (section.length > 0) pieces2 = [section];
  for (const notch of cuts.notches ?? []) {
    const ring = ccwConvex(notch.profile);
    if (!ring) continue;
    pieces2 = pieces2.flatMap((p) => subtractConvex(p, ring));
  }
  pieces2 = pieces2.filter((p) => area2(p) > EPS);
  if (pieces2.length === 0) return emptySolid();

  // Weld 2D vertices, then insert every vertex lying on another piece's edge (T-junctions),
  // so shared edges between pieces match exactly.
  const verts: P2[] = [];
  const weld = (p: P2) => {
    const hit = verts.find((q) => Math.hypot(p.x - q.x, p.z - q.z) <= WELD);
    if (hit) return hit;
    verts.push(p);
    return p;
  };
  const welded = pieces2.map((p) => p.map(weld));
  const rings = welded.map((ring) => {
    const out: P2[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      out.push(a);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const on = verts
        .filter((v) => v !== a && v !== b)
        .map((v) => ({ v, t: ((v.x - a.x) * (b.x - a.x) + (v.z - a.z) * (b.z - a.z)) / (len * len) }))
        .filter(({ v, t }) => t > 1e-9 && t < 1 - 1e-9 && Math.abs(cross2(a, b, v)) / len <= WELD)
        .sort((p, q) => p.t - q.t);
      for (const { v } of on) out.push(v);
    }
    return out;
  });

  const tris: number[] = [];
  const tri = (a: Vec3, b: Vec3, c: Vec3) => tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const at = (p: P2, y: number): Vec3 => ({ x: p.x, y, z: p.z });
  // Caps. Local frame is right-handed (x, y, z); a polygon ccw in (x right, z up) has
  // normal x̂ × ẑ = −ŷ, so it faces out on the y = 0 cap and is reversed for y = W.
  const directed = new Map<string, [P2, P2]>();
  const id = (p: P2) => verts.indexOf(p);
  for (const ring of rings) {
    const c = { x: ring.reduce((s, p) => s + p.x, 0) / ring.length, z: ring.reduce((s, p) => s + p.z, 0) / ring.length };
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      tri(at(c, 0), at(a, 0), at(b, 0));
      tri(at(c, W), at(b, W), at(a, W));
      directed.set(`${id(a)}>${id(b)}`, [a, b]);
    }
  }
  // Side walls: directed edges with no reverse twin are on the boundary.
  const boundary: Array<[P2, P2]> = [];
  for (const [key, e] of directed) {
    const [ia, ib] = key.split('>');
    if (!directed.has(`${ib}>${ia}`)) boundary.push(e);
  }
  for (const [a, b] of boundary) {
    // Outward normal of a ccw boundary edge a→b (x right, z up) points to its right.
    tri(at(a, 0), at(b, W), at(b, 0));
    tri(at(a, 0), at(a, W), at(b, W));
  }

  let area = 0;
  for (const p of pieces2) area += area2(p);

  // Feature edges: boundary loops with collinear runs merged, on both caps, plus a y edge
  // at each corner.
  const corners = new Set<P2>();
  const segs2: Array<[P2, P2]> = [];
  const next = new Map<P2, P2[]>();
  for (const [a, b] of boundary) next.set(a, [...(next.get(a) ?? []), b]);
  const prev = new Map<P2, P2>();
  for (const [a, b] of boundary) prev.set(b, a);
  const isCorner = (p: P2) => {
    const a = prev.get(p);
    const nb = next.get(p);
    if (!a || !nb || nb.length !== 1) return true;
    const b = nb[0]!;
    const la = Math.hypot(p.x - a.x, p.z - a.z);
    const lb = Math.hypot(b.x - p.x, b.z - p.z);
    return Math.abs(cross2(a, p, b)) > 1e-6 * la * lb;
  };
  for (const [a] of boundary) if (isCorner(a)) corners.add(a);
  for (const start of corners) {
    for (const first of next.get(start) ?? []) {
      let end = first;
      let guard = 0;
      while (!corners.has(end) && guard++ < 10_000) end = next.get(end)![0]!;
      segs2.push([start, end]);
    }
  }
  const edges: Array<[Vec3, Vec3]> = [];
  for (const [a, b] of segs2) {
    edges.push([at(a, 0), at(b, 0)], [at(a, W), at(b, W)]);
  }
  for (const c of corners) edges.push([at(c, 0), at(c, W)]);

  const pieces: ConvexPiece[] = pieces2.map((p) => {
    const faces: Vec3[][] = [p.map((q) => at(q, 0)), [...p].reverse().map((q) => at(q, W))];
    for (let i = 0; i < p.length; i++) {
      const a = p[i]!;
      const b = p[(i + 1) % p.length]!;
      faces.push([at(a, 0), at(a, W), at(b, W), at(b, 0)].reverse());
    }
    return pieceFromFaces(faces);
  });
  const vertices = [...new Set(rings.flat())].flatMap((p) => [at(p, 0), at(p, W)]);
  return { pieces, triangles: Float64Array.from(tris), vertices, edges, volume: area * W };
}

/** The exact solid of `(size, cuts)`, uncached. */
export function buildSolid(size: PartSize, cuts: PartCuts | undefined): Solid {
  if (cuts && (cuts.notches?.length ?? 0) > 0) return prismSolid(size, cuts);
  return polyhedronSolid(size, cuts);
}

const solidCache = new WeakMap<object, Solid>();

/** The part's solid in local mm. Memoised per part object (parts are immutable). */
export function partSolid(part: { size: PartSize; cuts?: PartCuts | undefined }): Solid {
  let s = solidCache.get(part);
  if (!s) {
    s = buildSolid(part.size, part.cuts);
    solidCache.set(part, s);
  }
  return s;
}

/** Surface triangles of the solid in local mm, outward winding, 9 numbers per triangle. */
export function solidSurfaceTriangles(size: PartSize, cuts: PartCuts | undefined): Float64Array {
  return buildSolid(size, cuts).triangles;
}

// ---------------------------------------------------------------------------------------
// World-space helpers.

function localToWorld(part: PartLike): (p: Vec3) => Vec3 {
  const [X, Y, Z] = rotationAxes(part.rotation);
  const o = part.position;
  return (p) => ({
    x: o.x + X.x * p.x + Y.x * p.y + Z.x * p.z,
    y: o.y + X.y * p.x + Y.y * p.y + Z.y * p.z,
    z: o.z + X.z * p.x + Y.z * p.y + Z.z * p.z,
  });
}

function localDirToWorld(part: PartLike): (d: Vec3) => Vec3 {
  const [X, Y, Z] = rotationAxes(part.rotation);
  return (d) => ({
    x: X.x * d.x + Y.x * d.y + Z.x * d.z,
    y: X.y * d.x + Y.y * d.y + Z.y * d.z,
    z: X.z * d.x + Y.z * d.y + Z.z * d.z,
  });
}

function boxCornersLocal(size: PartSize): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [0, size.length]) for (const y of [0, size.width]) for (const z of [0, size.height]) out.push({ x, y, z });
  return out;
}

/** World vertices of the part's solid; the 8 box corners when it has no cuts. */
export function partSolidCorners(part: CutPartLike): Vec3[] {
  const toW = localToWorld(part);
  if (!hasCuts(part)) return boxCornersLocal(part.size).map(toW);
  return partSolid(part).vertices.map(toW);
}

export function partSolidAabb(part: CutPartLike): Aabb {
  const pts = partSolidCorners(part);
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of pts) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
    max.z = Math.max(max.z, p.z);
  }
  return { min, max };
}

/** World segments of the part's outline: the 12 box edges, or the cut solid's feature edges. */
export function partFeatureEdges(part: CutPartLike): Array<[Vec3, Vec3]> {
  const toW = localToWorld(part);
  if (!hasCuts(part)) {
    const { length: L, width: W, height: H } = part.size;
    const c = (x: number, y: number, z: number) => toW({ x: x * L, y: y * W, z: z * H });
    const out: Array<[Vec3, Vec3]> = [];
    for (const [a, b] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ] as const) {
      out.push([c(0, a, b), c(1, a, b)], [c(a, 0, b), c(a, 1, b)], [c(a, b, 0), c(a, b, 1)]);
    }
    return out;
  }
  return partSolid(part).edges.map(([a, b]) => [toW(a), toW(b)]);
}

interface WorldPiece {
  vertices: Vec3[];
  normals: Vec3[];
  edgeDirs: Vec3[];
}

const worldCache = new WeakMap<object, WorldPiece[]>();

function worldPieces(part: CutPartLike): WorldPiece[] {
  let w = worldCache.get(part);
  if (!w) {
    const toW = localToWorld(part);
    const dirW = localDirToWorld(part);
    const pieces = hasCuts(part)
      ? partSolid(part).pieces
      : [pieceFromFaces(boxPoly(part.size).faces)];
    w = pieces.map((p) => ({ vertices: p.vertices.map(toW), normals: p.normals.map(dirW), edgeDirs: p.edgeDirs.map(dirW) }));
    worldCache.set(part, w);
  }
  return w;
}

function separatedOn(a: WorldPiece, b: WorldPiece, l: Vec3, tol: number): boolean {
  let amin = Infinity;
  let amax = -Infinity;
  let bmin = Infinity;
  let bmax = -Infinity;
  for (const p of a.vertices) {
    const d = dot(p, l);
    if (d < amin) amin = d;
    if (d > amax) amax = d;
  }
  for (const p of b.vertices) {
    const d = dot(p, l);
    if (d < bmin) bmin = d;
    if (d > bmax) bmax = d;
  }
  return Math.min(amax, bmax) - Math.max(amin, bmin) <= tol;
}

/**
 * Separating-axis test for two convex pieces (world coordinates): face normals of both,
 * plus cross products of their edge directions. Like `boxesOverlap`, they clash only when
 * they interpenetrate by more than `tolMm` along every axis.
 */
export function convexPiecesOverlap(a: WorldPiece, b: WorldPiece, tolMm = 1): boolean {
  for (const l of a.normals) if (separatedOn(a, b, l, tolMm)) return false;
  for (const l of b.normals) if (separatedOn(a, b, l, tolMm)) return false;
  for (const ea of a.edgeDirs) {
    for (const eb of b.edgeDirs) {
      const c = cross(ea, eb);
      const n = norm(c);
      if (n <= 1e-6) continue;
      if (separatedOn(a, b, scale(c, 1 / n), tolMm)) return false;
    }
  }
  return true;
}

/** Do two parts interpenetrate (by more than `tolMm` on every axis)? Exact for cut parts. */
export function partsOverlap(a: CutPartLike, b: CutPartLike, tolMm = 1): boolean {
  if (!boxesOverlap(partBox(a), partBox(b), tolMm)) return false;
  if (!hasCuts(a) && !hasCuts(b)) return true;
  const pa = worldPieces(a);
  const pb = worldPieces(b);
  for (const x of pa) for (const y of pb) if (convexPiecesOverlap(x, y, tolMm)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------
// Validation.

/**
 * Plain-language reason why `cuts` can't apply to a part of `size`, or null if they can.
 * Checks the angles, that each end leaves more than 1 mm at its short point, that notches
 * are convex and reach into the box, and that something is left.
 */
export function validateCuts(size: PartSize, cuts: PartCuts | undefined): string | null {
  if (!cuts) return null;
  const ends = [
    ['start', cuts.start],
    ['end', cuts.end],
    ['nearEdge', cuts.nearEdge],
    ['farEdge', cuts.farEdge],
  ] as const;
  for (const [where, c] of ends) {
    if (!c) continue;
    for (const k of ['slope', 'miter'] as const) {
      const a = c[k];
      if (a !== undefined && !(Math.abs(a) < MAX_ANGLE)) return `The ${where} cut's ${k} must be less than ${MAX_ANGLE}° from square (it is ${a}°).`;
    }
    if ((where === 'nearEdge' || where === 'farEdge') && c.miter !== undefined && c.miter !== 0) {
      return `An edge cut (${where}) can only have a slope, not a miter.`;
    }
  }
  const offStart = (y: number, z: number) => endOffset(cuts.start, size, y, z);
  const offEnd = (y: number, z: number) => endOffset(cuts.end, size, y, z);
  for (const y of [0, size.width]) {
    for (const z of [0, size.height]) {
      if (size.length - offStart(y, z) - offEnd(y, z) <= 1) {
        return `The end cuts would leave nothing at the short point: a ${formatFeetInches(size.length)} part can't take cuts that steep through ${formatFeetInches(size.height)}.`;
      }
    }
  }
  for (const z of [0, size.height]) {
    if (size.width - edgeOffset(cuts.nearEdge, size, z) - edgeOffset(cuts.farEdge, size, z) <= 1) {
      return `The edge cuts would leave nothing at the short point of a ${formatFeetInches(size.width)} wide part.`;
    }
  }
  const notches = cuts.notches ?? [];
  if (notches.length > 0) {
    if (cuts.start?.miter || cuts.end?.miter || cuts.nearEdge?.slope || cuts.farEdge?.slope) {
      return 'Notches can only be combined with slope (plumb or level) end cuts, not miters or edge cuts.';
    }
    const rect: P2[] = [
      { x: 0, z: 0 },
      { x: size.length, z: 0 },
      { x: size.length, z: size.height },
      { x: 0, z: size.height },
    ];
    for (const [i, n] of notches.entries()) {
      const ring = ccwConvex(n.profile);
      if (!ring) return `Notch ${i + 1} (${n.kind}) must be a convex polygon with no repeated or collinear points.`;
      const inside = clipConvex(rect, ring);
      if (inside.length === 0 || area2(inside) <= 1) return `Notch ${i + 1} (${n.kind}) is outside the part.`;
    }
  }
  const solid = buildSolid(size, cuts);
  if (solid.volume <= 1) return 'The cuts would remove the whole part.';
  return null;
}

/** Clip a convex ccw polygon to a convex ccw clip polygon. */
function clipConvex(poly: P2[], clip: P2[]): P2[] {
  let out = poly;
  for (let i = 0; i < clip.length && out.length > 0; i++) {
    const f = leftOf(clip[i]!, clip[(i + 1) % clip.length]!);
    out = clip2(out, (p) => -f(p));
  }
  return out;
}

function endOffset(cut: EndCut | undefined, size: PartSize, y: number, z: number): number {
  if (!cut) return 0;
  const s = cut.slope ?? 0;
  const m = cut.miter ?? 0;
  return tan(Math.abs(s)) * (s > 0 ? z : s < 0 ? size.height - z : 0) + tan(Math.abs(m)) * (m > 0 ? y : m < 0 ? size.width - y : 0);
}

function edgeOffset(cut: EndCut | undefined, size: PartSize, z: number): number {
  if (!cut) return 0;
  const s = cut.slope ?? 0;
  return tan(Math.abs(s)) * (s > 0 ? z : s < 0 ? size.height - z : 0);
}

// ---------------------------------------------------------------------------------------
// Cut-list wording.

export type CutName = NonNullable<EndCut['name']>;

export interface CutLabel {
  name: CutName;
  /** |slope| (or |miter| for a pure miter), degrees to 2 dp. */
  angle_deg: number;
  /** |miter| for a compound cut, degrees to 2 dp. */
  miter_deg?: number;
}

export interface NotchDescription {
  kind: 'birdsmouth' | 'trim' | 'notch';
  /** For a birdsmouth: the seat (level) cut length inside the part, mm. */
  seat_mm?: number;
  /** For a birdsmouth: the heel (plumb) cut length inside the part, mm. */
  heel_mm?: number;
  /** Where along the part it is (local x, clipped to the part), mm. */
  x0_mm: number;
  x1_mm: number;
  /** How deep it reaches in from the face it cuts (perpendicular to the length), mm. */
  depth_mm: number;
  /** The face it cuts into. */
  face: 'bottom' | 'top' | 'other';
}

export interface CutDescription {
  ends: { start?: CutLabel; end?: CutLabel; nearEdge?: CutLabel; farEdge?: CutLabel };
  notches: NotchDescription[];
  /** True when any end is angled, so the length is the long point. */
  longPoint: boolean;
  /** e.g. "plumb 26.6° both ends · birdsmouth (seat 3 15/16″, heel 1 15/16″)". */
  label: string;
}

const dp2 = (n: number) => Math.round(n * 100) / 100;

function labelOf(cut: EndCut | undefined, edge: boolean): CutLabel | undefined {
  if (!cut) return undefined;
  const s = Math.abs(cut.slope ?? 0);
  const m = edge ? 0 : Math.abs(cut.miter ?? 0);
  if (s === 0 && m === 0) return undefined;
  const name: CutName = cut.name ?? (s === 0 ? 'miter' : 'bevel');
  const out: CutLabel = { name, angle_deg: dp2(s === 0 ? m : s) };
  if (s !== 0 && m !== 0) out.miter_deg = dp2(m);
  return out;
}

const deg1 = (n: number) => `${n.toFixed(1)}°`;
const cutText = (c: CutLabel) => `${c.name} ${deg1(c.angle_deg)}${c.miter_deg !== undefined ? ` / miter ${deg1(c.miter_deg)}` : ''}`;
const sameCut = (a: CutLabel, b: CutLabel) => a.name === b.name && a.angle_deg === b.angle_deg && a.miter_deg === b.miter_deg;

/** Inches for a short cut dimension: `3 15/16″` (no feet below a foot). */
export function shortLength(mm: number): string {
  const s = formatFeetInches(mm);
  return (s.startsWith("0' ") ? s.slice(3) : s).replace(/"$/, '″').replace(/'/, '′');
}

function segmentInRect(a: P2, b: P2, size: PartSize): number {
  // Liang–Barsky clip of a→b against [0, L] × [0, H].
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const checks: Array<[number, number]> = [
    [-dx, a.x],
    [dx, size.length - a.x],
    [-dz, a.z],
    [dz, size.height - a.z],
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return 0;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
  }
  return t1 > t0 ? (t1 - t0) * Math.hypot(dx, dz) : 0;
}

function describeNotch(n: { kind: NotchDescription['kind']; profile: P2[] }, size: PartSize): NotchDescription {
  const rect: P2[] = [
    { x: 0, z: 0 },
    { x: size.length, z: 0 },
    { x: size.length, z: size.height },
    { x: 0, z: size.height },
  ];
  const ring = ccwConvex(n.profile);
  const inside = ring ? clipConvex(rect, ring) : [];
  const xs = inside.map((p) => p.x);
  const zs = inside.map((p) => p.z);
  const zmin = Math.min(...zs);
  const zmax = Math.max(...zs);
  const face: NotchDescription['face'] = zmin <= 1e-3 ? 'bottom' : zmax >= size.height - 1e-3 ? 'top' : 'other';
  const out: NotchDescription = {
    kind: n.kind,
    x0_mm: inside.length > 0 ? Math.min(...xs) : 0,
    x1_mm: inside.length > 0 ? Math.max(...xs) : 0,
    depth_mm: inside.length === 0 ? 0 : face === 'bottom' ? zmax : face === 'top' ? size.height - zmin : zmax - zmin,
    face,
  };
  if (n.kind === 'birdsmouth') {
    const p = n.profile;
    const k = p.findIndex((q) => q.x > 1e-6 && q.x < size.length - 1e-6 && q.z > 1e-6 && q.z < size.height - 1e-6);
    if (k >= 0) {
      const prev = p[(k - 1 + p.length) % p.length]!;
      const next = p[(k + 1) % p.length]!;
      out.heel_mm = segmentInRect(prev, p[k]!, size);
      out.seat_mm = segmentInRect(p[k]!, next, size);
    }
  }
  return out;
}

/** The cut-list and `get_part` description of a part's cuts. */
export function describeCuts(part: { size: PartSize; cuts?: PartCuts | undefined }): CutDescription {
  const c = part.cuts;
  const ends: CutDescription['ends'] = {};
  const start = labelOf(c?.start, false);
  const end = labelOf(c?.end, false);
  const near = labelOf(c?.nearEdge, true);
  const far = labelOf(c?.farEdge, true);
  if (start) ends.start = start;
  if (end) ends.end = end;
  if (near) ends.nearEdge = near;
  if (far) ends.farEdge = far;
  const notches = (c?.notches ?? []).map((n) => describeNotch(n, part.size));
  const words: string[] = [];
  if (start && end && sameCut(start, end)) words.push(`${cutText(start)} both ends`);
  else {
    if (start && end) words.push(`${cutText(start)} at the start`, `${cutText(end)} at the end`);
    else if (start || end) words.push(`${cutText((start ?? end)!)} one end`);
  }
  if (near && far && sameCut(near, far)) words.push(`${cutText(near)} both edges`);
  else for (const e of [near, far]) if (e) words.push(`${cutText(e)} one edge`);
  const kinds = ['birdsmouth', 'trim', 'notch'] as const;
  for (const kind of kinds) {
    const list = notches.filter((n) => n.kind === kind);
    if (list.length === 0) continue;
    const count = list.length > 1 ? (kind === 'trim' ? ' both ends' : ` ×${list.length}`) : '';
    const noun = kind === 'trim' ? 'corner trim' : kind;
    const first = list[0]!;
    const dims =
      kind === 'birdsmouth' && first.seat_mm !== undefined && first.heel_mm !== undefined
        ? ` (seat ${shortLength(first.seat_mm)}, heel ${shortLength(first.heel_mm)})`
        : '';
    words.push(`${noun}${count}${dims}`);
  }
  return {
    ends,
    notches,
    longPoint: start !== undefined || end !== undefined || near !== undefined || far !== undefined,
    label: words.join(' · '),
  };
}

// ---------------------------------------------------------------------------------------
// Builder helpers.

/** The angle of a slope `ratio` (rise / run), degrees. */
export function pitchAngleDeg(ratio: number): number {
  return Math.atan(ratio) / RAD;
}

/**
 * Frame points (w across, v up; u ignored) as local x–z of a placed part whose local y
 * runs along the frame's u axis. Used to write notch profiles laid out in the frame.
 */
export function frameProfileToLocal(placed: PartLike, frame: PlanFrame, points: ReadonlyArray<{ v: number; w: number }>): P2[] {
  const [X, , Z] = rotationAxes(placed.rotation);
  return points.map((q) => {
    const p = toWorld(frame, { u: 0, v: q.v, w: q.w });
    // Project onto the part's x–z plane through its origin (u is along local y).
    const d = sub(p, placed.position);
    return { x: clean(dot(d, X)), z: clean(dot(d, Z)) };
  });
}

function clean(n: number): number {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}
