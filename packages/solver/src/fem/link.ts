/**
 * The connection (link) element: a joint between two members, or between a member and
 * the ground.
 *
 * Each member reaches the joint point C (the joint's `at`) through a rigid arm r from
 * its node (the joint's projection onto its centreline). The point C of each side is
 * tied together by a stiff penalty spring `kt`: d = (uA + θA × rA) − (uB + θB × rB).
 * Rotations are tied by `kr`: the same order of stiffness for a fixed joint, a tiny
 * stabilising spring for a pinned one (so a pinned link is a true hinge at C).
 *
 * The arms make the link exact under rigid-body motion. Without them a link between two
 * offset centrelines would resist any relative rotation and act fixed. The spring's
 * stretch gives the joint force directly, which the capacity check needs.
 */
import type { V3 } from './element.ts';

export interface LinkStiffness {
  /** Translational spring, N/mm. */
  kt: number;
  /** Rotational spring, N·mm/rad. */
  kr: number;
  /** Arm from node A to the joint point, mm. */
  rA?: V3;
  /** Arm from node B to the joint point, mm (ignored for a support). */
  rB?: V3;
  /**
   * A unit direction the translational spring leaves free (sliding along a lap). Laps
   * hold parallel members together across their length but pass slip only at the
   * joint's own point, so built-up members aren't glued into one composite section.
   */
  release?: V3;
}

/** The translational spring as a 3×3 matrix: kt·(I − a·aᵀ) with a released direction. */
function springMatrix(k: LinkStiffness): number[][] {
  const a = k.release ?? [0, 0, 0];
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => k.kt * ((i === j ? 1 : 0) - a[i]! * a[j]!)));
}

/** Rows of [I | S(r)]: the motion of the point at arm r from a node, θ × r = S(r)·θ. */
function armRows(r: V3 | undefined): number[][] {
  const [x, y, z] = r ?? [0, 0, 0];
  return [
    [1, 0, 0, 0, z, -y],
    [0, 1, 0, -z, 0, x],
    [0, 0, 1, y, -x, 0],
  ];
}

/**
 * The link's stiffness: 12×12 (row-major) for two nodes, 6×6 for a support (B is the
 * fixed ground at the joint point).
 */
export function linkStiffness(k: LinkStiffness, support: boolean): Float64Array {
  const m = support ? 6 : 12;
  const B: number[][] = armRows(k.rA).map((row, i) => (support ? row : [...row, ...armRows(k.rB)[i]!.map((v) => -v)]));
  const R: number[][] = [0, 1, 2].map((i) => {
    const row = new Array<number>(m).fill(0);
    row[3 + i] = 1;
    if (!support) row[9 + i] = -1;
    return row;
  });
  const S = springMatrix(k);
  const K = new Float64Array(m * m);
  for (let a = 0; a < m; a++) {
    for (let b = 0; b < m; b++) {
      let s = 0;
      for (let i = 0; i < 3; i++) {
        s += k.kr * R[i]![a]! * R[i]![b]!;
        for (let j = 0; j < 3; j++) s += S[i]![j]! * B[i]![a]! * B[j]![b]!;
      }
      K[a * m + b] = s;
    }
  }
  return K;
}

/**
 * Force at the joint point and moment the link exerts on side A (world axes), from the
 * six displacements of each end. For a support, pass `uB` as zeros.
 */
export function linkForceOnA(k: LinkStiffness, uA: ArrayLike<number>, uB: ArrayLike<number>, out = new Float64Array(6)): Float64Array {
  const a = armRows(k.rA);
  const b = armRows(k.rB);
  const S = springMatrix(k);
  const d = [0, 0, 0];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) d[i] = d[i]! + a[i]![j]! * uA[j]! - b[i]![j]! * uB[j]!;
  for (let i = 0; i < 3; i++) {
    out[i] = -(S[i]![0]! * d[0]! + S[i]![1]! * d[1]! + S[i]![2]! * d[2]!);
    out[3 + i] = k.kr * (uB[3 + i]! - uA[3 + i]!);
  }
  return out;
}
