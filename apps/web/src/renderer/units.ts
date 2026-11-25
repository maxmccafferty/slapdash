/**
 * Scene units. The model is in millimetres; the scene is in **metres**, so shadow
 * cameras, near/far planes and AO radii have sane magnitudes. Convert only at the
 * boundary (part matrices, bounds, label positions).
 */
import { MM_PER_FOOT, type Aabb, type Vec3 } from '@slapdash/core';

export const MM_PER_M = 1000;
export const FOOT_M = MM_PER_FOOT / MM_PER_M;

export function mmToM(mm: number): number {
  return mm / MM_PER_M;
}

export function vecToM(v: Vec3): Vec3 {
  return { x: v.x / MM_PER_M, y: v.y / MM_PER_M, z: v.z / MM_PER_M };
}

export function aabbToM(box: Aabb): Aabb {
  return { min: vecToM(box.min), max: vecToM(box.max) };
}

/** `16' 6"` → `16′ 6″`: the shell prints primes, core prints ASCII marks. */
export function toPrimes(text: string): string {
  return text.replace(/'/g, '′').replace(/"/g, '″');
}
