/**
 * Part edges as line segments (pairs of endpoints, metres): outlines for highlights, and
 * the ink edges of the blueprint and x-ray snapshot modes. A box gives its 12 edges; a part
 * with cuts gives its cut solid's feature edges (plumb ends, birdsmouth, bevels).
 */
import { hasCuts, partBox, partFeatureEdges, type Part } from '@slapdash/core';

export type V3 = [number, number, number];

/** A part's eight corners in metres, ordered by the sign of x, then y, then z (bits 4, 2, 1). */
export function partCornersM(part: Part): V3[] {
  const { center, axes, half } = partBox(part);
  const out: V3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const k = (axis: 'x' | 'y' | 'z') =>
          (center[axis] + sx * half[0] * axes[0][axis] + sy * half[1] * axes[1][axis] + sz * half[2] * axes[2][axis]) / 1000;
        out.push([k('x'), k('y'), k('z')]);
      }
    }
  }
  return out;
}

/** The 12 edges of a box as pairs of corner indices that differ in one sign. */
export const BOX_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/** Segment endpoint pairs for the edges of these parts. */
export function partEdgeSegments(parts: readonly Part[]): V3[] {
  const out: V3[] = [];
  const m = (p: { x: number; y: number; z: number }): V3 => [p.x / 1000, p.y / 1000, p.z / 1000];
  for (const part of parts) {
    if (hasCuts(part)) {
      for (const [a, b] of partFeatureEdges(part)) out.push(m(a), m(b));
      continue;
    }
    const c = partCornersM(part);
    for (const [a, b] of BOX_EDGES) out.push(c[a]!, c[b]!);
  }
  return out;
}

/** Clip one segment to y ≤ `maxY`. Returns null when it is entirely above. */
export function clipBelow(a: V3, b: V3, maxY: number): [V3, V3] | null {
  const aIn = a[1] <= maxY;
  const bIn = b[1] <= maxY;
  if (aIn && bIn) return [a, b];
  if (!aIn && !bIn) return null;
  const t = (maxY - a[1]) / (b[1] - a[1]);
  const p: V3 = [a[0] + (b[0] - a[0]) * t, maxY, a[2] + (b[2] - a[2]) * t];
  return aIn ? [a, p] : [p, b];
}
