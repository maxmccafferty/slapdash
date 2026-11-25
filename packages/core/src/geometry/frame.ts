/**
 * Builder-local coordinates. A {@link PlanFrame} is a right-angled frame standing on
 * the plan: `u` runs along a wall (or ridge, or fence), `v` is up, and `w` runs
 * across. Builders lay members out as boxes in (u, v, w); this module is the single
 * place where those become a Part's position / rotation / size.
 */
import { boxCorners, cross, dot, eulerFromAxes, partBox, type PartLike } from './obb.ts';
import type { Vec3 } from './vec3.ts';

export interface PlanFrame {
  /** World point at u = v = w = 0. */
  origin: Vec3;
  /** Plan angle of +u, degrees from +x towards +z. */
  angleDeg: number;
  /** +1: w = (−sin, 0, cos) of the angle (to the right of +u in a north-up plan); −1: the other way. */
  wSign: 1 | -1;
}

export interface FrameVec {
  u: number;
  v: number;
  w: number;
}

export interface FrameBox {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  w0: number;
  w1: number;
}

export type FrameAxis = 'u' | 'v' | 'w';

export interface Placed {
  position: Vec3;
  rotation: Vec3;
  size: { length: number; width: number; height: number };
}

const RAD = Math.PI / 180;

/** Round to 1e-6 (and turn -0 into 0) so positions stay clean and deterministic. */
export function clean(n: number, step = 1e-6): number {
  const r = Math.round(n / step) * step;
  const fixed = Number(r.toFixed(9));
  return Object.is(fixed, -0) ? 0 : fixed;
}

const cleanVec = (p: Vec3, step?: number): Vec3 => ({ x: clean(p.x, step), y: clean(p.y, step), z: clean(p.z, step) });

export function frameAxes(f: PlanFrame): { u: Vec3; v: Vec3; w: Vec3 } {
  const c = Math.cos(f.angleDeg * RAD);
  const s = Math.sin(f.angleDeg * RAD);
  return { u: { x: c, y: 0, z: s }, v: { x: 0, y: 1, z: 0 }, w: { x: -s * f.wSign, y: 0, z: c * f.wSign } };
}

export function dirToWorld(f: PlanFrame, d: FrameVec): Vec3 {
  const a = frameAxes(f);
  return {
    x: a.u.x * d.u + a.v.x * d.v + a.w.x * d.w,
    y: a.u.y * d.u + a.v.y * d.v + a.w.y * d.w,
    z: a.u.z * d.u + a.v.z * d.v + a.w.z * d.w,
  };
}

export function toWorld(f: PlanFrame, p: FrameVec): Vec3 {
  const d = dirToWorld(f, p);
  return { x: f.origin.x + d.x, y: f.origin.y + d.y, z: f.origin.z + d.z };
}

export function toFrame(f: PlanFrame, p: Vec3): FrameVec {
  const a = frameAxes(f);
  const r = { x: p.x - f.origin.x, y: p.y - f.origin.y, z: p.z - f.origin.z };
  return { u: dot(r, a.u), v: dot(r, a.v), w: dot(r, a.w) };
}

/**
 * Place a box with its corner at `origin`, running `size.length` along `x`,
 * `size.width` along `y` and `size.height` towards `z` (frame directions, unit
 * length, at right angles). If (x, y, z) is left-handed the width side is mirrored
 * so the box still covers the same region.
 */
export function placeOriented(
  f: PlanFrame,
  origin: FrameVec,
  dirs: { x: FrameVec; y: FrameVec; z: FrameVec },
  size: { length: number; width: number; height: number },
): Placed {
  const X = dirToWorld(f, dirs.x);
  let Y = dirToWorld(f, dirs.y);
  const Zwant = dirToWorld(f, dirs.z);
  let corner = toWorld(f, origin);
  let Z = cross(X, Y);
  if (dot(Z, Zwant) < 0) {
    corner = { x: corner.x + Y.x * size.width, y: corner.y + Y.y * size.width, z: corner.z + Y.z * size.width };
    Y = { x: -Y.x, y: -Y.y, z: -Y.z };
    Z = cross(X, Y);
  }
  const rot = eulerFromAxes([X, Y, Z]);
  return {
    position: cleanVec(corner),
    rotation: cleanVec(rot, 1e-9),
    size: { length: clean(size.length), width: clean(size.width), height: clean(size.height) },
  };
}

const UNIT: Record<FrameAxis, FrameVec> = {
  u: { u: 1, v: 0, w: 0 },
  v: { u: 0, v: 1, w: 0 },
  w: { u: 0, v: 0, w: 1 },
};

/**
 * Place a frame-aligned member: the box `b`, with the part's length along
 * `lengthAxis` and its width (for a sectioned member, the thin section dimension)
 * along `widthAxis`.
 */
export function placeMember(f: PlanFrame, b: FrameBox, lengthAxis: FrameAxis, widthAxis: FrameAxis): Placed {
  if (lengthAxis === widthAxis) throw new Error('lengthAxis and widthAxis must differ');
  const heightAxis = (['u', 'v', 'w'] as const).find((a) => a !== lengthAxis && a !== widthAxis)!;
  const extent: Record<FrameAxis, number> = { u: b.u1 - b.u0, v: b.v1 - b.v0, w: b.w1 - b.w0 };
  return placeOriented(
    f,
    { u: b.u0, v: b.v0, w: b.w0 },
    { x: UNIT[lengthAxis], y: UNIT[widthAxis], z: UNIT[heightAxis] },
    { length: extent[lengthAxis], width: extent[widthAxis], height: extent[heightAxis] },
  );
}

/** A part's bounding box in frame coordinates (exact for frame-aligned parts). */
export function boxInFrame(f: PlanFrame, part: PartLike): FrameBox {
  const pts = boxCorners(partBox(part)).map((p) => toFrame(f, p));
  const r = (n: number) => clean(n, 1e-4);
  return {
    u0: r(Math.min(...pts.map((p) => p.u))),
    u1: r(Math.max(...pts.map((p) => p.u))),
    v0: r(Math.min(...pts.map((p) => p.v))),
    v1: r(Math.max(...pts.map((p) => p.v))),
    w0: r(Math.min(...pts.map((p) => p.w))),
    w1: r(Math.max(...pts.map((p) => p.w))),
  };
}

/** The identity frame: u = +x, v = +y, w = +z. */
export const WORLD_FRAME: PlanFrame = { origin: { x: 0, y: 0, z: 0 }, angleDeg: 0, wSign: 1 };
