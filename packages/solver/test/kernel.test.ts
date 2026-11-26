import { describe, expect, it } from 'vitest';
import { localStiffness, matVec12, toGlobal, vecToLocal, type SectionProps } from '../src/fem/element.ts';
import { profileSize, reverseCuthillMcKee } from '../src/fem/rcm.ts';
import { Skyline } from '../src/fem/skyline.ts';
import { solveModel } from '../src/fem/solve.ts';
import { axesFor, Builder, PROPS } from './fem-helpers.ts';

const P: SectionProps = PROPS;

describe('frame element', () => {
  it('local and global stiffness are symmetric', () => {
    const k = localStiffness(P, 1200);
    const g = toGlobal(k, axesFor([0, 0, 0], [300, 900, -400], [0.3, 0.2, 1]));
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        expect(k[i * 12 + j]).toBeCloseTo(k[j * 12 + i]!, 9);
        expect(Math.abs(g[i * 12 + j]! - g[j * 12 + i]!)).toBeLessThan(1e-6 * Math.abs(g[i * 12 + i]!) + 1e-9);
      }
    }
  });

  it('rigid-body motions give no end forces', () => {
    const p0 = [100, 200, 300] as const;
    const p1 = [700, -100, 900] as const;
    const axes = axesFor(p0, p1, [0, 0, 1]);
    const k = toGlobal(localStiffness(P, Math.hypot(600, 300, 600)), axes);
    // A small rotation ω about an arbitrary axis plus a translation t: u = t + ω × r.
    const w = [1e-3, -2e-3, 0.5e-3];
    const t = [3, -1, 2];
    const u = new Float64Array(12);
    for (const [blk, r] of [
      [0, p0],
      [1, p1],
    ] as const) {
      u[blk * 6] = t[0]! + w[1]! * r[2] - w[2]! * r[1];
      u[blk * 6 + 1] = t[1]! + w[2]! * r[0] - w[0]! * r[2];
      u[blk * 6 + 2] = t[2]! + w[0]! * r[1] - w[1]! * r[0];
      u[blk * 6 + 3] = w[0]!;
      u[blk * 6 + 4] = w[1]!;
      u[blk * 6 + 5] = w[2]!;
    }
    const f = matVec12(k, u);
    const scale = Math.max(...k.map(Math.abs));
    for (const v of f) expect(Math.abs(v)).toBeLessThan(scale * 1e-9);
  });

  it('local/global vector transforms are inverse', () => {
    const axes = axesFor([0, 0, 0], [1, 2, 3]);
    const g = Float64Array.from({ length: 12 }, (_, i) => i - 4.5);
    const l = vecToLocal(g, axes);
    const back = new Float64Array(12);
    for (let blk = 0; blk < 4; blk++)
      for (let c = 0; c < 3; c++) back[blk * 3 + c] = axes[0][c]! * l[blk * 3]! + axes[1][c]! * l[blk * 3 + 1]! + axes[2][c]! * l[blk * 3 + 2]!;
    for (let i = 0; i < 12; i++) expect(back[i]).toBeCloseTo(g[i]!, 12);
  });
});

describe('skyline LDLᵀ', () => {
  it('solves a small SPD system with several right-hand sides', () => {
    const A = [
      [4, 1, 0, 0],
      [1, 5, 2, 0],
      [0, 2, 6, 1],
      [0, 0, 1, 3],
    ];
    const K = Skyline.fromConnectivity(4, [
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    for (let i = 0; i < 4; i++) for (let j = i; j < 4; j++) if (A[i]![j]) K.add(i, j, A[i]![j]!);
    expect(K.factor().ok).toBe(true);
    for (const x of [
      [1, 2, 3, 4],
      [-1, 0.5, 0, 2],
    ]) {
      const b = Float64Array.from(A.map((row) => row.reduce((s, v, j) => s + v * x[j]!, 0)));
      K.solve(b);
      b.forEach((v, i) => expect(v).toBeCloseTo(x[i]!, 12));
    }
  });

  it('reports a zero pivot', () => {
    const K = Skyline.fromConnectivity(2, [[0, 1]]);
    K.add(0, 0, 1);
    K.add(0, 1, 1);
    K.add(1, 1, 1);
    const r = K.factor();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.dof).toBe(1);
  });

  it('a hand-checked two-element cantilever', () => {
    // Axial bar of two elements, fixed at node 0, load P at the tip: u = PL/EA at the tip, PL/2EA mid.
    const b = new Builder();
    const a = b.node([0, 0, 0]);
    const c = b.node([2000, 0, 0]);
    const ids = b.member(a, c, 2);
    b.fix(a);
    const sol = solveModel(b.model(), [{ name: 'P', elementLoads: [], nodalLoads: [{ node: c, f: [1000, 0, 0, 0, 0, 0] }] }]);
    if (!sol.ok) throw new Error('mechanism');
    const u = sol.cases[0]!.u;
    expect(u[c * 6]).toBeCloseTo((1000 * 2000) / (P.E * P.A), 6);
    expect(u[ids[1]! * 6]).toBeCloseTo((1000 * 1000) / (P.E * P.A), 6);
  });
});

describe('reverse Cuthill–McKee', () => {
  it('reduces the profile of a scrambled ladder', () => {
    // A 2×40 ladder numbered badly: rungs far apart in numbering.
    const n = 80;
    const adj: number[][] = Array.from({ length: n }, () => []);
    const id = (side: number, k: number) => (side === 0 ? k : n - 1 - k);
    const link = (a: number, b: number) => {
      adj[a]!.push(b);
      adj[b]!.push(a);
    };
    for (let k = 0; k < 40; k++) {
      link(id(0, k), id(1, k));
      if (k > 0) {
        link(id(0, k), id(0, k - 1));
        link(id(1, k), id(1, k - 1));
      }
    }
    const identity = Int32Array.from({ length: n }, (_, i) => i);
    const { inverse, perm } = reverseCuthillMcKee(adj);
    expect([...perm].sort((a, b) => a - b)).toEqual([...identity]);
    expect(profileSize(adj, inverse)).toBeLessThan(profileSize(adj, identity) / 5);
  });
});
