/**
 * Geometry for the analytical model: member centrelines from the parts' oriented boxes,
 * projections onto them, overlap intervals and panel corners. Vectors are tuples in mm.
 */
import { boxCorners, partBox, rotationAxes, type Part } from '@slapdash/core';
import type { Axes, V3 } from '../fem/element.ts';

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => {
  const l = length(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
export const fromVec = (v: { x: number; y: number; z: number }): V3 => [v.x, v.y, v.z];
export const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function partAxes(part: Pick<Part, 'rotation'>): Axes {
  const [x, y, z] = rotationAxes(part.rotation);
  return [fromVec(x), fromVec(y), fromVec(z)];
}

export interface Centreline {
  start: V3;
  axes: Axes;
  length: number;
}

/** The line through the section centroid: start = position + R·(0, w/2, h/2), along local x. */
export function centreline(part: Part): Centreline {
  const axes = partAxes(part);
  const start = add(add(fromVec(part.position), scale(axes[1], part.size.width / 2)), scale(axes[2], part.size.height / 2));
  return { start, axes, length: part.size.length };
}

export function pointAt(c: Centreline, t: number): V3 {
  return add(c.start, scale(c.axes[0], t));
}

/** Parameter of the closest point on the centreline (clamped to the part) and the distance to it. */
export function project(c: Centreline, p: V3): { t: number; distance: number } {
  const t = Math.max(0, Math.min(c.length, dot(sub(p, c.start), c.axes[0])));
  return { t, distance: length(sub(p, pointAt(c, t))) };
}

export function corners(part: Part): V3[] {
  return boxCorners(partBox(part)).map(fromVec);
}

export function centre(part: Part): V3 {
  return fromVec(partBox(part).center);
}

/** The interval of the centreline that another part's box covers, clamped to the part. */
export function overlapInterval(c: Centreline, other: Part): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of corners(other)) {
    const t = dot(sub(p, c.start), c.axes[0]);
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return [Math.max(0, lo), Math.min(c.length, hi)];
}

/** Closest point of a part's box to p. */
export function closestOnBox(part: Part, p: V3): V3 {
  const box = partBox(part);
  const c = fromVec(box.center);
  const d = sub(p, c);
  let q = c;
  box.axes.forEach((ax, i) => {
    const a = fromVec(ax);
    const h = box.half[i]!;
    const s = Math.max(-h, Math.min(h, dot(d, a)));
    q = add(q, scale(a, s));
  });
  return q;
}

/**
 * A sheet's four corners on its mid-plane, in order (0,0), (L,0), (L,W), (0,W) of its
 * local x (length) and y (width).
 */
export function sheetCorners(part: Part): [V3, V3, V3, V3] {
  const [x, y, z] = partAxes(part);
  const o = add(fromVec(part.position), scale(z, part.size.height / 2));
  const L = part.size.length;
  const W = part.size.width;
  return [o, add(o, scale(x, L)), add(add(o, scale(x, L)), scale(y, W)), add(o, scale(y, W))];
}

/** The sheet's unit normal (its local z), turned to point up (or +x/+z for a vertical sheet). */
export function sheetNormal(part: Part): V3 {
  const n = partAxes(part)[2];
  if (Math.abs(n[1]) > 1e-6) return n[1] > 0 ? n : scale(n, -1);
  return n;
}
