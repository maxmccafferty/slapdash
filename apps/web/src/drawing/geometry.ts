/** Pure 2D helpers for the sheet: hulls, projections, sections and bounds. */
import { boxCorners, hasCuts, partBox, partFeatureEdges, partSolidCorners, type Part, type Vec3 } from '@slapdash/core';
import type { P2, ViewDef } from './views.ts';

export { depthAlong } from './views.ts';

export interface Box2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const cross = (o: P2, a: P2, b: P2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Snap to 0.001 mm, so rotation noise (1e-13) can't reorder the sort or fake a corner. */
const snap = (v: number) => Math.round(v * 1000) / 1000 || 0;

/** Convex hull (monotone chain), without collinear points. Fewer than 3 distinct points come back as they are. */
export function convexHull(points: readonly P2[]): P2[] {
  const pts = points.map((p) => ({ x: snap(p.x), y: snap(p.y) })).sort((a, b) => a.x - b.x || a.y - b.y);
  const unique = pts.filter((p, i) => i === 0 || p.x !== pts[i - 1]!.x || p.y !== pts[i - 1]!.y);
  if (unique.length < 3) return unique;
  const lower: P2[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 1e-9) lower.pop();
    lower.push(p);
  }
  const upper: P2[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 1e-9) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function projectPoint(view: ViewDef, v: Vec3): P2 {
  return view.project(v);
}

/** The part's vertices: its 8 box corners, or every vertex of its cut solid (plumb ends, seats, bevels). */
export function partCorners(part: Part): Vec3[] {
  return hasCuts(part) ? partSolidCorners(part) : boxCorners(partBox(part));
}

/** The 2D convex hull of the parts' vertices in this view. */
export function projectedHull(view: ViewDef, parts: readonly Part[]): P2[] {
  return convexHull(parts.flatMap((p) => partCorners(p).map(view.project)));
}

/** Box edges as corner index pairs (corners in `boxCorners` order: sx, sy, sz bits 4, 2, 1). */
const EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/** The part's section with the plane y = `y`, in plan (x, z) as sheet points, or null when the plane misses it. */
export function sectionAtY(part: Part, y: number): P2[] | null {
  const pts: P2[] = [];
  let segments: Array<readonly [Vec3, Vec3]>;
  if (hasCuts(part)) segments = partFeatureEdges(part);
  else {
    const c = boxCorners(partBox(part));
    segments = EDGES.map(([i, j]) => [c[i]!, c[j]!] as const);
  }
  for (const [a, b] of segments) {
    const da = a.y - y;
    const db = b.y - y;
    if (da * db < 0) {
      const t = da / (da - db);
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.z + (b.z - a.z) * t });
    } else if (da === 0 && db === 0) {
      pts.push({ x: a.x, y: a.z }, { x: b.x, y: b.z });
    }
  }
  const hull = convexHull(pts);
  return hull.length >= 3 ? hull : null;
}

export function bounds2d(points: Iterable<P2>): Box2 | null {
  let out: Box2 | null = null;
  for (const p of points) {
    if (!out) out = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    else {
      out.minX = Math.min(out.minX, p.x);
      out.minY = Math.min(out.minY, p.y);
      out.maxX = Math.max(out.maxX, p.x);
      out.maxY = Math.max(out.maxY, p.y);
    }
  }
  return out;
}

export function unionBox(a: Box2 | null, b: Box2 | null): Box2 | null {
  if (!a) return b && { ...b };
  if (!b) return { ...a };
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

export function translateBox(b: Box2, d: P2): Box2 {
  return { minX: b.minX + d.x, minY: b.minY + d.y, maxX: b.maxX + d.x, maxY: b.maxY + d.y };
}

/** Clip a convex polygon to the half-plane sheet y ≤ `maxY` (Sutherland–Hodgman). */
export function clipBelow(poly: readonly P2[], maxY: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ain = a.y <= maxY;
    const bin = b.y <= maxY;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (maxY - a.y) / (b.y - a.y);
      out.push({ x: a.x + (b.x - a.x) * t, y: maxY });
    }
  }
  return out;
}

/** The top of a convex polygon at sheet x (smallest y), or null outside it. */
export function topAt(poly: readonly P2[], x: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if ((a.x - x) * (b.x - x) > 0 || a.x === b.x) {
      if (a.x === x) best = best === null ? a.y : Math.min(best, a.y);
      continue;
    }
    const t = (x - a.x) / (b.x - a.x);
    const y = a.y + (b.y - a.y) * t;
    best = best === null ? y : Math.min(best, y);
  }
  return best;
}
