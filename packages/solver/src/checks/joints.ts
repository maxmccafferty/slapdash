/**
 * Joint checks. The link force at a joint is resolved, on the joint's first part
 * (`partIds[0]`, the supported one), into:
 *
 * - withdrawal: pulling the two parts apart along the contact normal;
 * - shear: the in-plane remainder;
 * - uplift: the joint holding the first part down (a force on it towards −y).
 *
 * Capacity is the catalog value, overridden field by field by `capacityOverride`, times
 * the fastener count for `per-fastener` values. NDS-based fasteners (nails, screws,
 * bolts) scale with the combination's CD. Uplift values come from Simpson tables
 * published at 160% load duration, so they scale by CD / 1.6. A capacity the catalog
 * doesn't give isn't checked.
 */
import type { Joint, JointType } from '@slapdash/core';
import type { V3 } from '../fem/element.ts';
import { dot, length, scale, sub } from '../model/geometry.ts';
import type { JointForces } from '../types.ts';

const NDS_CATEGORIES = new Set(['nailed', 'screwed', 'bolted']);
/** Uplift capacities in the catalog are published at this load duration. */
export const UPLIFT_PUBLISHED_CD = 1.6;

/** Joint capacity in a combination, N. */
export function jointCapacity(joint: Joint, type: JointType, CD: number): Partial<JointForces> {
  const base = { ...type.capacity, ...joint.capacityOverride };
  const count = type.capacity.basis === 'per-fastener' ? joint.fastenerCount : 1;
  const duration = NDS_CATEGORIES.has(type.category) ? CD : 1;
  const out: Partial<JointForces> = { shear: base.shear_N * count * duration };
  if (base.withdrawal_N !== undefined) out.withdrawal = base.withdrawal_N * count * duration;
  if (base.uplift_N !== undefined) out.uplift = (base.uplift_N * count * CD) / UPLIFT_PUBLISHED_CD;
  return out;
}

/** Resolve the force on the first part (world axes, N) against the contact normal (first → second). */
export function resolveJointForce(F: V3, normal: V3): JointForces {
  const Fn = dot(F, normal);
  return {
    withdrawal: Math.max(0, Fn),
    shear: length(sub(F, scale(normal, Fn))),
    uplift: Math.max(0, -F[1]),
  };
}

export interface JointCheck {
  utilization: number;
  check: 'joint-shear' | 'joint-withdrawal' | 'joint-uplift';
}

export function checkJoint(forces: JointForces, cap: Partial<JointForces>): JointCheck {
  let best: JointCheck = { utilization: 0, check: 'joint-shear' };
  const consider = (demand: number, capacity: number | undefined, check: JointCheck['check']) => {
    if (capacity === undefined) return;
    const u = capacity > 0 ? demand / capacity : demand > 0 ? 1e3 : 0;
    if (u > best.utilization) best = { utilization: Math.min(u, 1e3), check };
  };
  consider(forces.shear, cap.shear, 'joint-shear');
  consider(forces.withdrawal, cap.withdrawal, 'joint-withdrawal');
  consider(forces.uplift, cap.uplift, 'joint-uplift');
  return best;
}
