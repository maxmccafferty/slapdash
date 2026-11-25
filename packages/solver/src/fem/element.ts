/**
 * The 3D Euler–Bernoulli frame element (12 DOFs: u, v, w, θx, θy, θz at each end) and
 * its axial-only truss variant.
 *
 * Local axes come straight from the part: x along the member, y across its width, z
 * across its depth. So bending about local y (deflection along z) uses `Iy = b·h³/12`
 * and is the strong axis for a joist on edge. There is no "reference vector" convention,
 * so vertical members need no special case.
 *
 * Units throughout the solver: mm, N, MPa (N/mm²), N·mm.
 */

export type V3 = readonly [number, number, number];
/** Local x, y and z of an element, as unit vectors in world coordinates. */
export type Axes = readonly [V3, V3, V3];

export interface SectionProps {
  /** Modulus of elasticity, MPa. */
  E: number;
  /** Shear modulus, MPa. */
  G: number;
  /** Area, mm². */
  A: number;
  /** Second moment about local y (bending in the x–z plane), mm⁴. */
  Iy: number;
  /** Second moment about local z (bending in the x–y plane), mm⁴. */
  Iz: number;
  /** Torsion constant, mm⁴. */
  J: number;
}

/** 12×12 local stiffness, row-major. A truss keeps only the axial terms. */
export function localStiffness(p: SectionProps, L: number, truss = false): Float64Array {
  const k = new Float64Array(144);
  const set = (i: number, j: number, v: number) => {
    k[i * 12 + j] = v;
    k[j * 12 + i] = v;
  };
  const ea = (p.E * p.A) / L;
  set(0, 0, ea);
  set(6, 6, ea);
  set(0, 6, -ea);
  if (truss) return k;

  const gj = (p.G * p.J) / L;
  set(3, 3, gj);
  set(9, 9, gj);
  set(3, 9, -gj);

  // Bending in the x–y plane: v and θz, with Iz.
  const z12 = (12 * p.E * p.Iz) / L ** 3;
  const z6 = (6 * p.E * p.Iz) / L ** 2;
  const z4 = (4 * p.E * p.Iz) / L;
  const z2 = (2 * p.E * p.Iz) / L;
  set(1, 1, z12);
  set(1, 5, z6);
  set(1, 7, -z12);
  set(1, 11, z6);
  set(5, 5, z4);
  set(5, 7, -z6);
  set(5, 11, z2);
  set(7, 7, z12);
  set(7, 11, -z6);
  set(11, 11, z4);

  // Bending in the x–z plane: w and θy, with Iy. θy = −dw/dx, hence the signs.
  const y12 = (12 * p.E * p.Iy) / L ** 3;
  const y6 = (6 * p.E * p.Iy) / L ** 2;
  const y4 = (4 * p.E * p.Iy) / L;
  const y2 = (2 * p.E * p.Iy) / L;
  set(2, 2, y12);
  set(2, 4, -y6);
  set(2, 8, -y12);
  set(2, 10, -y6);
  set(4, 4, y4);
  set(4, 8, y6);
  set(4, 10, y2);
  set(8, 8, y12);
  set(8, 10, y6);
  set(10, 10, y4);
  return k;
}

/** Global stiffness Tᵀ·k·T, where T is block-diagonal with the rows of `axes`. */
export function toGlobal(kLocal: Float64Array, axes: Axes): Float64Array {
  const out = new Float64Array(144);
  const tmp = new Float64Array(9);
  for (let I = 0; I < 4; I++) {
    for (let J = 0; J < 4; J++) {
      // tmp = k_IJ · Λ
      for (let a = 0; a < 3; a++) {
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let b = 0; b < 3; b++) s += kLocal[(I * 3 + a) * 12 + J * 3 + b]! * axes[b]![c]!;
          tmp[a * 3 + c] = s;
        }
      }
      // out_IJ = Λᵀ · tmp
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let a = 0; a < 3; a++) s += axes[a]![r]! * tmp[a * 3 + c]!;
          out[(I * 3 + r) * 12 + J * 3 + c] = s;
        }
      }
    }
  }
  return out;
}

/** Local = Λ · global, for a 12-vector. */
export function vecToLocal(g: ArrayLike<number>, axes: Axes, out = new Float64Array(12)): Float64Array {
  for (let blk = 0; blk < 4; blk++) {
    const o = blk * 3;
    for (let a = 0; a < 3; a++) out[o + a] = axes[a]![0] * g[o]! + axes[a]![1] * g[o + 1]! + axes[a]![2] * g[o + 2]!;
  }
  return out;
}

/** Global = Λᵀ · local, for a 12-vector. */
export function vecToGlobal(l: ArrayLike<number>, axes: Axes, out = new Float64Array(12)): Float64Array {
  for (let blk = 0; blk < 4; blk++) {
    const o = blk * 3;
    for (let c = 0; c < 3; c++) out[o + c] = axes[0][c]! * l[o]! + axes[1][c]! * l[o + 1]! + axes[2][c]! * l[o + 2]!;
  }
  return out;
}

export function matVec12(k: Float64Array, u: ArrayLike<number>, out = new Float64Array(12)): Float64Array {
  for (let i = 0; i < 12; i++) {
    let s = 0;
    for (let j = 0; j < 12; j++) s += k[i * 12 + j]! * u[j]!;
    out[i] = s;
  }
  return out;
}

/** A uniform load over part of an element: `q` in local axes, N/mm, between a and b (mm from node 1). */
export interface LocalLineLoad {
  a: number;
  b: number;
  q: V3;
}

const GAUSS3 = [
  [-Math.sqrt(3 / 5), 5 / 9],
  [0, 8 / 9],
  [Math.sqrt(3 / 5), 5 / 9],
] as const;

/**
 * Equivalent nodal loads (local, 12) for a uniform load over [a, b]: consistent loads
 * from the Hermite shape functions for a frame, simple-span reactions for a truss.
 */
export function equivalentLoads(load: LocalLineLoad, L: number, truss: boolean, out = new Float64Array(12)): Float64Array {
  const { a, b, q } = load;
  if (b <= a) return out;
  const half = (b - a) / 2;
  const mid = (a + b) / 2;
  for (const [g, w] of GAUSS3) {
    const s = mid + g * half;
    const x = s / L;
    const wt = w * half;
    const n1 = 1 - x;
    const n2 = x;
    out[0] = out[0]! + q[0] * n1 * wt;
    out[6] = out[6]! + q[0] * n2 * wt;
    if (truss) {
      out[1] = out[1]! + q[1] * n1 * wt;
      out[7] = out[7]! + q[1] * n2 * wt;
      out[2] = out[2]! + q[2] * n1 * wt;
      out[8] = out[8]! + q[2] * n2 * wt;
      continue;
    }
    const h1 = 1 - 3 * x * x + 2 * x ** 3;
    const h2 = L * (x - 2 * x * x + x ** 3);
    const h3 = 3 * x * x - 2 * x ** 3;
    const h4 = L * (-x * x + x ** 3);
    out[1] = out[1]! + q[1] * h1 * wt;
    out[5] = out[5]! + q[1] * h2 * wt;
    out[7] = out[7]! + q[1] * h3 * wt;
    out[11] = out[11]! + q[1] * h4 * wt;
    out[2] = out[2]! + q[2] * h1 * wt;
    out[4] = out[4]! - q[2] * h2 * wt;
    out[8] = out[8]! + q[2] * h3 * wt;
    out[10] = out[10]! - q[2] * h4 * wt;
  }
  return out;
}

/** Internal forces at a cut: N (tension +), Vy, Vz, T, My, Mz. */
export const FORCE_COMPONENTS = 6;

/**
 * Internal forces at `x` from the element's end forces at node 1 (`f1`, local: the force
 * and moment the node exerts on the element) and the loads between 0 and x, by statics
 * on the segment [0, x]. Writes N, Vy, Vz, T, My, Mz into `out` at `offset`.
 */
export function internalForces(
  f1: ArrayLike<number>,
  loads: readonly LocalLineLoad[],
  x: number,
  out: Float64Array,
  offset: number,
): void {
  let Rx = -f1[0]!;
  let Ry = -f1[1]!;
  let Rz = -f1[2]!;
  let Mx = -f1[3]!;
  let My = -f1[4]! - x * f1[2]!;
  let Mz = -f1[5]! + x * f1[1]!;
  for (const l of loads) {
    if (l.a >= x) continue;
    const m = Math.min(l.b, x);
    const len = m - l.a;
    Rx -= l.q[0] * len;
    Ry -= l.q[1] * len;
    Rz -= l.q[2] * len;
    // ∫ (s − x) ds over [a, m]
    const lever = ((m - x) ** 2 - (l.a - x) ** 2) / 2;
    My += lever * l.q[2];
    Mz -= lever * l.q[1];
  }
  out[offset] = Rx;
  out[offset + 1] = Ry;
  out[offset + 2] = Rz;
  out[offset + 3] = Mx;
  out[offset + 4] = My;
  out[offset + 5] = Mz;
}

/**
 * Local transverse displacement (v, w) at `x`: the Hermite interpolation of the end
 * DOFs plus the fixed-end deflection of the element's loads (each load smeared over
 * the whole element, which is exact for full-length loads).
 */
export function interiorDeflection(
  uLocal: ArrayLike<number>,
  loads: readonly LocalLineLoad[],
  p: SectionProps,
  L: number,
  x: number,
  truss: boolean,
): [number, number] {
  const s = x / L;
  if (truss) {
    return [uLocal[1]! * (1 - s) + uLocal[7]! * s, uLocal[2]! * (1 - s) + uLocal[8]! * s];
  }
  const h1 = 1 - 3 * s * s + 2 * s ** 3;
  const h2 = L * (s - 2 * s * s + s ** 3);
  const h3 = 3 * s * s - 2 * s ** 3;
  const h4 = L * (-s * s + s ** 3);
  let v = h1 * uLocal[1]! + h2 * uLocal[5]! + h3 * uLocal[7]! + h4 * uLocal[11]!;
  let w = h1 * uLocal[2]! - h2 * uLocal[4]! + h3 * uLocal[8]! - h4 * uLocal[10]!;
  const bubble = (x * x * (L - x) ** 2) / 24;
  for (const l of loads) {
    const share = (l.b - l.a) / L;
    v += (l.q[1] * share * bubble) / (p.E * p.Iz);
    w += (l.q[2] * share * bubble) / (p.E * p.Iy);
  }
  return [v, w];
}
