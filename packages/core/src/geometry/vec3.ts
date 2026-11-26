/**
 * Project space is y-up, in millimetres, with the origin at the project's fixed
 * ground corner (by convention the south-west corner: +x east, +z south), so a
 * top view reads like a plan.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Rotation in degrees, applied intrinsically in X, then Y, then Z order. */
export interface Rotation {
  x: number;
  y: number;
  z: number;
}

export const ORIGIN: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
export const NO_ROTATION: Rotation = Object.freeze({ x: 0, y: 0, z: 0 });

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function eq(a: Vec3, b: Vec3, epsilon = 1e-9): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon && Math.abs(a.z - b.z) <= epsilon
  );
}
