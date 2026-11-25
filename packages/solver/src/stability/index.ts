/**
 * "Will it tip over?" (ADR-0001 §5, ADR-0002 §E6): an on-demand rigid-body sim with
 * Rapier. It reads the same parts-and-joints model and the same pinned/fixed joint flags
 * as the frame solver.
 *
 * - Each part is a cuboid matching its box, with the material's density (500 kg/m³ when
 *   the catalog has none).
 * - Parts joined by `fixed` joints are merged into one compound body. Rigid ground
 *   (concrete or masonry on the ground) and anything fixed to it is one fixed body.
 * - `pinned` joints are spherical joints at `joint.at`; joints to GROUND anchor to the
 *   fixed body. A sheet's joint to a member stands for a line of nails along the member,
 *   so it gets two spherical joints, at the ends of the stretch the sheet covers (one
 *   point per member would let a sheet nailed across rafters hinge about that line).
 *   Member-to-member pins sit on the longer member's centreline, as the frame solver
 *   joins members at their centrelines (eccentricity ignored).
 * - Parts don't collide with each other (they touch and overlap where they're fastened);
 *   a ground plane a little below the lowest part catches anything that falls.
 * - Gravity gets a small sideways part (a notional load, 2% of g by default) so a
 *   mechanism that is balanced on a knife edge still shows itself.
 *
 * Verdict: `collapses` when two joined bodies turn against each other (a wall racking, a
 * rafter folding) or a loose part falls; `tips` when bodies turn but stay together (a
 * post on a pinned base); otherwise `stable`. Joints don't break in v1.
 *
 * Rapier (Apache-2.0) is loaded lazily on the first call, so `@slapdash/solver` itself
 * never pulls in the WASM.
 */
import { GROUND, indexCatalog, isCatalogIndex, partBox, type Catalog, type CatalogIndex, type Project } from '@slapdash/core';
import type { V3 } from '../fem/element.ts';
import { UnionFind, rigidGroundParts } from '../model/build.ts';
import { centreline, overlapInterval, pointAt, project as projectOnto } from '../model/geometry.ts';

type Rapier = typeof import('@dimforge/rapier3d-compat').default;

let rapier: Promise<Rapier> | undefined;
/** Load and initialise Rapier once. */
export function loadRapier(): Promise<Rapier> {
  rapier ??= import('@dimforge/rapier3d-compat').then(async (mod) => {
    const R = ((mod as { default?: Rapier }).default ?? mod) as Rapier;
    await R.init();
    return R;
  });
  return rapier;
}

export interface StabilityOptions {
  /** Simulated time, s. Default 3. */
  duration_s?: number;
  /** Fixed timestep, s. Default 1/60. */
  dt_s?: number;
  /** Rapier solver iterations. Default 8 (at least 8 is used). */
  solverIterations?: number;
  /** Sideways part of gravity as a fraction of g (a notional load). Default 0.02. */
  lateral?: number;
  /** Plan direction of the sideways part. Default { x: 1, z: 1 } (both wall directions). */
  lateralDirection?: { x: number; z: number };
  /** Record every part's pose every this many steps, for playback. Default 0 (off). */
  recordEvery?: number;
}

export type StabilityVerdict = 'stable' | 'tips' | 'collapses';

export interface MovedPart {
  id: string;
  /** How far the part's centre moved, mm. */
  displacement_mm: number;
  /** How far the part turned, degrees. */
  rotation_deg: number;
}

/** A part's pose: box centre (mm) and its rotation since the start (quaternion x, y, z, w). */
export type PartPose = [number, number, number, number, number, number, number];

export interface StabilityFrame {
  t_s: number;
  parts: Record<string, PartPose>;
}

export interface StabilityResult {
  verdict: StabilityVerdict;
  /** Plain words for the person and for Claude. */
  message: string;
  /** Parts that moved more than 10 mm or turned more than 1°, worst first. */
  movedParts: MovedPart[];
  stats: { bodies: number; joints: number; steps: number; ms: number };
  warnings: string[];
  frames?: StabilityFrame[];
}

/** A part counts as moved past these. */
export const MOVED_MM = 10;
export const MOVED_DEG = 1;
/** Turning past this is tipping (whole bodies) or collapsing (joined bodies against each other). */
export const TIP_DEG = 5;
/** A part that isn't held by any joint and moves this far has fallen. */
const FALL_MM = 100;
const DEFAULT_DENSITY = 500;
const MM = 1e-3;
const G = 9.80665;

type Quat = [number, number, number, number];

/** Quaternion (x, y, z, w) of the rotation whose columns are the given axes. */
function quatFromAxes(ax: readonly { x: number; y: number; z: number }[]): Quat {
  const [X, Y, Z] = ax as [{ x: number; y: number; z: number }, { x: number; y: number; z: number }, { x: number; y: number; z: number }];
  const m00 = X.x, m10 = X.y, m20 = X.z;
  const m01 = Y.x, m11 = Y.y, m21 = Y.z;
  const m02 = Z.x, m12 = Z.y, m22 = Z.z;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Angle of a unit quaternion, degrees. */
const angleDeg = (q: { w: number }) => (2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180) / Math.PI;

/** Rotate v by unit quaternion q. */
function rotate(q: { x: number; y: number; z: number; w: number }, v: [number, number, number]): [number, number, number] {
  const { x, y, z, w } = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

/** Angle between two body rotations (both from identity), degrees. */
function relativeDeg(a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }): number {
  // w of conj(a)·b
  const w = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  return angleDeg({ w });
}

function list(ids: string[], max = 4): string {
  return ids.length <= max ? ids.join(', ') : `${ids.slice(0, max).join(', ')} and ${ids.length - max} more`;
}

export async function simulateStability(project: Project, catalog: Catalog | CatalogIndex, options: StabilityOptions = {}): Promise<StabilityResult> {
  const R = await loadRapier();
  const clock = (globalThis as { performance?: { now(): number } }).performance;
  const start = clock ? clock.now() : Date.now();
  const idx = isCatalogIndex(catalog) ? catalog : indexCatalog(catalog);
  const warnings: string[] = [];
  const parts = Object.values(project.parts);
  const joints = Object.values(project.joints);

  // --- Bodies: union-find over fixed joints; rigid ground joins GROUND ------------------
  const uf = new UnionFind();
  const rigid = rigidGroundParts(project, idx);
  for (const id of rigid) uf.union(id, GROUND);
  const unknownTypes = new Set<string>();
  const behaviour = (jointTypeId: string) => {
    const t = idx.jointTypes.get(jointTypeId);
    if (!t) unknownTypes.add(jointTypeId);
    return t?.behaviour ?? 'pinned';
  };
  for (const j of joints) {
    const [a, b] = j.partIds;
    if (!project.parts[a] || (b !== GROUND && !project.parts[b])) continue;
    if (behaviour(j.jointTypeId) === 'fixed') uf.union(a, b);
  }
  if (unknownTypes.size) warnings.push(`Joint types not in the catalog, treated as pinned: ${[...unknownTypes].join(', ')}.`);

  const lateral = options.lateral ?? 0.02;
  const dir = options.lateralDirection ?? { x: 1, z: 1 };
  const dn = Math.hypot(dir.x, dir.z) || 1;
  const world = new R.World({ x: (lateral * G * dir.x) / dn, y: -G, z: (lateral * G * dir.z) / dn });
  try {
    const dt = options.dt_s ?? 1 / 60;
    world.timestep = dt;
    world.integrationParameters.numSolverIterations = Math.max(8, options.solverIterations ?? 8);

    const groundRoot = uf.find(GROUND);
    const ground = world.createRigidBody(R.RigidBodyDesc.fixed());
    const bodies = new Map<string, InstanceType<Rapier['RigidBody']>>([[groundRoot, ground]]);
    const bodyOf = (id: string) => {
      const root = uf.find(id);
      let b = bodies.get(root);
      if (!b) {
        b = world.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(false));
        bodies.set(root, b);
      }
      return b;
    };

    // Groups: parts (bit 0) only touch the catcher (bit 1).
    const PARTS = 0x0001;
    const CATCHER = 0x0002;
    const groups = (member: number, filter: number) => (member << 16) | filter;

    const initial = new Map<string, [number, number, number]>();
    const noDensity: string[] = [];
    let minY = Infinity;
    let span = 0;
    for (const p of parts) {
      const box = partBox(p);
      const c: [number, number, number] = [box.center.x * MM, box.center.y * MM, box.center.z * MM];
      initial.set(p.id, c);
      span = Math.max(span, Math.abs(c[0]), Math.abs(c[2]));
      if (uf.find(p.id) === groundRoot) continue; // fixed: needs no collider
      const half = box.half.map((h) => Math.max(h * MM, 1e-4)) as [number, number, number];
      const yExtent = box.half[0] * Math.abs(box.axes[0].y) + box.half[1] * Math.abs(box.axes[1].y) + box.half[2] * Math.abs(box.axes[2].y);
      minY = Math.min(minY, (box.center.y - yExtent) * MM);
      const m = idx.materials.get(p.materialId);
      const thickness = 2 * Math.min(...half);
      let density = m?.density_kg_m3 ?? (m?.arealMass_kg_m2 !== undefined ? m.arealMass_kg_m2 / thickness : undefined);
      if (density === undefined) {
        density = DEFAULT_DENSITY;
        noDensity.push(p.id);
      }
      const [qx, qy, qz, qw] = quatFromAxes(box.axes);
      const desc = R.ColliderDesc.cuboid(half[0], half[1], half[2])
        .setTranslation(c[0], c[1], c[2])
        .setRotation({ x: qx, y: qy, z: qz, w: qw })
        .setDensity(density)
        .setFriction(0.6)
        .setCollisionGroups(groups(PARTS, CATCHER));
      world.createCollider(desc, bodyOf(p.id));
    }
    if (noDensity.length) warnings.push(`No density in the catalog for ${list(noDensity)}; ${DEFAULT_DENSITY} kg/m³ used.`);

    // The catcher: a wide slab whose top is 100 mm below the lowest moving part.
    const top = (Number.isFinite(minY) ? minY : 0) - 0.1;
    const halfW = span + 100;
    world.createCollider(
      R.ColliderDesc.cuboid(halfW, 1, halfW)
        .setTranslation(0, top - 1, 0)
        .setFriction(0.6)
        .setCollisionGroups(groups(CATCHER, PARTS)),
      ground,
    );

    // --- Joints: pinned → spherical, deduplicated per body pair and point ----------------
    const isSheet = (id: string) => project.parts[id]?.role === 'sheathing';
    const anchors = ([a, b]: readonly [string, string], at: { x: number; y: number; z: number }): V3[] => {
      const point: V3 = [at.x, at.y, at.z];
      if (b === GROUND || rigid.has(a) || rigid.has(b) || (isSheet(a) && isSheet(b))) return [point];
      if (!isSheet(a) && !isSheet(b)) {
        // Like the frame solver, which joins members at their centrelines: pin on the
        // carrying (longer) member's centreline, so two rafters nailed either side of a
        // ridge board meet at one point instead of forming a four-bar linkage.
        const carrier = project.parts[project.parts[a]!.size.length >= project.parts[b]!.size.length ? a : b]!;
        const line = centreline(carrier);
        return [pointAt(line, projectOnto(line, point).t)];
      }
      const sheet = project.parts[isSheet(a) ? a : b]!;
      const member = project.parts[isSheet(a) ? b : a]!;
      const line = centreline(member);
      const [t0, t1] = overlapInterval(line, sheet);
      if (!(t1 - t0 > 1)) return [point];
      return [pointAt(line, t0), pointAt(line, t1)];
    };
    const seen = new Set<string>();
    const pairs: Array<[string, string]> = [];
    const held = new Set<string>();
    let jointCount = 0;
    for (const j of joints) {
      const [a, b] = j.partIds;
      if (!project.parts[a] || (b !== GROUND && !project.parts[b])) continue;
      const ra = uf.find(a);
      const rb = uf.find(b);
      held.add(ra);
      held.add(rb);
      if (ra === rb) continue;
      const key = `${ra < rb ? ra : rb}|${ra < rb ? rb : ra}|${Math.round(j.at.x)},${Math.round(j.at.y)},${Math.round(j.at.z)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Bodies sit at the origin unrotated, so a world point is the local anchor on both.
      for (const at of anchors(j.partIds, j.at)) {
        const anchor = { x: at[0] * MM, y: at[1] * MM, z: at[2] * MM };
        world.createImpulseJoint(R.JointData.spherical(anchor, anchor), bodyOf(a), bodyOf(b), true);
        jointCount++;
      }
      if (ra !== groundRoot && rb !== groundRoot) pairs.push([ra, rb]);
    }

    // --- Run --------------------------------------------------------------------------
    const steps = Math.max(1, Math.round((options.duration_s ?? 3) / dt));
    const every = options.recordEvery ?? 0;
    const frames: StabilityFrame[] = [];
    const poses = (): Record<string, PartPose> => {
      const out: Record<string, PartPose> = {};
      for (const p of parts) {
        const body = bodies.get(uf.find(p.id))!;
        const q = body.rotation();
        const t = body.translation();
        const c = rotate(q, initial.get(p.id)!);
        out[p.id] = [(c[0] + t.x) / MM, (c[1] + t.y) / MM, (c[2] + t.z) / MM, q.x, q.y, q.z, q.w];
      }
      return out;
    };
    if (every > 0) frames.push({ t_s: 0, parts: poses() });
    for (let s = 1; s <= steps; s++) {
      world.step();
      if (every > 0 && s % every === 0) frames.push({ t_s: s * dt, parts: poses() });
    }

    // --- Verdict ----------------------------------------------------------------------
    const final = poses();
    const moved: MovedPart[] = [];
    for (const p of parts) {
      const [x, y, z, , , , qw] = final[p.id]!;
      const c0 = initial.get(p.id)!;
      const displacement_mm = Math.hypot(x - c0[0] / MM, y - c0[1] / MM, z - c0[2] / MM);
      const rotation_deg = angleDeg({ w: qw });
      if (displacement_mm > MOVED_MM || rotation_deg > MOVED_DEG) moved.push({ id: p.id, displacement_mm, rotation_deg });
    }
    moved.sort((a, b) => b.displacement_mm - a.displacement_mm);

    let folds: { a: string; b: string; deg: number } | null = null;
    for (const [ra, rb] of pairs) {
      const deg = relativeDeg(bodies.get(ra)!.rotation(), bodies.get(rb)!.rotation());
      if (deg > TIP_DEG && (!folds || deg > folds.deg)) folds = { a: ra, b: rb, deg };
    }
    const partOfBody = (root: string) => parts.find((p) => uf.find(p.id) === root)?.id ?? root;
    const fallen = moved.filter((m) => !held.has(uf.find(m.id)) && m.displacement_mm > FALL_MM);
    const turned = moved.filter((m) => m.rotation_deg > TIP_DEG);

    let verdict: StabilityVerdict = 'stable';
    let message = moved.length
      ? `It stands. ${list(moved.map((m) => m.id))} settle a little (at most ${Math.round(moved[0]!.displacement_mm)} mm).`
      : 'It stands: nothing moves.';
    if (folds || fallen.length) {
      verdict = 'collapses';
      const ids = moved.map((m) => m.id);
      message = folds
        ? `It collapses: ${partOfBody(folds.a)} turns ${Math.round(folds.deg)}° against ${partOfBody(folds.b)} (${list(ids)} move). The joints there are pinned with nothing to brace them; add sheathing, a brace or a fixed joint.`
        : `It collapses: ${list(fallen.map((m) => m.id))} ${fallen.length === 1 ? 'is' : 'are'} not fastened to anything and fall${fallen.length === 1 ? 's' : ''}.`;
    } else if (turned.length) {
      verdict = 'tips';
      message = `It tips over: ${list(turned.map((m) => m.id))} turn${turned.length === 1 ? 's' : ''} ${Math.round(turned[0]!.rotation_deg)}° as one piece. It needs a fixed base, a brace or a wider footing.`;
    }

    const now = clock ? clock.now() : Date.now();
    return {
      verdict,
      message,
      movedParts: moved,
      stats: { bodies: bodies.size, joints: jointCount, steps, ms: now - start },
      warnings,
      ...(every > 0 ? { frames } : {}),
    };
  } finally {
    world.free();
  }
}
