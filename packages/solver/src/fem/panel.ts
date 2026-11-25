/**
 * A pure-shear panel: four corner nodes, stiffness only against the panel's average
 * in-plane shear strain. It stands in for a sheathing panel nailed to framing
 * (ADR-0002 §E5's equivalent brace).
 *
 * With corners c0 (0,0), c1 (b,0), c2 (b,h), c3 (0,h) in the panel's in-plane axes
 * (ex along b, ey along h), the bilinear average shear strain is
 *   γ = [(u2 + u3) − (u0 + u1)] / 2h + [(v1 + v2) − (v0 + v3)] / 2b,
 * where u and v are the corner moves along ex and ey. The energy ½·Ga·b·h·γ² gives a
 * racking stiffness Ga·b/h, the SDPWS apparent shear stiffness. Unlike an X of
 * diagonals it carries nothing under uniform stretch or squash, so the sheet doesn't
 * pick up gravity load meant for the studs. Rigid-body motions give γ = 0.
 */
import type { V3 } from './element.ts';

export interface FemPanel {
  /** Corner nodes in order (0,0), (b,0), (b,h), (0,h). */
  nodes: readonly [number, number, number, number];
  ex: V3;
  ey: V3;
  b: number;
  h: number;
  /** Apparent shear stiffness, N/mm. */
  Ga: number;
}

/** γ = g · u over the corners' world translations (12 values: x, y, z per corner). */
export function shearStrainVector(p: FemPanel): Float64Array {
  // Coefficients on (u, v) per corner.
  const cu = [-1 / (2 * p.h), -1 / (2 * p.h), 1 / (2 * p.h), 1 / (2 * p.h)];
  const cv = [-1 / (2 * p.b), 1 / (2 * p.b), 1 / (2 * p.b), -1 / (2 * p.b)];
  const g = new Float64Array(12);
  for (let c = 0; c < 4; c++) for (let k = 0; k < 3; k++) g[c * 3 + k] = cu[c]! * p.ex[k]! + cv[c]! * p.ey[k]!;
  return g;
}

/** 12×12 stiffness over the corners' translations. */
export function panelStiffness(p: FemPanel): Float64Array {
  const g = shearStrainVector(p);
  const s = p.Ga * p.b * p.h;
  const K = new Float64Array(144);
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) K[i * 12 + j] = s * g[i]! * g[j]!;
  return K;
}
