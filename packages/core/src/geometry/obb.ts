/**
 * Oriented boxes for parts, and a separating-axis overlap test (used for clash
 * detection). A part is a box: its `position` is the corner at local (0,0,0), it runs
 * `size.length` along local x, `size.width` along local y and `size.height` along
 * local z, and `rotation` is degrees applied intrinsically X, then Y, then Z (the same
 * convention as Three.js Euler order "XYZ", so the renderer agrees).
 *
 * A part with `cuts` is still bounded by this box: cuts only remove material, so the box
 * stays a valid, conservative bound for prefilters. `cuts.ts` gives the exact shape.
 */
import type { Vec3 } from './vec3.ts';

export type Mat3 = readonly [Vec3, Vec3, Vec3];

const RAD = Math.PI / 180;

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function scale(a: Vec3, k: number): Vec3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}

export function norm(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

/**
 * The rotation as three columns: where local x, y and z point in the world.
 * R = Rx(x) · Ry(y) · Rz(z).
 */
export function rotationAxes(rotation: Vec3): Mat3 {
  const a = Math.cos(rotation.x * RAD);
  const b = Math.sin(rotation.x * RAD);
  const c = Math.cos(rotation.y * RAD);
  const d = Math.sin(rotation.y * RAD);
  const e = Math.cos(rotation.z * RAD);
  const f = Math.sin(rotation.z * RAD);
  // Row-major entries m[row][col].
  const m11 = c * e;
  const m12 = -c * f;
  const m13 = d;
  const m21 = a * f + b * e * d;
  const m22 = a * e - b * f * d;
  const m23 = -b * c;
  const m31 = b * f - a * e * d;
  const m32 = b * e + a * f * d;
  const m33 = a * c;
  return [
    { x: m11, y: m21, z: m31 },
    { x: m12, y: m22, z: m32 },
    { x: m13, y: m23, z: m33 },
  ];
}

/** Inverse of {@link rotationAxes} for a right-handed orthonormal basis: Euler degrees, XYZ order. */
export function eulerFromAxes(axes: Mat3): Vec3 {
  const [X, Y, Z] = axes;
  const m11 = X.x;
  const m12 = Y.x;
  const m13 = Math.max(-1, Math.min(1, Z.x));
  const m22 = Y.y;
  const m23 = Z.y;
  const m32 = Y.z;
  const m33 = Z.z;
  const y = Math.asin(m13);
  let x: number;
  let z: number;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m23, m33);
    z = Math.atan2(-m12, m11);
  } else {
    x = Math.atan2(m32, m22);
    z = 0;
  }
  return { x: x / RAD, y: y / RAD, z: z / RAD };
}

export interface OrientedBox {
  /** Centre of the box. */
  center: Vec3;
  /** Unit axes (local x, y, z in world). */
  axes: Mat3;
  /** Half the size along each axis. */
  half: readonly [number, number, number];
}

export interface PartLike {
  position: Vec3;
  rotation: Vec3;
  size: { length: number; width: number; height: number };
}

export function partBox(part: PartLike): OrientedBox {
  const axes = rotationAxes(part.rotation);
  const half = [part.size.length / 2, part.size.width / 2, part.size.height / 2] as const;
  const center = {
    x: part.position.x + axes[0].x * half[0] + axes[1].x * half[1] + axes[2].x * half[2],
    y: part.position.y + axes[0].y * half[0] + axes[1].y * half[1] + axes[2].y * half[2],
    z: part.position.z + axes[0].z * half[0] + axes[1].z * half[1] + axes[2].z * half[2],
  };
  return { center, axes, half };
}

/** The eight corners of a box. */
export function boxCorners(box: OrientedBox): Vec3[] {
  const out: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const [a, b, c] = box.axes;
        const [h0, h1, h2] = box.half;
        out.push({
          x: box.center.x + sx * h0 * a.x + sy * h1 * b.x + sz * h2 * c.x,
          y: box.center.y + sx * h0 * a.y + sy * h1 * b.y + sz * h2 * c.y,
          z: box.center.z + sx * h0 * a.z + sy * h1 * b.z + sz * h2 * c.z,
        });
      }
    }
  }
  return out;
}

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export function aabbOf(box: OrientedBox): Aabb {
  const ext = (k: 'x' | 'y' | 'z') =>
    Math.abs(box.axes[0][k]) * box.half[0] + Math.abs(box.axes[1][k]) * box.half[1] + Math.abs(box.axes[2][k]) * box.half[2];
  const e = { x: ext('x'), y: ext('y'), z: ext('z') };
  return {
    min: { x: box.center.x - e.x, y: box.center.y - e.y, z: box.center.z - e.z },
    max: { x: box.center.x + e.x, y: box.center.y + e.y, z: box.center.z + e.z },
  };
}

/** True when two axis-aligned boxes overlap by more than `tol` on every axis. */
export function aabbsOverlap(a: Aabb, b: Aabb, tol = 0): boolean {
  return (
    a.min.x < b.max.x - tol &&
    b.min.x < a.max.x - tol &&
    a.min.y < b.max.y - tol &&
    b.min.y < a.max.y - tol &&
    a.min.z < b.max.z - tol &&
    b.min.z < a.max.z - tol
  );
}

/**
 * Separating-axis test on the 15 candidate axes. Boxes clash only when they
 * interpenetrate by more than `tolMm` along every axis, so faces that touch (a stud
 * standing on a plate) are fine.
 */
export function boxesOverlap(a: OrientedBox, b: OrientedBox, tolMm = 1): boolean {
  const t = { x: b.center.x - a.center.x, y: b.center.y - a.center.y, z: b.center.z - a.center.z };
  const axes: Vec3[] = [...a.axes, ...b.axes];
  for (const ai of a.axes) {
    for (const bj of b.axes) {
      const c = cross(ai, bj);
      const n = norm(c);
      if (n > 1e-6) axes.push(scale(c, 1 / n));
    }
  }
  for (const l of axes) {
    const ra = a.half[0] * Math.abs(dot(a.axes[0], l)) + a.half[1] * Math.abs(dot(a.axes[1], l)) + a.half[2] * Math.abs(dot(a.axes[2], l));
    const rb = b.half[0] * Math.abs(dot(b.axes[0], l)) + b.half[1] * Math.abs(dot(b.axes[1], l)) + b.half[2] * Math.abs(dot(b.axes[2], l));
    if (Math.abs(dot(t, l)) >= ra + rb - tolMm) return false;
  }
  return true;
}
