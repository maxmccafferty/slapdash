/**
 * The analytical model (nodes, frame/truss elements, links) and the linear solve:
 * renumber with RCM, assemble the skyline, factor once, solve every basic load case,
 * then recover element end forces and link forces.
 */
import {
  equivalentLoads,
  localStiffness,
  matVec12,
  toGlobal,
  vecToGlobal,
  vecToLocal,
  type Axes,
  type LocalLineLoad,
  type SectionProps,
  type V3,
} from './element.ts';
import { linkForceOnA, linkStiffness, type LinkStiffness } from './link.ts';
import { panelStiffness, shearStrainVector, type FemPanel } from './panel.ts';
import { chooseOrdering } from './rcm.ts';
import { PIVOT_TOLERANCE, Skyline } from './skyline.ts';

export interface FemElement {
  n1: number;
  n2: number;
  axes: Axes;
  L: number;
  props: SectionProps;
  truss: boolean;
}

export interface FemLink extends LinkStiffness {
  a: number;
  /** The other node, or −1 for the ground. */
  b: number;
}

export interface FemModel {
  nodes: V3[];
  elements: FemElement[];
  links: FemLink[];
  /** Shear panels (sheathing that braces). */
  panels?: FemPanel[];
}

/** A uniform load over [a, b] of an element (mm from node 1), in world axes, N/mm. */
export interface ElementLoad {
  element: number;
  a: number;
  b: number;
  q: V3;
}

export interface NodalLoad {
  node: number;
  /** Fx, Fy, Fz (N) and Mx, My, Mz (N·mm), world axes. */
  f: readonly number[];
}

export interface FemLoadCase {
  name: string;
  elementLoads: ElementLoad[];
  nodalLoads: NodalLoad[];
}

export interface CaseSolution {
  name: string;
  /** Six displacements per node (world axes), in the model's node order. */
  u: Float64Array;
  /** Twelve local end forces per element: what the nodes exert on the element. */
  endForces: Float64Array;
  /** Six components per link: force at the joint point and rotational-spring moment on side A, world axes. */
  linkForces: Float64Array;
  /** Each element's loads in local axes. */
  localLoads: LocalLineLoad[][];
  /** Average shear strain γ of each panel. */
  panelStrain: Float64Array;
  /** Work done by the loads, ½·f·u (N·mm). */
  work: number;
}

export interface FemSolution {
  ok: true;
  cases: CaseSolution[];
  dofs: number;
  profile: number;
  minPivotRatio: number;
}

export interface FemMechanism {
  ok: false;
  node: number;
  /** 0–5: ux, uy, uz, rx, ry, rz. */
  component: number;
  ratio: number;
}

export function elementLocalStiffness(e: FemElement): Float64Array {
  return localStiffness(e.props, e.L, e.truss);
}

export function solveModel(model: FemModel, cases: readonly FemLoadCase[], tolerance = PIVOT_TOLERANCE): FemSolution | FemMechanism {
  const nn = model.nodes.length;
  const adj: number[][] = Array.from({ length: nn }, () => []);
  const connect = (a: number, b: number) => {
    if (a < 0 || b < 0 || a === b) return;
    adj[a]!.push(b);
    adj[b]!.push(a);
  };
  const panels = model.panels ?? [];
  for (const e of model.elements) connect(e.n1, e.n2);
  for (const l of model.links) connect(l.a, l.b);
  for (const p of panels) for (let i = 0; i < 4; i++) for (let k = i + 1; k < 4; k++) connect(p.nodes[i]!, p.nodes[k]!);
  for (const list of adj) {
    list.sort((x, y) => x - y);
    let w = 0;
    for (let r = 0; r < list.length; r++) if (r === 0 || list[r] !== list[r - 1]) list[w++] = list[r]!;
    list.length = w;
  }
  const { inverse } = chooseOrdering(adj, model.nodes);
  const n = nn * 6;
  const dofsOf = (node: number) => {
    const base = inverse[node]! * 6;
    return [base, base + 1, base + 2, base + 3, base + 4, base + 5];
  };
  const elemDofs = model.elements.map((e) => Int32Array.from([...dofsOf(e.n1), ...dofsOf(e.n2)]));
  const linkDofs = model.links.map((l) => Int32Array.from(l.b >= 0 ? [...dofsOf(l.a), ...dofsOf(l.b)] : dofsOf(l.a)));
  const panelDofs = panels.map((p) => Int32Array.from(p.nodes.flatMap((v) => dofsOf(v).slice(0, 3))));

  const K = Skyline.fromConnectivity(n, [...elemDofs, ...linkDofs, ...panelDofs]);
  const kLocals = model.elements.map(elementLocalStiffness);
  model.elements.forEach((e, i) => K.assemble(elemDofs[i]!, toGlobal(kLocals[i]!, e.axes)));
  model.links.forEach((l, i) => K.assemble(linkDofs[i]!, linkStiffness(l, l.b < 0)));
  panels.forEach((p, i) => K.assemble(panelDofs[i]!, panelStiffness(p)));
  const panelG = panels.map(shearStrainVector);

  const profile = K.size;
  const fact = K.factor(tolerance);
  if (!fact.ok) {
    const pos = Math.floor(fact.dof / 6);
    const node = (() => {
      for (let v = 0; v < nn; v++) if (inverse[v] === pos) return v;
      return -1;
    })();
    return { ok: false, node, component: fact.dof % 6, ratio: fact.ratio };
  }

  const out: CaseSolution[] = [];
  const tmpL = new Float64Array(12);
  const tmpG = new Float64Array(12);
  for (const c of cases) {
    const rhs = new Float64Array(n);
    const localLoads: LocalLineLoad[][] = model.elements.map(() => []);
    for (const el of c.elementLoads) {
      const e = model.elements[el.element]!;
      const q: V3 = [
        e.axes[0][0] * el.q[0] + e.axes[0][1] * el.q[1] + e.axes[0][2] * el.q[2],
        e.axes[1][0] * el.q[0] + e.axes[1][1] * el.q[1] + e.axes[1][2] * el.q[2],
        e.axes[2][0] * el.q[0] + e.axes[2][1] * el.q[1] + e.axes[2][2] * el.q[2],
      ];
      const a = Math.max(0, Math.min(e.L, el.a));
      const b = Math.max(0, Math.min(e.L, el.b));
      if (b <= a) continue;
      const load = { a, b, q };
      localLoads[el.element]!.push(load);
      tmpL.fill(0);
      equivalentLoads(load, e.L, e.truss, tmpL);
      vecToGlobal(tmpL, e.axes, tmpG);
      const dofs = elemDofs[el.element]!;
      for (let i = 0; i < 12; i++) rhs[dofs[i]!] = rhs[dofs[i]!]! + tmpG[i]!;
    }
    for (const nl of c.nodalLoads) {
      const dofs = dofsOf(nl.node);
      for (let i = 0; i < 6; i++) rhs[dofs[i]!] = rhs[dofs[i]!]! + (nl.f[i] ?? 0);
    }
    const f = rhs.slice();
    K.solve(rhs);
    let work = 0;
    for (let i = 0; i < n; i++) work += 0.5 * f[i]! * rhs[i]!;

    const u = new Float64Array(n);
    for (let v = 0; v < nn; v++) {
      const base = inverse[v]! * 6;
      for (let i = 0; i < 6; i++) u[v * 6 + i] = rhs[base + i]!;
    }

    const endForces = new Float64Array(model.elements.length * 12);
    const ue = new Float64Array(12);
    const ul = new Float64Array(12);
    const ku = new Float64Array(12);
    model.elements.forEach((e, i) => {
      for (let k = 0; k < 6; k++) {
        ue[k] = u[e.n1 * 6 + k]!;
        ue[6 + k] = u[e.n2 * 6 + k]!;
      }
      vecToLocal(ue, e.axes, ul);
      matVec12(kLocals[i]!, ul, ku);
      tmpL.fill(0);
      for (const load of localLoads[i]!) equivalentLoads(load, e.L, e.truss, tmpL);
      for (let k = 0; k < 12; k++) endForces[i * 12 + k] = ku[k]! - tmpL[k]!;
    });

    const linkForces = new Float64Array(model.links.length * 6);
    const zero = new Float64Array(6);
    const lf = new Float64Array(6);
    model.links.forEach((l, i) => {
      const uA = u.subarray(l.a * 6, l.a * 6 + 6);
      const uB = l.b >= 0 ? u.subarray(l.b * 6, l.b * 6 + 6) : zero;
      linkForceOnA(l, uA, uB, lf);
      linkForces.set(lf, i * 6);
    });

    const panelStrain = new Float64Array(panels.length);
    panels.forEach((p, i) => {
      const g = panelG[i]!;
      let s = 0;
      for (let c = 0; c < 4; c++) for (let k = 0; k < 3; k++) s += g[c * 3 + k]! * u[p.nodes[c]! * 6 + k]!;
      panelStrain[i] = s;
    });

    out.push({ name: c.name, u, endForces, linkForces, localLoads, panelStrain, work });
  }
  return { ok: true, cases: out, dofs: n, profile, minPivotRatio: fact.minRatio };
}
