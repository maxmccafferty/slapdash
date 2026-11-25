/**
 * Textbook verification of the kernel against closed forms, on hand-made analytical
 * models (no project mapping). Tolerance 0.5%, or 1e-6 relative for pure kernel cases.
 */
import { describe, expect, it } from 'vitest';
import { internalForces } from '../src/fem/element.ts';
import { solveModel, type FemLoadCase, type FemModel } from '../src/fem/solve.ts';
import { Builder, PROPS } from './fem-helpers.ts';

const { E, G, A, Iy, Iz, J } = PROPS;
const L = 3000;

function solve(model: FemModel, c: Omit<FemLoadCase, 'name'>) {
  const sol = solveModel(model, [{ name: 'c', ...c }]);
  if (!sol.ok) throw new Error(`mechanism at node ${sol.node}`);
  return sol.cases[0]!;
}

/** Internal forces at x along element i. */
function forcesAt(c: ReturnType<typeof solve>, i: number, x: number) {
  const out = new Float64Array(6);
  internalForces(c.endForces.subarray(i * 12, i * 12 + 6), c.localLoads[i]!, x, out, 0);
  return { N: out[0]!, Vy: out[1]!, Vz: out[2]!, T: out[3]!, My: out[4]!, Mz: out[5]! };
}

const close = (actual: number, expected: number, rel = 1e-6) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * rel);

describe('textbook cases', () => {
  it('cantilever with a tip load, about both axes: δ = PL³/3EI, M = PL', () => {
    const P = 1000;
    for (const [dir, I, comp] of [
      [1, Iz, 'Mz'],
      [2, Iy, 'My'],
    ] as const) {
      const b = new Builder();
      const root = b.node([0, 0, 0]);
      const tip = b.node([L, 0, 0]);
      b.member(root, tip, 4);
      b.fix(root);
      const f = [0, 0, 0, 0, 0, 0];
      f[dir] = -P;
      const c = solve(b.model(), { elementLoads: [], nodalLoads: [{ node: tip, f }] });
      close(c.u[tip * 6 + dir]!, (-P * L ** 3) / (3 * E * I), 1e-4);
      close(Math.abs(forcesAt(c, 0, 0)[comp]), P * L, 1e-4);
    }
  });

  it('simply supported beam under UDL: δ = 5wL⁴/384EI, M = wL²/8, V = wL/2', () => {
    const w = 2;
    for (const n of [1, 4]) {
      const b = new Builder();
      const a = b.node([0, 0, 0]);
      const z = b.node([L, 0, 0]);
      const ids = b.member(a, z, n);
      b.pin(a);
      b.pin(z);
      const elementLoads = Array.from({ length: n }, (_, i) => ({ element: i, a: 0, b: L / n, q: [0, -w, 0] as const }));
      const c = solve(b.model(), { elementLoads, nodalLoads: [] });
      // Midspan: a node when n is even, an interior station when n = 1.
      const mid = n === 1 ? forcesAt(c, 0, L / 2) : forcesAt(c, n / 2, 0);
      close(Math.abs(mid.Mz), (w * L ** 2) / 8, 1e-4);
      close(Math.abs(forcesAt(c, 0, 0).Vy), (w * L) / 2, 1e-4);
      if (n === 4) close(-c.u[ids[2]! * 6 + 1]!, (5 * w * L ** 4) / (384 * E * Iz), 1e-4);
    }
  });

  it('fixed–fixed beam under UDL: M_end = wL²/12, M_mid = wL²/24', () => {
    const w = 2;
    const b = new Builder();
    const a = b.node([0, 0, 0]);
    const z = b.node([L, 0, 0]);
    b.member(a, z, 2);
    b.fix(a);
    b.fix(z);
    const c = solve(b.model(), {
      elementLoads: [0, 1].map((i) => ({ element: i, a: 0, b: L / 2, q: [0, -w, 0] as const })),
      nodalLoads: [],
    });
    close(Math.abs(forcesAt(c, 0, 0).Mz), (w * L ** 2) / 12, 1e-4);
    close(Math.abs(forcesAt(c, 1, 0).Mz), (w * L ** 2) / 24, 1e-4);
  });

  it('propped cantilever under UDL: R = 3wL/8', () => {
    const w = 2;
    const b = new Builder();
    const a = b.node([0, 0, 0]);
    const z = b.node([L, 0, 0]);
    b.member(a, z, 3);
    b.fix(a);
    b.pin(z);
    const c = solve(b.model(), {
      elementLoads: [0, 1, 2].map((i) => ({ element: i, a: 0, b: L / 3, q: [0, -w, 0] as const })),
      nodalLoads: [],
    });
    const prop = b.links.length - 1;
    close(c.linkForces[prop * 6 + 1]!, (3 * w * L) / 8, 1e-4);
  });

  it('axial bar δ = PL/EA and torsion bar θ = TL/GJ', () => {
    const b = new Builder();
    const a = b.node([0, 0, 0]);
    const z = b.node([0, L, 0]);
    b.member(a, z, 3, PROPS, { yHint: [1, 0, 0] });
    b.fix(a);
    const c = solve(b.model(), { elementLoads: [], nodalLoads: [{ node: z, f: [0, 500, 0, 0, 2e5, 0] }] });
    close(c.u[z * 6 + 1]!, (500 * L) / (E * A), 1e-4);
    close(c.u[z * 6 + 4]!, (2e5 * L) / (G * J), 1e-4);
  });

  it('3D right-angle cantilever: δ = Pa³/3EI + Pb³/3EI + Pab²/GJ', () => {
    // Leg a along x from the fixed root, leg b along z, tip load P in −y. Both legs bend
    // about their own z (local y = world y), so I = Iz. The twist of leg a under the
    // torque P·b moves the tip by θ·b = P·b²·a/GJ.
    const a = 2000;
    const bLen = 1500;
    const P = 800;
    const m = new Builder();
    const root = m.node([0, 0, 0]);
    const corner = m.node([a, 0, 0]);
    const tip = m.node([a, 0, bLen]);
    m.member(root, corner, 2);
    m.member(corner, tip, 2);
    m.fix(root);
    const c = solve(m.model(), { elementLoads: [], nodalLoads: [{ node: tip, f: [0, -P, 0, 0, 0, 0] }] });
    const expected = (P * a ** 3) / (3 * E * Iz) + (P * bLen ** 3) / (3 * E * Iz) + (P * a * bLen ** 2) / (G * J);
    close(-c.u[tip * 6 + 1]!, expected, 1e-4);
  });

  it('portal frame, fixed bases, under lateral load: slope-deflection closed form', () => {
    // Columns h, beam span s. Slope-deflection with joint rotation θ and sway ψ = Δ/h
    // (antisymmetric): θ = 3·ic·ψ/(2ic + 3ib) and H = 12·ic·(2ψ − θ)/h, with ic = EIc/h,
    // ib = EIb/s (e.g. Kassimali, Structural Analysis, the slope-deflection chapter on
    // frames with sidesway). Axial shortening is negligible with these sections.
    const h = 2700;
    const s = 4000;
    const H = 2000;
    const colProps = { ...PROPS, A: 1e7 };
    const beamProps = { ...PROPS, A: 1e7, Iz: 3e7 };
    const m = new Builder();
    const b1 = m.node([0, 0, 0]);
    const t1 = m.node([0, h, 0]);
    const t2 = m.node([s, h, 0]);
    const b2 = m.node([s, 0, 0]);
    m.member(b1, t1, 4, colProps, { yHint: [-1, 0, 0] });
    m.member(t1, t2, 4, beamProps);
    m.member(b2, t2, 4, colProps, { yHint: [-1, 0, 0] });
    m.fix(b1);
    m.fix(b2);
    const c = solve(m.model(), { elementLoads: [], nodalLoads: [{ node: t1, f: [H, 0, 0, 0, 0, 0] }] });
    const ic = (E * colProps.Iz) / h;
    const ib = (E * beamProps.Iz) / s;
    // Solve H = 12·ic·(2ψ − θ(ψ))/h for ψ.
    const theta = (psi: number) => (3 * ic * psi) / (2 * ic + 3 * ib);
    const psi = (H * h) / (12 * ic * (2 - theta(1)));
    const sway = (c.u[t1 * 6]! + c.u[t2 * 6]!) / 2;
    close(sway, psi * h, 5e-3);
  });

  it('pinned portal: a mechanism without a brace, truss forces from statics with one', () => {
    const h = 2700;
    const s = 3600;
    const H = 1500;
    const build = (brace: boolean) => {
      const m = new Builder();
      const b1 = m.node([0, 0, 0]);
      const t1 = m.node([0, h, 0]);
      const t2 = m.node([s, h, 0]);
      const b2 = m.node([s, 0, 0]);
      // Every member a truss: pinned knees and bases.
      m.member(b1, t1, 1, PROPS, { truss: true });
      m.member(t1, t2, 1, PROPS, { truss: true });
      m.member(b2, t2, 1, PROPS, { truss: true });
      if (brace) m.member(b1, t2, 1, PROPS, { truss: true });
      m.pin(b1);
      m.pin(b2);
      // Tiny springs at the free knees keep their rotations and out-of-plane moves defined.
      m.links.push({ a: t1, b: -1, kt: 1e-3, kr: 1e-3 }, { a: t2, b: -1, kt: 1e-3, kr: 1e-3 });
      return { m, t1, t2 };
    };
    const loose = build(false);
    const r0 = solveModel(loose.m.model(), [{ name: 'H', elementLoads: [], nodalLoads: [{ node: loose.t1, f: [H, 0, 0, 0, 0, 0] }] }]);
    // Either a hard mechanism or a runaway sway; never a sensible answer.
    if (r0.ok) expect(Math.abs(r0.cases[0]!.u[loose.t1 * 6]!)).toBeGreaterThan(1e3);

    const braced = build(true);
    const c = solve(braced.m.model(), { elementLoads: [], nodalLoads: [{ node: braced.t1, f: [H, 0, 0, 0, 0, 0] }] });
    const diag = 3;
    const Ld = Math.hypot(s, h);
    // Joint t2: the beam brings H across; the diagonal's horizontal component takes it.
    const N = -c.endForces[diag * 12]!; // tension positive
    close(Math.abs(N), (H * Ld) / s, 1e-4);
  });
});
