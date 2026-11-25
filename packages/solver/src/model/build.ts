/**
 * Project + catalog → analytical model.
 *
 * - Frame members: parts whose material has `structural` values, except sheathing. A
 *   `brace:diagonal` part is a truss (axial only).
 * - Rigid ground: concrete or masonry joined to GROUND, and concrete/masonry joined to
 *   that (a slab cast onto its footings). A joint to it, or to GROUND, is a support.
 * - Panels: sheathing. A `brace:panel` sheet whose material has `shearPanel` becomes a
 *   pure-shear panel element between nodes snapped onto the framing it is nailed to
 *   (see fem/panel.ts for why not an X of diagonals).
 * - Everything else is mass only: its weight passes through its joints to the framing.
 *
 * Each joint between two members is a link element between the joint's projections onto
 * the two centrelines. A member resting on rigid ground (a plate on a slab) bears along
 * the strip the ground part covers, so it is supported at every node in that strip, not
 * just at its anchor bolts.
 */
import { GROUND, type CatalogIndex, type Joint, type JointType, type Material, type Part, type Project } from '@slapdash/core';
import type { V3 } from '../fem/element.ts';
import type { FemPanel } from '../fem/panel.ts';
import type { FemElement, FemLink, FemModel } from '../fem/solve.ts';
import type { PartAnalysisRole } from '../types.ts';
import {
  centreline,
  closestOnBox,
  cross,
  dot,
  fromVec,
  length,
  overlapInterval,
  partAxes,
  pointAt,
  project as projectOnto,
  sheetCorners,
  sub,
  unit,
  type Centreline,
} from './geometry.ts';
import { memberSection, type MemberSection } from './section.ts';

/** Link stiffness relative to the stiffest member (EA/L or EI/L). */
export const LINK_ALPHA = 1e4;
/** A pinned joint's rotational spring relative to a fixed one's. */
export const PIN_RATIO = 1e-9;
/** Nodes on one member closer than this are one node, mm. */
export const NODE_TOLERANCE = 1;
/** Largest gap between bearing supports along a member resting on rigid ground, mm. */
export const BEARING_SPACING = 406.4;
/** Largest gap between link points along a lap of two parallel members, mm. */
export const LAP_SPACING = 406.4;
/** Members this close to parallel (|cos|) that overlap along their length are lapped. */
const LAP_COS = 0.95;

/**
 * The stretch of A (t along A) where B lies alongside it, when the two are parallel and
 * overlap by more than either's depth; otherwise null.
 */
function lapInterval(A: MemberInfo, B: MemberInfo): [number, number] | null {
  if (Math.abs(dot(A.line.axes[0], B.line.axes[0])) < LAP_COS) return null;
  const [lo, hi] = overlapInterval(A.line, B.part);
  const depth = Math.max(A.section.b, A.section.h, B.section.b, B.section.h);
  return hi - lo > depth ? [lo, hi] : null;
}

/** A joint whose point is this far beyond the parts' sections gets a warning, mm. */
const FAR_JOINT_MM = 100;
/** Wood shear modulus as a fraction of E (NDS commentary: G ≈ E/16). */
export const G_OVER_E = 1 / 16;

export interface MemberInfo {
  part: Part;
  material: Material;
  section: MemberSection;
  line: Centreline;
  truss: boolean;
  /** Nodes along the member, sorted by t once the model is built. */
  nodes: Array<{ t: number; node: number }>;
  /** Element indices in order along the member, with the t of each element's first node. */
  elements: Array<{ index: number; t0: number }>;
  /** Nailed to a bracing sheet, so braced about its weak axis. */
  sheathed: boolean;
  /** Nodes where a joint or support attaches. */
  linkNodes: Set<number>;
}

export interface PanelInfo {
  part: Part;
  material: Material | undefined;
  /** The frame members it is nailed to. */
  carriers: string[];
  /** Index into `fem.panels` when the sheet braces. */
  shearPanel?: number;
  /** Panel size along its local x (b) and y (h), mm. */
  b: number;
  h: number;
}

export interface LinkInfo {
  jointId: string;
  /** The member on side A of the FEM link. */
  memberA: string;
  /** The member on side B, or the ground part / GROUND for a support. */
  otherB: string;
  support: boolean;
  /** True when side A is the joint's partIds[0]. */
  aIsFirst: boolean;
  /** Unit contact normal from A towards B. */
  normal: V3;
  /** For bearing supports: the length of member this support stands for, mm. */
  tributary?: number;
}

export interface AnalyticalModel {
  project: Project;
  catalog: CatalogIndex;
  fem: FemModel;
  members: Map<string, MemberInfo>;
  panels: Map<string, PanelInfo>;
  /** Parallel to `fem.links`. */
  links: LinkInfo[];
  /** Parallel to `fem.elements`: the member and the t of the element's first node. */
  elementOwner: Array<{ partId: string; t0: number }>;
  /** The part each node is on. */
  nodeOwner: string[];
  roles: Map<string, PartAnalysisRole>;
  /** Joined parts per part (GROUND excluded). */
  neighbours: Map<string, string[]>;
  warnings: string[];
  stiffness: { kt: number; krFixed: number; krPin: number };
}

const RIGID_CATEGORIES = new Set(['concrete', 'masonry']);

export class UnionFind {
  private parent = new Map<string, string>();
  find(a: string): string {
    let p = this.parent.get(a) ?? a;
    if (p === a) return a;
    p = this.find(p);
    this.parent.set(a, p);
    return p;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function listParts(ids: string[], max = 6): string {
  return ids.length <= max ? ids.join(', ') : `${ids.slice(0, max).join(', ')} and ${ids.length - max} more`;
}

/**
 * Rigid ground: concrete or masonry joined to GROUND, then concrete or masonry joined to
 * that (a slab, its footings, piers). The solver treats them as supports and the
 * stability sim as fixed bodies.
 */
export function rigidGroundParts(project: Project, catalog: CatalogIndex, neighbours?: Map<string, string[]>): Set<string> {
  const joints = Object.values(project.joints);
  if (!neighbours) {
    neighbours = new Map();
    for (const j of joints) {
      const [a, b] = j.partIds;
      if (a === GROUND || b === GROUND || !project.parts[a] || !project.parts[b]) continue;
      (neighbours.get(a) ?? neighbours.set(a, []).get(a)!).push(b);
      (neighbours.get(b) ?? neighbours.set(b, []).get(b)!).push(a);
    }
  }
  const rigid = new Set<string>();
  const isRigidCandidate = (p: Part | undefined) => !!p && RIGID_CATEGORIES.has(catalog.materials.get(p.materialId)?.category ?? '');
  const queue: string[] = [];
  for (const j of joints) {
    const [a, b] = j.partIds;
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      if (y === GROUND && isRigidCandidate(project.parts[x]) && !rigid.has(x)) {
        rigid.add(x);
        queue.push(x);
      }
    }
  }
  while (queue.length) {
    const id = queue.pop()!;
    for (const n of neighbours.get(id) ?? []) {
      if (!rigid.has(n) && isRigidCandidate(project.parts[n])) {
        rigid.add(n);
        queue.push(n);
      }
    }
  }
  return rigid;
}

export function buildModel(project: Project, catalog: CatalogIndex): AnalyticalModel {
  const warnings: string[] = [];
  const parts = Object.values(project.parts);
  const joints = Object.values(project.joints);
  const mat = (p: Part) => catalog.materials.get(p.materialId);

  const neighbours = new Map<string, string[]>();
  for (const p of parts) neighbours.set(p.id, []);
  for (const j of joints) {
    const [a, b] = j.partIds;
    if (a !== GROUND && b !== GROUND && neighbours.has(a) && neighbours.has(b)) {
      neighbours.get(a)!.push(b);
      neighbours.get(b)!.push(a);
    }
  }

  const rigid = rigidGroundParts(project, catalog, neighbours);

  // Classify.
  const roles = new Map<string, PartAnalysisRole>();
  const skipped: Record<string, string[]> = {};
  const skip = (why: string, id: string) => (skipped[why] ??= []).push(id);
  for (const p of parts) {
    const m = mat(p);
    if (rigid.has(p.id)) roles.set(p.id, 'ground');
    else if (p.role === 'sheathing') roles.set(p.id, 'panel');
    else if (m?.structural && p.size.length > NODE_TOLERANCE && p.size.width > 0 && p.size.height > 0) {
      roles.set(p.id, p.tags.includes('brace:diagonal') ? 'truss' : 'member');
    } else {
      roles.set(p.id, 'mass-only');
      if (!m) skip('its material is not in the catalog', p.id);
      else if (RIGID_CATEGORIES.has(m.category)) skip('concrete or masonry not on the ground', p.id);
      else skip(`${m.category} has no beam values`, p.id);
    }
  }
  const isFrame = (id: string) => roles.get(id) === 'member' || roles.get(id) === 'truss';
  const isSupport = (id: string) => id === GROUND || roles.get(id) === 'ground';

  // Bracing panels.
  const bracePanels = new Set<string>();
  const unrated: string[] = [];
  for (const p of parts) {
    if (roles.get(p.id) !== 'panel' || !p.tags.includes('brace:panel')) continue;
    if (mat(p)?.shearPanel) bracePanels.add(p.id);
    else unrated.push(p.id);
  }
  if (unrated.length) {
    warnings.push(
      `${listParts(unrated)}: the sheet material has no shear-panel values (shearPanel in the catalog), so ${unrated.length === 1 ? 'it carries' : 'they carry'} load but brace nothing.`,
    );
  }

  // Connectivity to the ground.
  const uf = new UnionFind();
  for (const j of joints) {
    const [a, b] = j.partIds;
    const ok = (id: string) => isFrame(id) || isSupport(id);
    if (ok(a) && ok(b)) uf.union(isSupport(a) ? GROUND : a, isSupport(b) ? GROUND : b);
  }
  for (const id of bracePanels) {
    const frames = (neighbours.get(id) ?? []).filter(isFrame);
    for (let i = 1; i < frames.length; i++) uf.union(frames[0]!, frames[i]!);
  }
  const groundRoot = uf.find(GROUND);
  const loose: string[] = [];
  for (const p of parts) {
    if (isFrame(p.id) && uf.find(p.id) !== groundRoot) {
      roles.set(p.id, 'not-connected');
      loose.push(p.id);
    }
  }
  if (loose.length) warnings.push(`${listParts(loose)}: not connected to the ground through any joint, so not analysed.`);
  for (const [why, ids] of Object.entries(skipped)) {
    warnings.push(`Carried as weight only (no stiffness): ${listParts(ids)}, because ${why}.`);
  }

  // Members.
  const nodes: V3[] = [];
  const nodeOwner: string[] = [];
  const members = new Map<string, MemberInfo>();
  let maxAxial = 0;
  let maxBending = 0;
  for (const p of parts) {
    if (!isFrame(p.id)) continue;
    const m = mat(p)!;
    const section = memberSection(p, p.sectionId ? catalog.sections.get(p.sectionId) : undefined);
    const line = centreline(p);
    const E = m.structural!.E_MPa;
    maxAxial = Math.max(maxAxial, (E * section.A) / line.length);
    maxBending = Math.max(maxBending, (E * Math.max(section.Iy, section.Iz)) / line.length);
    members.set(p.id, {
      part: p,
      material: m,
      section,
      line,
      truss: roles.get(p.id) === 'truss',
      nodes: [],
      elements: [],
      // A ceiling joist is held about its weak axis by the ceiling below it.
      sheathed: (neighbours.get(p.id) ?? []).some((n) => bracePanels.has(n)) || p.tags.includes('ceiling-joist'),
      linkNodes: new Set(),
    });
  }
  const kt = LINK_ALPHA * maxAxial;
  const krFixed = LINK_ALPHA * maxBending;
  const krPin = PIN_RATIO * krFixed;

  const addNode = (id: string, t: number): number => {
    const info = members.get(id)!;
    const tc = Math.max(0, Math.min(info.line.length, t));
    for (const n of info.nodes) if (Math.abs(n.t - tc) <= NODE_TOLERANCE) return n.node;
    nodes.push(pointAt(info.line, tc));
    nodeOwner.push(id);
    const node = nodes.length - 1;
    info.nodes.push({ t: tc, node });
    return node;
  };
  for (const [id, info] of members) {
    if (info.truss) continue;
    addNode(id, 0);
    addNode(id, info.line.length);
  }

  const femLinks: FemLink[] = [];
  const links: LinkInfo[] = [];
  const jointType = (id: string): JointType | undefined => catalog.jointTypes.get(id);
  const unknownJoints: string[] = [];
  const farJoints: string[] = [];
  const laps = new Map<string, { a: string; b: string; interval: [number, number]; joints: Array<{ joint: Joint; t: number; kr: number }> }>();
  const bearing: Array<{ jointId: string; member: string; ground: string; node: number; aIsFirst: boolean; kr: number }> = [];

  for (const j of joints) {
    const jt = jointType(j.jointTypeId);
    if (!jt) {
      unknownJoints.push(j.id);
      continue;
    }
    const kr = jt.behaviour === 'fixed' ? krFixed : krPin;
    const [p0, p1] = j.partIds;
    const at = fromVec(j.at);
    if (members.has(p0) && members.has(p1)) {
      if (p0 === p1) continue;
      const A = members.get(p0)!;
      const B = members.get(p1)!;
      const lap = lapInterval(A, B);
      if (lap) {
        const key = `${p0}|${p1}`;
        const group = laps.get(key) ?? { a: p0, b: p1, interval: lap, joints: [] };
        group.joints.push({ joint: j, t: projectOnto(A.line, at).t, kr });
        laps.set(key, group);
        continue;
      }
      const ta = projectOnto(A.line, at).t;
      const tb = projectOnto(B.line, at).t;
      const na = addNode(p0, ta);
      const nb = addNode(p1, tb);
      A.linkNodes.add(na);
      B.linkNodes.add(nb);
      let normal = sub(nodes[nb]!, nodes[na]!);
      if (length(normal) < NODE_TOLERANCE) normal = cross(A.line.axes[0], B.line.axes[0]);
      if (length(normal) < 1e-9) normal = A.line.axes[2];
      const rA = sub(at, nodes[na]!);
      const rB = sub(at, nodes[nb]!);
      const far = Math.max(length(rA) - Math.max(A.section.b, A.section.h), length(rB) - Math.max(B.section.b, B.section.h));
      if (far > FAR_JOINT_MM) farJoints.push(j.id);
      femLinks.push({ a: na, b: nb, kt, kr, rA, rB });
      links.push({ jointId: j.id, memberA: p0, otherB: p1, support: false, aIsFirst: true, normal: unit(normal) });
      continue;
    }
    // A support: one side a member, the other GROUND or rigid ground.
    const pairs: Array<[string, string, boolean]> = [
      [p0, p1, true],
      [p1, p0, false],
    ];
    for (const [m, g, aIsFirst] of pairs) {
      if (!members.has(m) || !isSupport(g)) continue;
      const info = members.get(m)!;
      const node = addNode(m, projectOnto(info.line, at).t);
      info.linkNodes.add(node);
      if (g === GROUND) {
        femLinks.push({ a: node, b: -1, kt, kr, rA: sub(at, nodes[node]!) });
        links.push({ jointId: j.id, memberA: m, otherB: g, support: true, aIsFirst, normal: [0, -1, 0] });
      } else {
        bearing.push({ jointId: j.id, member: m, ground: g, node, aIsFirst, kr });
      }
    }
  }
  // Laps: each joint between two parallel members covers its share of their overlap,
  // with link points along it as the nails would be.
  for (const g of laps.values()) {
    const A = members.get(g.a)!;
    const B = members.get(g.b)!;
    g.joints.sort((x, y) => x.t - y.t);
    const [lo, hi] = g.interval;
    g.joints.forEach((jj, i) => {
      const from = i === 0 ? lo : Math.max(lo, (g.joints[i - 1]!.t + jj.t) / 2);
      const to = i === g.joints.length - 1 ? hi : Math.min(hi, (jj.t + g.joints[i + 1]!.t) / 2);
      const count = Math.max(1, Math.ceil((to - from) / LAP_SPACING));
      const ts = count === 1 && to - from < LAP_SPACING / 2 ? [(from + to) / 2] : Array.from({ length: count + 1 }, (_, k) => from + ((to - from) * k) / count);
      // The point nearest the joint passes slip along the members; the rest only hold them together.
      const primary = ts.reduce((best, t) => (Math.abs(t - jj.t) < Math.abs(best - jj.t) ? t : best), ts[0]!);
      for (const t of ts) {
        const na = addNode(g.a, t);
        const pa = nodes[na]!;
        const nb = addNode(g.b, projectOnto(B.line, pa).t);
        const pb = nodes[nb]!;
        const c: V3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
        A.linkNodes.add(na);
        B.linkNodes.add(nb);
        let normal = sub(pb, pa);
        if (length(normal) < NODE_TOLERANCE) normal = A.line.axes[2];
        femLinks.push({ a: na, b: nb, kt, kr: jj.kr, rA: sub(c, pa), rB: sub(c, pb), ...(t === primary ? {} : { release: A.line.axes[0] }) });
        links.push({ jointId: jj.joint.id, memberA: g.a, otherB: g.b, support: false, aIsFirst: true, normal: unit(normal) });
      }
    });
  }
  if (farJoints.length) {
    warnings.push(`${listParts(farJoints)}: the joint's point is well away from the parts it joins; it is modelled with a rigid arm to it.`);
  }
  if (unknownJoints.length) warnings.push(`${listParts(unknownJoints)}: joint type not in the catalog, so the joint is ignored.`);

  // Shear panels between nodes snapped onto the framing.
  const panels = new Map<string, PanelInfo>();
  const femPanels: FemPanel[] = [];
  for (const p of parts) {
    if (roles.get(p.id) !== 'panel') continue;
    const carriers = [...new Set((neighbours.get(p.id) ?? []).filter((n) => members.has(n)))];
    const info: PanelInfo = { part: p, material: mat(p), carriers, b: p.size.length, h: p.size.width };
    panels.set(p.id, info);
    if (!bracePanels.has(p.id) || carriers.length === 0) continue;
    const snapped = sheetCorners(p).map((c) => {
      let best: { id: string; t: number; d: number } | null = null;
      for (const id of carriers) {
        const pr = projectOnto(members.get(id)!.line, c);
        if (!best || pr.distance < best.d) best = { id, t: pr.t, d: pr.distance };
      }
      return addNode(best!.id, best!.t);
    }) as [number, number, number, number];
    if (new Set(snapped).size < 3) continue;
    const [ex, ey] = partAxes(p);
    info.shearPanel = femPanels.length;
    femPanels.push({ nodes: snapped, ex, ey, b: info.b, h: info.h, Ga: mat(p)!.shearPanel!.Ga_N_per_mm });
  }

  // Bearing strips on rigid ground.
  for (const s of bearing) {
    const info = members.get(s.member)!;
    const ground = project.parts[s.ground]!;
    let [lo, hi] = overlapInterval(info.line, ground);
    const tj = info.nodes.find((n) => n.node === s.node)!.t;
    if (!(hi - lo > NODE_TOLERANCE) || tj < lo - NODE_TOLERANCE || tj > hi + NODE_TOLERANCE) {
      lo = tj;
      hi = tj;
    }
    if (hi > lo) {
      addNode(s.member, lo);
      addNode(s.member, hi);
      const inStrip = () =>
        info.nodes
          .filter((n) => n.t >= lo - NODE_TOLERANCE && n.t <= hi + NODE_TOLERANCE)
          .map((n) => n.t)
          .sort((a, b) => a - b);
      const ts = inStrip();
      for (let i = 1; i < ts.length; i++) {
        const gap = ts[i]! - ts[i - 1]!;
        const extra = Math.ceil(gap / BEARING_SPACING) - 1;
        for (let k = 1; k <= extra; k++) addNode(s.member, ts[i - 1]! + (gap * k) / (extra + 1));
      }
    }
    const strip = info.nodes.filter((n) => n.t >= lo - NODE_TOLERANCE && n.t <= hi + NODE_TOLERANCE).sort((a, b) => a.t - b.t);
    strip.forEach((n, i) => {
      const left = i > 0 ? (n.t - strip[i - 1]!.t) / 2 : n.t - lo;
      const right = i < strip.length - 1 ? (strip[i + 1]!.t - n.t) / 2 : hi - n.t;
      const pos = nodes[n.node]!;
      let normal = sub(closestOnBox(ground, pos), pos);
      normal = length(normal) > NODE_TOLERANCE ? unit(normal) : [0, -1, 0];
      info.linkNodes.add(n.node);
      femLinks.push({ a: n.node, b: -1, kt, kr: s.kr });
      links.push({
        jointId: s.jointId,
        memberA: s.member,
        otherB: s.ground,
        support: true,
        aIsFirst: s.aIsFirst,
        normal,
        tributary: Math.max(left + right, info.section.b),
      });
    });
  }

  // Member elements between consecutive nodes.
  const femElements: FemElement[] = [];
  const elementOwner: AnalyticalModel['elementOwner'] = [];
  for (const [id, info] of members) {
    info.nodes.sort((a, b) => a.t - b.t);
    const E = info.material.structural!.E_MPa;
    const props = { E, G: E * G_OVER_E, A: info.section.A, Iy: info.section.Iy, Iz: info.section.Iz, J: info.section.J };
    for (let i = 1; i < info.nodes.length; i++) {
      const a = info.nodes[i - 1]!;
      const b = info.nodes[i]!;
      const L = b.t - a.t;
      if (L <= 0) continue;
      info.elements.push({ index: femElements.length, t0: a.t });
      femElements.push({ n1: a.node, n2: b.node, axes: info.line.axes, L, props, truss: info.truss });
      elementOwner.push({ partId: id, t0: a.t });
    }
    if (info.truss && info.elements.length === 0) {
      warnings.push(`${id}: a brace needs joints at two points along it to carry anything; it is not analysed.`);
    }
  }

  return {
    project,
    catalog,
    fem: { nodes, elements: femElements, links: femLinks, panels: femPanels },
    members,
    panels,
    links,
    elementOwner,
    nodeOwner,
    roles,
    neighbours,
    warnings,
    stiffness: { kt, krFixed, krPin },
  };
}

