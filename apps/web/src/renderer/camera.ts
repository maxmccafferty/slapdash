/**
 * Camera framing, pure (no Three.js objects), in scene metres.
 *
 * Directions point from the target toward the camera. The model is y-up with north at −z,
 * so "front" looks from the south (+z) and the default iso view looks from the south-east,
 * above, which puts the floor's front corner (and the compass) nearest the viewer.
 */
import type { Aabb, Vec3 } from '@slapdash/core';

export type PresetAngle = 'top' | 'front' | 'back' | 'left' | 'right' | 'iso';

const normalize = (v: Vec3): Vec3 => {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
};
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });

export function presetDirection(angle: PresetAngle): Vec3 {
  switch (angle) {
    case 'top':
      return { x: 0, y: 1, z: 0 };
    case 'front':
      return { x: 0, y: 0, z: 1 };
    case 'back':
      return { x: 0, y: 0, z: -1 };
    case 'left':
      return { x: -1, y: 0, z: 0 };
    case 'right':
      return { x: 1, y: 0, z: 0 };
    case 'iso':
      return normalize({ x: 1, y: 0.85, z: 1.25 });
  }
}

/** Camera up for a direction: north (−z) is up in the top view, y elsewhere. */
export function upFor(dir: Vec3): Vec3 {
  return Math.abs(dir.y) > 0.999 ? { x: 0, y: 0, z: -1 } : { x: 0, y: 1, z: 0 };
}

export function aabbCenter(box: Aabb): Vec3 {
  return mul(add(box.min, box.max), 0.5);
}

export function aabbCorners(box: Aabb): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push({ x, y, z });
  return out;
}

export interface PerspectiveFit {
  target: Vec3;
  position: Vec3;
  distance: number;
}

/**
 * Fit a box in a perspective frustum: the bounding sphere must fit the narrower of the
 * vertical and horizontal fields of view. Conservative, so every corner is in view.
 */
export function fitBounds(box: Aabb, dir: Vec3, fovDeg: number, aspect: number, padding = 1.05): PerspectiveFit {
  const target = aabbCenter(box);
  const radius = Math.max(Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) / 2, 0.01) * padding;
  const vHalf = (fovDeg * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const distance = radius / Math.sin(Math.min(vHalf, hHalf));
  const d = normalize(dir);
  return { target, position: add(target, mul(d, distance)), distance };
}

export interface OrthoFrame {
  target: Vec3;
  position: Vec3;
  up: Vec3;
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
}

interface Extents {
  target: Vec3;
  dir: Vec3;
  right: Vec3;
  up: Vec3;
  halfW: number;
  halfH: number;
  depth: number;
}

/** Half-extents of the box on the view plane, and its half-depth along the view direction. */
function extents(box: Aabb, dir: Vec3): Extents {
  const d = normalize(dir);
  const right = normalize(cross(upFor(d), d));
  const up = cross(d, right);
  const target = aabbCenter(box);
  let halfW = 0;
  let halfH = 0;
  let depth = 0;
  for (const c of aabbCorners(box)) {
    const v = sub(c, target);
    halfW = Math.max(halfW, Math.abs(dot(v, right)));
    halfH = Math.max(halfH, Math.abs(dot(v, up)));
    depth = Math.max(depth, Math.abs(dot(v, d)));
  }
  return { target, dir: d, right, up, halfW, halfH, depth };
}

/**
 * An orthographic frame that fits the box seen from `dir`, with `padding` (fraction of the
 * larger side) on every edge, widened to the requested aspect (width / height).
 */
export function orthoFrame(box: Aabb, dir: Vec3, aspect: number, padding = 0.05): OrthoFrame {
  const e = extents(box, dir);
  const pad = Math.max(e.halfW, e.halfH, 0.01) * padding;
  let halfW = Math.max(e.halfW, 0.01) + pad;
  let halfH = Math.max(e.halfH, 0.01) + pad;
  if (halfW / halfH < aspect) halfW = halfH * aspect;
  else halfH = halfW / aspect;
  const distance = e.depth + Math.max(halfW, halfH) + 1;
  return {
    target: e.target,
    position: add(e.target, mul(e.dir, distance)),
    up: e.up,
    left: -halfW,
    right: halfW,
    top: halfH,
    bottom: -halfH,
    near: 0.01,
    far: distance + e.depth + 50,
  };
}

/** Width / height of the box as seen from `dir`, clamped to 3:4 … 4:3. */
export function viewAspect(box: Aabb, dir: Vec3): number {
  const e = extents(box, dir);
  const raw = e.halfH > 0 ? e.halfW / e.halfH : 1;
  return Math.min(4 / 3, Math.max(3 / 4, raw));
}

/** The readout: 100% at the fitted distance, more when closer. */
export function zoomPercent(distance: number, fitDistance: number): number {
  if (!(distance > 0) || !(fitDistance > 0)) return 100;
  return Math.round((100 * fitDistance) / distance);
}

/** Orbit limits from the framed size: close enough for a stud, far enough for the site. */
export function distanceLimits(fitDistance: number): { min: number; max: number } {
  return { min: Math.max(0.3, fitDistance * 0.05), max: Math.max(fitDistance * 6, 20) };
}
