/**
 * `analyze`: project + catalog → utilisation for every part and joint.
 *
 * build the analytical model → basic load cases → one factorisation, one solve per case
 * → combinations by superposition → NDS member, bearing, deflection, panel and joint
 * checks. Pure: no DOM, no Node, no clock other than `performance.now` for timing.
 */
import { GROUND, indexCatalog, isCatalogIndex, type Catalog, type CatalogIndex } from '@slapdash/core';
import { REPETITIVE_MAX_SPACING_MM, REPETITIVE_ROLES, deflectionRule, memberCapacity, stationUtilization, unbracedLength, type MemberCapacity, type StationUtilization } from './checks/nds.ts';
import { checkJoint, jointCapacity, resolveJointForce } from './checks/joints.ts';
import { panelUnitShear } from './checks/panels.ts';
import { interiorDeflection, internalForces, vecToLocal, type V3 } from './fem/element.ts';
import { solveModel, type CaseSolution } from './fem/solve.ts';
import { buildLoadCases, spacingOf, toFemCases } from './loads/cases.ts';
import { combinationsFor, type LoadCombination } from './loads/combinations.ts';
import { buildModel, type AnalyticalModel, type MemberInfo } from './model/build.ts';
import { dot, length, lerp, scale, sub } from './model/geometry.ts';
import {
  BASIC_CASES,
  type AnalysisOptions,
  type AnalysisResult,
  type BasicCase,
  type Check,
  type Instability,
  type JointForces,
  type JointResult,
  type PartResult,
} from './types.ts';

export const DEFAULT_PERF_BUDGET_MS = 1000;
/** Utilisations are capped here so every result stays finite. */
const UTIL_CAP = 1e3;
/** Share of a case's work stored in pinned joints' stabilising springs that marks a mechanism. */
export const MECHANISM_ENERGY_SHARE = 0.5;

const clock = (globalThis as { performance?: { now(): number } }).performance;
const now = () => (clock ? clock.now() : Date.now());

type Checks = PartResult['checks'];

function note(checks: Checks, check: Check, utilization: number, combo: string) {
  const u = Math.min(UTIL_CAP, Number.isFinite(utilization) ? utilization : UTIL_CAP);
  const cur = checks[check];
  if (!cur || u > cur.utilization) checks[check] = { utilization: u, combo };
}

function governing(checks: Checks): Pick<PartResult, 'utilization' | 'governing'> {
  let best: Pick<PartResult, 'utilization' | 'governing'> = { utilization: 0 };
  for (const [check, v] of Object.entries(checks)) {
    if (v && v.utilization > best.utilization) best = { utilization: v.utilization, governing: { check: check as Check, combo: v.combo } };
  }
  return best;
}

/** Per element: station positions and, per case, N, Vy, Vz, T, My, Mz at each. */
interface StationTable {
  xs: number[];
  perCase: Float64Array[];
}

function stationTables(model: AnalyticalModel, sol: CaseSolution[]): StationTable[] {
  return model.fem.elements.map((e, i) => {
    const set = new Set<number>([0, e.L, e.L / 2]);
    for (const c of sol) for (const l of c.localLoads[i]!) set.add(l.a).add(l.b);
    const xs = [...set].sort((a, b) => a - b).filter((x, k, arr) => k === 0 || x - arr[k - 1]! > 1e-6);
    const perCase = sol.map((c) => {
      const out = new Float64Array(xs.length * 6);
      const f1 = c.endForces.subarray(i * 12, i * 12 + 6);
      xs.forEach((x, k) => internalForces(f1, c.localLoads[i]!, x, out, k * 6));
      return out;
    });
    return { xs, perCase };
  });
}

export function analyze(project: Parameters<typeof buildModel>[0], catalog: Catalog | CatalogIndex, options: AnalysisOptions = {}): AnalysisResult {
  const start = now();
  const idx = isCatalogIndex(catalog) ? catalog : indexCatalog(catalog);
  const model = buildModel(project, idx);
  const which = (options.cases ?? BASIC_CASES).filter((c, i, a) => a.indexOf(c) === i);
  const caseLoads = buildLoadCases(model, options);
  const warnings = [...model.warnings, ...caseLoads.warnings];
  const femCases = toFemCases(model, caseLoads.cases, which);
  const combos = combinationsFor(which);
  const sol = solveModel(model.fem, femCases);
  const stats = {
    nodes: model.fem.nodes.length,
    dofs: model.fem.nodes.length * 6,
    elements: model.fem.elements.length,
    links: model.fem.links.length,
    profile: sol.ok ? sol.profile : 0,
    ms: 0,
  };

  const parts: Record<string, PartResult> = {};
  const joints: Record<string, JointResult> = {};
  const baseResult = (): AnalysisResult => ({
    status: 'ok',
    parts,
    joints,
    unstable: [],
    warnings,
    loads: caseLoads.loads,
    combinations: combos.map((c) => c.name),
    stats,
  });

  if (!sol.ok) {
    const partId = sol.node >= 0 ? (model.nodeOwner[sol.node] ?? null) : null;
    const what = ['moves along x', 'moves along y', 'moves along z', 'spins about x', 'spins about y', 'spins about z'][sol.component];
    stats.ms = now() - start;
    return {
      ...baseResult(),
      status: 'mechanism',
      mechanism: {
        partId,
        message: `${partId ?? 'A part'} ${what} with nothing to stop it: the structure is a mechanism. Check that it has supports and joints.`,
      },
    };
  }
  const caseSol = sol.cases;
  const caseIndex = new Map(which.map((c, i) => [c, i]));
  const tables = stationTables(model, caseSol);
  const capCache = new Map<string, MemberCapacity>();

  const project_ = model.project;
  const assemblyKind = (asmId: string) => project_.assemblies[asmId]?.kind;
  const hasCeiling = new Map<string, boolean>();
  for (const p of Object.values(project_.parts)) {
    if (p.role === 'joist' || p.tags.includes('rafter-tie') || p.tags.includes('ceiling-joist') || p.tags.includes('ceiling-attached')) {
      hasCeiling.set(p.assemblyId, true);
    }
  }

  const repetitive = (info: MemberInfo) => {
    if (!REPETITIVE_ROLES.has(info.part.role)) return false;
    const s = spacingOf(project_.assemblies[info.part.assemblyId]?.builder?.params);
    return s !== undefined && s <= REPETITIVE_MAX_SPACING_MM + 1;
  };
  const capacity = (id: string, info: MemberInfo, CD: number) => {
    const key = `${id}|${CD}`;
    let c = capCache.get(key);
    if (!c) {
      const le = unbracedLength(info.line.length, info.nodes.filter((n) => info.linkNodes.has(n.node)).map((n) => n.t));
      c = memberCapacity({ material: info.material, section: info.section, le1: le, le2: info.sheathed ? 0 : le, repetitive: repetitive(info) }, CD);
      capCache.set(key, c);
    }
    return c;
  };

  // --- Members ------------------------------------------------------------------------
  const memberChecks = new Map<string, Checks>();
  for (const id of model.members.keys()) memberChecks.set(id, {});
  const g = new Float64Array(64 * 6);
  const u: StationUtilization = { bending: 0, shear: 0, tension: 0, compression: 0, combined: 0 };
  const evalPoint = (info: MemberInfo, cap: MemberCapacity, checks: Checks, combo: string, F: ArrayLike<number>, o: number) => {
    stationUtilization(info.section, cap, F[o]!, F[o + 1]!, F[o + 2]!, F[o + 4]!, F[o + 5]!, u);
    note(checks, 'bending', u.bending, combo);
    note(checks, 'shear', u.shear, combo);
    if (u.tension > 0) note(checks, 'tension', u.tension, combo);
    if (u.compression > 0) note(checks, 'compression', u.compression, combo);
    note(checks, 'combined', u.combined, combo);
  };
  const point = new Float64Array(6);
  for (const combo of combos) {
    const factors = which.map((c) => combo.factors[c] ?? 0);
    model.elementOwner.forEach((owner, ei) => {
      const info = model.members.get(owner.partId)!;
      const checks = memberChecks.get(owner.partId)!;
      const cap = capacity(owner.partId, info, combo.CD);
      const t = tables[ei]!;
      const n = t.xs.length * 6;
      const G = n <= g.length ? g : new Float64Array(n);
      G.fill(0, 0, n);
      factors.forEach((f, ci) => {
        if (f === 0) return;
        const arr = t.perCase[ci]!;
        for (let k = 0; k < n; k++) G[k] = G[k]! + f * arr[k]!;
      });
      for (let k = 0; k < t.xs.length; k++) evalPoint(info, cap, checks, combo.name, G, k * 6);
      // Moment extremes inside intervals, where the shear crosses zero.
      for (let k = 0; k + 1 < t.xs.length; k++) {
        const a = k * 6;
        const b = a + 6;
        const h = t.xs[k + 1]! - t.xs[k]!;
        for (const vi of [1, 2]) {
          const va = G[a + vi]!;
          const vb = G[b + vi]!;
          if (!(va * vb < 0)) continue;
          const s = va / (va - vb);
          const d = s * h;
          for (let c = 0; c < 4; c++) point[c] = G[a + c]! + (G[b + c]! - G[a + c]!) * s;
          // dMy/dx = Vz, dMz/dx = −Vy; V is linear in the interval.
          point[4] = G[a + 4]! + ((G[a + 2]! + point[2]!) / 2) * d;
          point[5] = G[a + 5]! - ((G[a + 1]! + point[1]!) / 2) * d;
          evalPoint(info, cap, checks, combo.name, point, 0);
        }
      }
    });
  }

  // --- Bearing at supports ------------------------------------------------------------
  model.links.forEach((l, li) => {
    if (!l.support || l.tributary === undefined) return;
    const info = model.members.get(l.memberA)!;
    const Fcp = info.material.structural!.Fc_perp_MPa;
    if (!Fcp) return;
    const [ex, ey, ez] = info.line.axes;
    if (Math.abs(dot(ex, l.normal)) > 0.7) return; // end grain: bearing parallel to grain
    const face = Math.abs(dot(ey, l.normal)) > Math.abs(dot(ez, l.normal)) ? info.section.h : info.section.b;
    const checks = memberChecks.get(l.memberA)!;
    for (const combo of combos) {
      let C = 0;
      which.forEach((c, ci) => {
        const f = combo.factors[c] ?? 0;
        if (!f) return;
        const lf = caseSol[ci]!.linkForces;
        C -= f * (lf[li * 6]! * l.normal[0] + lf[li * 6 + 1]! * l.normal[1] + lf[li * 6 + 2]! * l.normal[2]);
      });
      if (C > 0) note(checks, 'bearing', C / (face * l.tributary) / Fcp, combo.name);
    }
  });

  // --- Deflection -----------------------------------------------------------------------
  const deflections = new Map<string, number>();
  for (const [id, info] of model.members) {
    const rule = deflectionRule(info.part.role, assemblyKind(info.part.assemblyId), hasCeiling.get(info.part.assemblyId) ?? false);
    if (!rule || info.linkNodes.size < 2) continue;
    const linked = info.nodes.filter((n) => info.linkNodes.has(n.node));
    const tA = linked[0]!.t;
    const tB = linked[linked.length - 1]!.t;
    const span = tB - tA;
    if (span <= 0) continue;
    const ex = info.line.axes[0];
    for (const kase of rule.cases) {
      const ci = caseIndex.get(kase as BasicCase);
      if (ci === undefined) continue;
      const c = caseSol[ci]!;
      const uA = c.u.subarray(linked[0]!.node * 6, linked[0]!.node * 6 + 3);
      const uB = c.u.subarray(linked[linked.length - 1]!.node * 6, linked[linked.length - 1]!.node * 6 + 3);
      let worst = 0;
      const ue = new Float64Array(12);
      const ul = new Float64Array(12);
      for (const el of info.elements) {
        const e = model.fem.elements[el.index]!;
        if (el.t0 + e.L < tA - 1e-6 || el.t0 > tB + 1e-6) continue;
        for (let k = 0; k < 6; k++) {
          ue[k] = c.u[e.n1 * 6 + k]!;
          ue[6 + k] = c.u[e.n2 * 6 + k]!;
        }
        vecToLocal(ue, e.axes, ul);
        for (const s of [0, 0.25, 0.5, 0.75, 1]) {
          const x = s * e.L;
          const [v, w] = interiorDeflection(ul, c.localLoads[el.index]!, e.props, e.L, x, e.truss);
          const ax = ul[0]! + (ul[6]! - ul[0]!) * s;
          const d: V3 = [
            e.axes[0][0] * ax + e.axes[1][0] * v + e.axes[2][0] * w,
            e.axes[0][1] * ax + e.axes[1][1] * v + e.axes[2][1] * w,
            e.axes[0][2] * ax + e.axes[1][2] * v + e.axes[2][2] * w,
          ];
          const tt = (el.t0 + x - tA) / span;
          const chord = lerp([uA[0]!, uA[1]!, uA[2]!], [uB[0]!, uB[1]!, uB[2]!], tt);
          const rel = sub(d, chord);
          const transverse = sub(rel, scale(ex, dot(rel, ex)));
          worst = Math.max(worst, length(transverse));
        }
      }
      deflections.set(id, Math.max(deflections.get(id) ?? 0, worst));
      note(memberChecks.get(id)!, 'deflection', worst / (span / rule.ratio), kase);
    }
  }

  // --- Instability: runaway displacements ----------------------------------------------
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const n of model.fem.nodes) {
    yMin = Math.min(yMin, n[1]);
    yMax = Math.max(yMax, n[1]);
  }
  const threshold = Math.max((yMax - yMin) / 50, 100);
  const unstableByAsm = new Map<string, Instability>();
  const unstableParts = new Set<string>();
  const flexible = new Map<string, { case: BasicCase; mm: number }>();
  const { krPin } = model.stiffness;
  caseSol.forEach((c, ci) => {
    // A mechanism is held only by the tiny stabilising springs of pinned joints, so they
    // store most of the energy; a structure that is merely flexible stores it in its members.
    let pinEnergy = 0;
    model.fem.links.forEach((l, li) => {
      if (l.kr !== krPin) return;
      const m = c.linkForces.subarray(li * 6 + 3, li * 6 + 6);
      pinEnergy += (m[0]! ** 2 + m[1]! ** 2 + m[2]! ** 2) / (2 * l.kr);
    });
    const mechanism = c.work > 0 && pinEnergy > MECHANISM_ENERGY_SHARE * c.work;
    for (let v = 0; v < model.fem.nodes.length; v++) {
      const d = Math.hypot(c.u[v * 6]!, c.u[v * 6 + 1]!, c.u[v * 6 + 2]!);
      if (!(d > threshold)) continue;
      const partId = model.nodeOwner[v]!;
      if (!mechanism) {
        const asmId = project_.parts[partId]?.assemblyId ?? partId;
        const cur = flexible.get(asmId);
        if (!cur || d > cur.mm) flexible.set(asmId, { case: which[ci]!, mm: d });
        continue;
      }
      unstableParts.add(partId);
      const asmId = project_.parts[partId]?.assemblyId ?? partId;
      const cur = unstableByAsm.get(asmId);
      if (!cur) {
        unstableByAsm.set(asmId, { assemblyId: asmId, partIds: [partId], case: which[ci]!, displacement_mm: d, message: '' });
      } else {
        if (!cur.partIds.includes(partId)) cur.partIds.push(partId);
        if (d > cur.displacement_mm) {
          cur.displacement_mm = d;
          cur.case = which[ci]!;
        }
      }
    }
  });
  // Walls: racking is the in-plane drift of the top plates against the bottom plate.
  for (const asm of Object.values(project_.assemblies)) {
    if (asm.kind !== 'wall' || unstableByAsm.has(asm.id)) continue;
    const plates = [...model.members.values()].filter((m) => m.part.assemblyId === asm.id && m.part.role === 'plate');
    const bottom = plates.filter((m) => m.part.tags.includes('bottom'));
    const top = plates.filter((m) => m.part.tags.includes('top') || m.part.tags.includes('top-cap'));
    if (!bottom.length || !top.length) continue;
    const dir = bottom.reduce((best, m) => (m.line.length > best.line.length ? m : best)).line.axes[0];
    const meanAlong = (ms: MemberInfo[], u: Float64Array) => {
      let s = 0;
      let n = 0;
      for (const m of ms) for (const nd of m.nodes) {
        s += u[nd.node * 6]! * dir[0] + u[nd.node * 6 + 1]! * dir[1] + u[nd.node * 6 + 2]! * dir[2];
        n++;
      }
      return n ? s / n : 0;
    };
    caseSol.forEach((c, ci) => {
      const drift = Math.abs(meanAlong(top, c.u) - meanAlong(bottom, c.u));
      if (!(drift > threshold)) return;
      const cur = unstableByAsm.get(asm.id);
      if (cur && cur.displacement_mm >= drift) return;
      const ids = [...model.members.values()].filter((m) => m.part.assemblyId === asm.id).map((m) => m.part.id);
      for (const id of ids) unstableParts.add(id);
      unstableByAsm.set(asm.id, { assemblyId: asm.id, partIds: ids, case: which[ci]!, displacement_mm: drift, message: '' });
    });
  }
  for (const [asmId, f] of flexible) {
    if (unstableByAsm.has(asmId)) continue;
    warnings.push(`${asmId} moves about ${Math.round(f.mm)} mm under ${f.case}: it stands, but it is very flexible.`);
  }
  const unstable = [...unstableByAsm.values()].map((u) => {
    const kind = assemblyKind(u.assemblyId);
    const mm = Number.isFinite(u.displacement_mm) ? Math.round(u.displacement_mm) : Infinity;
    const message =
      kind === 'wall'
        ? `${u.assemblyId} racks: it needs sheathing or a let-in brace (it moves about ${mm} mm under ${u.case}).`
        : `${u.assemblyId} is unstable: it moves about ${mm} mm under ${u.case}. It needs bracing or stiffer joints.`;
    return { ...u, displacement_mm: Number.isFinite(u.displacement_mm) ? u.displacement_mm : UTIL_CAP * 1e3, message };
  });

  // --- Panels ---------------------------------------------------------------------------
  const panelUtil = new Map<string, { utilization: number; combo: string }>();
  for (const [id, p] of model.panels) {
    const checks: Checks = {};
    const k = p.shearPanel;
    if (k !== undefined) {
      const sp = p.material!.shearPanel!;
      for (const combo of combos) {
        let strain = 0;
        which.forEach((c, ci) => {
          const f = combo.factors[c] ?? 0;
          if (f) strain += f * caseSol[ci]!.panelStrain[k]!;
        });
        note(checks, 'panel-shear', panelUnitShear(sp.Ga_N_per_mm, strain) / sp.vAllowable_N_per_mm, combo.name);
      }
      const cur = checks['panel-shear'];
      if (cur) panelUtil.set(id, cur);
    }
    parts[id] = {
      id,
      role: 'panel',
      ...governing(checks),
      checks,
      ...(k !== undefined ? {} : { note: 'Carries its own weight and area loads to the framing; not a brace.' }),
    };
  }

  // --- Part results ------------------------------------------------------------------
  for (const [id, info] of model.members) {
    const checks = memberChecks.get(id)!;
    const d = deflections.get(id);
    parts[id] = {
      id,
      role: info.truss ? 'truss' : 'member',
      ...governing(checks),
      checks,
      ...(d !== undefined ? { deflection_mm: d } : {}),
      ...(unstableParts.has(id) ? { unstable: true } : {}),
      ...(info.elements.length === 0 ? { note: 'Not enough joints along it to carry load.' } : {}),
    };
  }
  for (const p of Object.values(project_.parts)) {
    if (parts[p.id]) continue;
    const role = model.roles.get(p.id) ?? 'mass-only';
    parts[p.id] = {
      id: p.id,
      role,
      utilization: 0,
      checks: {},
      note:
        role === 'ground'
          ? 'Concrete on the ground: treated as rigid support.'
          : role === 'not-connected'
            ? 'Not connected to the ground; not analysed.'
            : 'Weight only: no stiffness in the model.',
    };
  }

  // --- Joints ---------------------------------------------------------------------------
  const linksByJoint = new Map<string, number[]>();
  model.links.forEach((l, i) => {
    const list = linksByJoint.get(l.jointId);
    if (list) list.push(i);
    else linksByJoint.set(l.jointId, [i]);
  });
  const jointsOfPart = new Map<string, number>();
  for (const j of Object.values(project_.joints)) {
    for (const p of j.partIds) if (p !== GROUND) jointsOfPart.set(p, (jointsOfPart.get(p) ?? 0) + 1);
  }
  const deadOnly = combos.find((c) => c.name === 'D') ?? ({ name: 'D', CD: 0.9, factors: { D: 1 } } satisfies LoadCombination);

  for (const j of Object.values(project_.joints)) {
    const type = idx.jointTypes.get(j.jointTypeId);
    const notes: string[] = [];
    if (!type) {
      joints[j.id] = { id: j.id, utilization: 0, forces_N: { shear: 0, withdrawal: 0, uplift: 0 }, capacity_N: {}, notes: ['Joint type not in the catalog; not checked.'] };
      continue;
    }
    const li = linksByJoint.get(j.id);
    if (li?.length) {
      let best: JointResult | null = null;
      let missingWithdrawal = false;
      for (const combo of combos) {
        let F: V3 = [0, 0, 0];
        which.forEach((c, ci) => {
          const f = combo.factors[c] ?? 0;
          if (!f) return;
          const lf = caseSol[ci]!.linkForces;
          for (const i of li) F = [F[0] + f * lf[i * 6]!, F[1] + f * lf[i * 6 + 1]!, F[2] + f * lf[i * 6 + 2]!];
        });
        const first = model.links[li[0]!]!;
        const onFirst = first.aIsFirst ? F : scale(F, -1);
        const normal = first.aIsFirst ? first.normal : scale(first.normal, -1);
        const forces = resolveJointForce(onFirst, normal);
        const cap = jointCapacity(j, type, combo.CD);
        if (cap.withdrawal === undefined && forces.withdrawal > 1) missingWithdrawal = true;
        const r = checkJoint(forces, cap);
        if (!best || r.utilization > best.utilization) {
          best = { id: j.id, utilization: r.utilization, governing: { check: r.check, combo: combo.name }, forces_N: forces, capacity_N: cap, notes };
        }
      }
      if (missingWithdrawal) notes.push(`No withdrawal capacity for ${type.name} in the catalog, so withdrawal isn't checked.`);
      joints[j.id] = best ?? { id: j.id, utilization: 0, forces_N: { shear: 0, withdrawal: 0, uplift: 0 }, capacity_N: {}, notes };
      continue;
    }
    // Not a link: a sheet or a mass-only part hanging on the framing, or concrete on concrete.
    const [a, b] = j.partIds;
    const roleA = model.roles.get(a);
    const roleB = b === GROUND ? 'ground' : model.roles.get(b);
    if ((roleA === 'ground' || a === GROUND) && roleB === 'ground') {
      joints[j.id] = { id: j.id, utilization: 0, forces_N: { shear: 0, withdrawal: 0, uplift: 0 }, capacity_N: {}, notes: ['Concrete to concrete or to the ground: treated as rigid.'] };
      continue;
    }
    if (roleA === 'not-connected' || roleB === 'not-connected') {
      joints[j.id] = { id: j.id, utilization: 0, forces_N: { shear: 0, withdrawal: 0, uplift: 0 }, capacity_N: {}, notes: ['Joins a part that is not connected to the ground; not analysed.'] };
      continue;
    }
    const carried = [a, b].find((p) => caseLoads.weights.has(p));
    let result: JointResult = { id: j.id, utilization: 0, forces_N: { shear: 0, withdrawal: 0, uplift: 0 }, capacity_N: {}, notes };
    if (carried) {
      const share = caseLoads.weights.get(carried)! / Math.max(1, jointsOfPart.get(carried) ?? 1);
      const cap = jointCapacity(j, type, deadOnly.CD);
      const forces: JointForces = { shear: share, withdrawal: 0, uplift: 0 };
      const r = checkJoint(forces, cap);
      result = { id: j.id, utilization: r.utilization, governing: { check: r.check, combo: deadOnly.name }, forces_N: forces, capacity_N: cap, notes };
      notes.push(`Carries an equal share of ${carried}'s weight.`);
    }
    const panel = [a, b].find((p) => panelUtil.has(p));
    if (panel) {
      const pu = panelUtil.get(panel)!;
      notes.push(`Checked with ${panel}'s unit shear (the nailing schedule's allowable).`);
      if (pu.utilization > result.utilization) result = { ...result, utilization: pu.utilization, governing: { check: 'panel-shear', combo: pu.combo } };
    }
    if (!carried && !panel) notes.push('No force path through this joint in the model.');
    joints[j.id] = result;
  }

  stats.ms = now() - start;
  const budget = options.perfBudget ?? DEFAULT_PERF_BUDGET_MS;
  if (stats.ms > budget) warnings.push(`The analysis took ${Math.round(stats.ms)} ms, over the ${budget} ms budget.`);
  return { ...baseResult(), unstable };
}

export type { AnalyticalModel };
