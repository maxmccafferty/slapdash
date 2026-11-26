/**
 * Symmetric matrix in skyline (profile) storage, with an in-place LDLᵀ factorisation
 * and multi-right-hand-side solves. Column j holds rows first[j]..j contiguously, the
 * diagonal last. Factor once, back-substitute once per load case.
 */

export interface PivotFailure {
  ok: false;
  /** The equation whose pivot vanished. */
  dof: number;
  /** Pivot ÷ the original diagonal. */
  ratio: number;
}

/** A pivot below this fraction of its original diagonal means a mechanism. */
export const PIVOT_TOLERANCE = 1e-12;

export class Skyline {
  readonly n: number;
  readonly first: Int32Array;
  /** Start of column j in `a`; the diagonal of column j is at ptr[j + 1] − 1. */
  readonly ptr: Int32Array;
  readonly a: Float64Array;
  private factored = false;

  /** `first[j]` is the topmost non-zero row of column j (≤ j). */
  constructor(first: Int32Array) {
    this.n = first.length;
    this.first = first;
    this.ptr = new Int32Array(this.n + 1);
    for (let j = 0; j < this.n; j++) this.ptr[j + 1] = this.ptr[j]! + (j - first[j]! + 1);
    this.a = new Float64Array(this.ptr[this.n]!);
  }

  /** Build the column heights from element DOF lists. */
  static fromConnectivity(n: number, dofSets: Iterable<ArrayLike<number>>): Skyline {
    const first = new Int32Array(n);
    for (let j = 0; j < n; j++) first[j] = j;
    for (const dofs of dofSets) {
      let lo = Infinity;
      for (let i = 0; i < dofs.length; i++) if (dofs[i]! >= 0) lo = Math.min(lo, dofs[i]!);
      for (let i = 0; i < dofs.length; i++) {
        const d = dofs[i]!;
        if (d >= 0 && lo < first[d]!) first[d] = lo;
      }
    }
    return new Skyline(first);
  }

  get size(): number {
    return this.a.length;
  }

  private index(i: number, j: number): number {
    return this.ptr[j]! + (i - this.first[j]!);
  }

  /** Add v to entry (i, j) (and so to (j, i)). */
  add(i: number, j: number, v: number): void {
    if (i > j) [i, j] = [j, i];
    if (i < this.first[j]!) throw new Error(`entry (${i}, ${j}) is outside the skyline`);
    this.a[this.index(i, j)] = this.a[this.index(i, j)]! + v;
  }

  get(i: number, j: number): number {
    if (i > j) [i, j] = [j, i];
    return i < this.first[j]! ? 0 : this.a[this.index(i, j)]!;
  }

  diagonal(j: number): number {
    return this.a[this.ptr[j + 1]! - 1]!;
  }

  /** Scatter a dense element matrix (row-major, size m×m) into the given DOFs; −1 skips. */
  assemble(dofs: ArrayLike<number>, k: ArrayLike<number>): void {
    const m = dofs.length;
    for (let r = 0; r < m; r++) {
      const i = dofs[r]!;
      if (i < 0) continue;
      for (let c = r; c < m; c++) {
        const j = dofs[c]!;
        if (j < 0) continue;
        const v = k[r * m + c]!;
        if (v === 0) continue;
        if (i === j) {
          const d = this.ptr[j + 1]! - 1;
          this.a[d] = this.a[d]! + (r === c ? v : 2 * v);
        }
        else this.add(i, j, v);
      }
    }
  }

  /** In-place LDLᵀ: afterwards column j holds L's column (unit diagonal implied) above D_j. */
  factor(tolerance = PIVOT_TOLERANCE): { ok: true; minRatio: number } | PivotFailure {
    if (this.factored) throw new Error('already factored');
    const { a, ptr, first, n } = this;
    let minRatio = Infinity;
    for (let j = 0; j < n; j++) {
      const fj = first[j]!;
      const pj = ptr[j]!;
      const dj = ptr[j + 1]! - 1;
      const original = a[dj]!;
      // g_ij = a_ij − Σ l_ki · g_kj, for i in (fj, j)
      for (let i = fj + 1; i < j; i++) {
        const fi = first[i]!;
        const m = fi > fj ? fi : fj;
        if (m >= i) continue;
        const pi = ptr[i]!;
        let s = 0;
        let ki = pi + (m - fi);
        let kj = pj + (m - fj);
        for (let k = m; k < i; k++) s += a[ki++]! * a[kj++]!;
        a[pj + (i - fj)] = a[pj + (i - fj)]! - s;
      }
      // l_ij = g_ij / d_i, d_j −= l_ij · g_ij
      let d = a[dj]!;
      for (let i = fj; i < j; i++) {
        const idx = pj + (i - fj);
        const g = a[idx]!;
        if (g === 0) continue;
        const l = g / a[ptr[i + 1]! - 1]!;
        a[idx] = l;
        d -= l * g;
      }
      a[dj] = d;
      const ratio = original > 0 ? d / original : -Infinity;
      if (!(ratio > tolerance) || !Number.isFinite(d)) {
        this.factored = true;
        return { ok: false, dof: j, ratio };
      }
      if (ratio < minRatio) minRatio = ratio;
    }
    this.factored = true;
    return { ok: true, minRatio };
  }

  /** Solve in place for one right-hand side (after `factor`). */
  solve(b: Float64Array): Float64Array {
    if (!this.factored) throw new Error('factor first');
    const { a, ptr, first, n } = this;
    for (let j = 0; j < n; j++) {
      const fj = first[j]!;
      let s = 0;
      let idx = ptr[j]!;
      for (let k = fj; k < j; k++) s += a[idx++]! * b[k]!;
      b[j] = b[j]! - s;
    }
    for (let j = 0; j < n; j++) b[j] = b[j]! / a[ptr[j + 1]! - 1]!;
    for (let j = n - 1; j >= 0; j--) {
      const fj = first[j]!;
      const x = b[j]!;
      if (x === 0) continue;
      let idx = ptr[j]!;
      for (let k = fj; k < j; k++) b[k] = b[k]! - a[idx++]! * x;
    }
    return b;
  }
}
