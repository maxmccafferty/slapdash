/**
 * build_fence layout. Five styles share one plan: walk the path segment by segment, cut
 * the gate openings out of each segment, and fill the runs between them.
 *
 * - privacy / picket: pressure-treated posts set in concrete, 2x rails between them,
 *   boards on one face of the rails.
 * - chain-link: galvanized terminal posts (ends, corners, gates) and line posts at most
 *   10 ft apart, a top rail, and one fabric panel per bay.
 * - aluminum: 2x2 aluminum posts at the 6 ft panel width, one panel per bay.
 * - glass: frameless tempered panels on spigots, at most 4 ft wide with a 1 1/2 in gap.
 *
 * A gate gets a post on each side (an aluminum hinge or latch post for glass), a leaf in
 * the fence's own infill, a hinge joint and a latch joint. With `poolBarrier` the builder
 * follows IRC Appendix AG105.2 (4 ft minimum, gaps under 4 in, rails on the pool side,
 * self-closing and self-latching gates swinging away from the pool); these are reminders,
 * not a code check.
 */
import type { MaterialCategory } from '../../catalog/schema.ts';
import type { CatalogIndex } from '../../catalog/validate.ts';
import { commandError, type CommandError } from '../../commands/errors.ts';
import { toWorld, type FrameBox, type PlanFrame } from '../../geometry/frame.ts';
import { GROUND } from '../../model/ids.ts';
import type { Project } from '../../model/schema.ts';
import { MM_PER_FOOT, MM_PER_INCH } from '../../units/length.ts';
import { BUILDER_DEFAULTS, resolveMaterials, type BuilderMaterialsInput } from '../defaults.ts';
import { SpecList, fail, type JointSpec, type LayoutResult, type Ref } from '../emit.ts';
import {
  ALUMINUM_PANEL_WIDTH_MM,
  CHAIN_LINK_MAX_POST_SPACING_MM,
  FENCE_MAX_HEIGHT_MM,
  FENCE_MAX_POST_SPACING_MM,
  GATE_DEFAULT_WIDTH_MM,
  GATE_MAX_WIDTH_MM,
  GATE_MIN_WIDTH_MM,
  GLASS_FENCE_MAX_HEIGHT_MM,
  GLASS_PANEL_GAP_MM,
  GLASS_PANEL_MAX_WIDTH_MM,
  POOL_BARRIER_CLOSE_RAIL_GAP_MM,
  POOL_BARRIER_MIN_HEIGHT_MM,
  POOL_BARRIER_RAIL_RULE_MM,
  POOL_GATE_LATCH_MIN_MM,
} from '../rules.ts';
import { builderSeq, fi, partAabb, requireMaterial, round6, sectionDims, supportUnder, type PlanPoint } from '../util.ts';

const IN = MM_PER_INCH;
const FT = MM_PER_FOOT;
export const FENCE_BUILDER = 'build_fence';
export const FENCE_STYLES = ['privacy', 'picket', 'chain-link', 'aluminum', 'glass'] as const;
export type FenceStyle = (typeof FENCE_STYLES)[number];

export interface FenceGateInput {
  /** Distance along the whole path to the start of the gate opening. */
  at?: number;
  /** Distance along the whole path to the middle of the gate opening. */
  centerAt?: number;
  width?: number;
  hinge?: 'start' | 'end';
  swing?: 'in' | 'out';
}

export interface BuildFenceInput {
  path: PlanPoint[];
  height?: number;
  style?: FenceStyle;
  postSpacing?: number;
  infill?: string;
  gates?: FenceGateInput[];
  poolBarrier?: boolean;
  poolSide?: 'left' | 'right';
  materials?: BuilderMaterialsInput;
  name?: string;
}

interface Gate {
  at: number;
  width: number;
  hinge: 'start' | 'end';
  swing: 'in' | 'out';
}

/** Clearance between a gate leaf and each gate post. */
const GATE_CLEARANCE = 0.5 * IN;
/** Bottom clearance of boards, fabric and panels (AG105.2(2): at most 2 in). */
const BOTTOM_GAP = 2 * IN;
/** Gate posts must be at least this far from a corner or an end of the path. */
const GATE_END_CLEARANCE = 1 * FT;
const FABRIC_THICKNESS = 4;
const ALUMINUM_PANEL_THICKNESS = 1 * IN;
const GLASS_THICKNESS = 12;

const WOOD = (s: FenceStyle) => s === 'privacy' || s === 'picket';

/** The pool parts (site context tagged `kind:pool` and `water`). */
export function poolParts(project: Project) {
  return Object.values(project.parts).filter((p) => p.tags.includes('kind:pool') && p.tags.includes('water'));
}

/** Which side of the path (walking it) the nearest pool is on, or null with no pool. */
export function poolSideOf(project: Project, path: readonly PlanPoint[]): 'left' | 'right' | null {
  const pools = poolParts(project);
  if (pools.length === 0 || path.length < 2) return null;
  let best: { d: number; side: 'left' | 'right' } | null = null;
  for (const pool of pools) {
    const b = partAabb(pool);
    const c = { x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2 };
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!;
      const e = path[i + 1]!;
      const dx = e.x - a.x;
      const dz = e.z - a.z;
      const L2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.z - a.z) * dz) / L2));
      const d = Math.hypot(a.x + t * dx - c.x, a.z + t * dz - c.z);
      // The pool centre's w in the segment's PlanFrame (wSign 1): +w is to the right walking the path.
      const w = (-(c.x - a.x) * dz + (c.z - a.z) * dx) / Math.sqrt(L2);
      if (!best || d < best.d) best = { d, side: w > 0 ? 'right' : 'left' };
    }
  }
  return best!.side;
}

export function layoutFence(project: Project, input: BuildFenceInput, catalog: CatalogIndex): LayoutResult {
  const style: FenceStyle = input.style ?? 'privacy';
  const height = input.height ?? (style === 'glass' ? 4 * FT : 6 * FT);
  const poolBarrier = input.poolBarrier ?? false;
  const defaultSpacing =
    style === 'chain-link' ? CHAIN_LINK_MAX_POST_SPACING_MM : style === 'aluminum' ? ALUMINUM_PANEL_WIDTH_MM : FENCE_MAX_POST_SPACING_MM;
  const maxSpacing = defaultSpacing;
  const spacing = input.postSpacing ?? defaultSpacing;
  const materials = resolveMaterials(input.materials);
  const bad = (msg: string, path: string, hint?: string) => fail(commandError('invalid_input', msg, { path, ...(hint ? { hint } : {}) }));
  const D = BUILDER_DEFAULTS.materials;

  if (input.path.length < 2) return bad('A fence needs at least two points in "path".', 'path');
  for (let i = 1; i < input.path.length; i++) {
    const a = input.path[i - 1]!;
    const b = input.path[i]!;
    if (Math.hypot(b.x - a.x, b.z - a.z) < 1) return bad(`path[${i}] repeats the point before it.`, `path[${i}]`);
  }
  if (height > FENCE_MAX_HEIGHT_MM + 1e-6) {
    return bad(`Fences over 8' 0" need engineering and usually a permit (you asked for ${fi(height)}).`, 'height');
  }
  if (style === 'glass' && height > GLASS_FENCE_MAX_HEIGHT_MM + 1e-6) {
    return bad(`Frameless glass fence panels go up to 6' 0" tall (you asked for ${fi(height)}).`, 'height');
  }
  if (poolBarrier && height < POOL_BARRIER_MIN_HEIGHT_MM - 1e-6) {
    return bad(
      `A pool barrier must be at least 4' 0" tall (IRC AG105.2(1)); you gave ${fi(height)}.`,
      'height',
      'Set "height" to "4ft" or more.',
    );
  }
  if (height < 3 * FT - 1e-6) return bad(`A fence must be at least 3' 0" tall (you gave ${fi(height)}).`, 'height');
  if (style !== 'glass') {
    if (spacing > maxSpacing + 1e-6) {
      const why = style === 'aluminum' ? ' (aluminum panels are 6ft wide)' : '';
      return bad(`${style === 'chain-link' ? 'Chain-link' : style === 'aluminum' ? 'Aluminum fence' : 'Fence'} posts can be at most ${fi(maxSpacing)} apart${why} (you gave ${fi(spacing)}).`, 'postSpacing');
    }
    if (spacing < 2 * FT - 1e-6) return bad(`Fence posts must be at least 2' 0" apart (you gave ${fi(spacing)}).`, 'postSpacing');
  }

  // Infill: boards for wood, fabric, panels or glass for the rest.
  const infillCategories: MaterialCategory[] = WOOD(style) ? ['lumber'] : ['fencing'];
  const infill =
    input.infill ??
    (WOOD(style)
      ? materials.lumber
      : style === 'chain-link'
        ? poolBarrier
          ? D.chainLinkMiniMesh
          : D.chainLinkFabric
        : style === 'aluminum'
          ? D.aluminumPanel
          : D.glassFencePanel);
  const matErrors: CommandError[] = [];
  for (const e of [
    WOOD(style) ? requireMaterial(catalog, materials.treatedLumber, ['lumber'], 'materials.treatedLumber') : null,
    WOOD(style) ? requireMaterial(catalog, materials.lumber, ['lumber'], 'materials.lumber') : null,
    style === 'chain-link' ? requireMaterial(catalog, D.chainLinkPipe, ['steel'], 'style') : null,
    style === 'aluminum' || style === 'glass' ? requireMaterial(catalog, D.aluminumPost, ['fencing'], 'style') : null,
    requireMaterial(catalog, infill, infillCategories, input.infill !== undefined ? 'infill' : 'style'),
    style !== 'glass' || (input.gates?.length ?? 0) > 0 ? requireMaterial(catalog, materials.concrete, ['concrete'], 'materials.concrete') : null,
  ]) {
    if (e) matErrors.push(e);
  }
  if (matErrors.length > 0) return fail(...matErrors);
  if (poolBarrier && catalog.materials.get(infill)?.flags?.includes('not-pool-barrier')) {
    return bad(
      `${catalog.materials.get(infill)!.name} isn't used for pool barriers here: a child can climb 2in chain-link mesh, so this builder uses 1 1/4in mini-mesh (IRC AG105.2(6) allows up to 2 1/4in, but many places require mini-mesh).`,
      input.infill !== undefined ? 'infill' : 'style',
      `Leave "infill" out to use "${D.chainLinkMiniMesh}", or pick a style such as "aluminum".`,
    );
  }

  // Pool side and gates.
  const detectedSide = poolSideOf(project, input.path);
  const poolSide = input.poolSide ?? detectedSide ?? 'left';
  const segLens = input.path.slice(1).map((p, i) => Math.hypot(p.x - input.path[i]!.x, p.z - input.path[i]!.z));
  const total = segLens.reduce((a, b) => a + b, 0);
  const gates: Gate[] = [];
  for (const [i, g] of (input.gates ?? []).entries()) {
    const width = g.width ?? GATE_DEFAULT_WIDTH_MM;
    if (width < GATE_MIN_WIDTH_MM - 1e-6 || width > GATE_MAX_WIDTH_MM + 1e-6) {
      return bad(`A gate must be 3' 0" to 6' 0" wide (gates[${i}] is ${fi(width)}); double gates aren't supported yet.`, `gates[${i}].width`);
    }
    if ((g.at === undefined) === (g.centerAt === undefined)) {
      return bad(`gates[${i}] needs exactly one of "at" (where the opening starts) or "centerAt".`, `gates[${i}]`);
    }
    const at = g.at ?? g.centerAt! - width / 2;
    const swing = g.swing ?? 'out';
    if (poolBarrier && swing === 'in') {
      return bad(
        `A pool barrier gate must swing out, away from the pool (IRC AG105.2(8)); gates[${i}] swings in.`,
        `gates[${i}].swing`,
        'Leave "swing" out or set it to "out".',
      );
    }
    gates.push({ at, width, hinge: g.hinge ?? 'start', swing });
  }
  gates.sort((a, b) => a.at - b.at);

  // Which segment each gate is in, in segment coordinates.
  const post = style === 'chain-link' ? sectionDims(catalog, BUILDER_DEFAULTS.sections.chainLinkTerminal) : style === 'aluminum' || style === 'glass' ? sectionDims(catalog, BUILDER_DEFAULTS.sections.aluminumPost) : sectionDims(catalog, BUILDER_DEFAULTS.sections.fencePost);
  const gatePostW = post.width;
  const gatesBySeg: Array<Array<Gate & { u0: number; u1: number; index: number }>> = segLens.map(() => []);
  for (const [index, g] of gates.entries()) {
    let start = 0;
    let placed = false;
    for (let s = 0; s < segLens.length; s++) {
      const L = segLens[s]!;
      const u0 = g.at - start;
      const u1 = u0 + g.width;
      if (u0 >= -1e-6 && u0 < L) {
        if (u0 - gatePostW < GATE_END_CLEARANCE - 1e-6 || u1 + gatePostW > L - GATE_END_CLEARANCE + 1e-6) {
          return bad(
            `Gate ${index + 1} (${fi(g.at)} to ${fi(g.at + g.width)} along the path) must sit inside one straight run, its posts at least 1' 0" from a corner or end.`,
            `gates[${index}]`,
            `That run is ${fi(L)} long, starting ${fi(start)} along the path.`,
          );
        }
        const prev = gatesBySeg[s]![gatesBySeg[s]!.length - 1];
        if (prev && prev.u1 + 2 * gatePostW > u0 - 1e-6) return bad(`Gates ${index} and ${index + 1} overlap.`, `gates[${index}]`);
        gatesBySeg[s]!.push({ ...g, u0, u1, index });
        placed = true;
        break;
      }
      start += L;
    }
    if (!placed) return bad(`Gate ${index + 1} starts ${fi(g.at)} along a ${fi(total)} path.`, `gates[${index}].at`);
  }

  const S = BUILDER_DEFAULTS.sections;
  const J = BUILDER_DEFAULTS.jointTypes;
  const rail = sectionDims(catalog, S.fenceRail);
  const boardSec = style === 'privacy' ? S.privacyBoard : S.picketBoard;
  const board = WOOD(style) ? sectionDims(catalog, boardSec) : { width: 0, depth: 0 };
  const hp = post.width / 2;
  const below = Math.max(2 * FT, height / 2);
  const pierHalf = style === 'chain-link' ? 5 * IN : 6 * IN;
  const asm = '#m';
  const step = { phase: 'site' as const, seq: builderSeq(project, FENCE_BUILDER) };
  const specs = new SpecList('f');
  const joints: JointSpec[] = [];
  const notes: string[] = [];
  const hingeJoint = poolBarrier || style === 'glass' ? J.gateHingeSelfClosing : J.gateHinge;
  const latchJoint = poolBarrier || style === 'glass' ? J.gateLatchMagnetic : J.gateLatch;
  const latchHeight = poolBarrier ? Math.max(POOL_GATE_LATCH_MIN_MM, height - 4 * IN) : height - 6 * IN;

  /** Boards (and chain-link fabric) go on this side of the posts: +1 = right of the path (+w). */
  const sigma: 1 | -1 = poolBarrier && poolSide === 'right' ? -1 : 1;
  const wSpan = (a: number, b: number) => (sigma === 1 ? { w0: a, w1: b } : { w0: -b, w1: -a });

  const railCount = height > 5 * FT ? 3 : 2;
  const railBottoms: number[] = [6 * IN, height - 6 * IN - rail.depth];
  if (railCount === 3) railBottoms.splice(1, 0, (railBottoms[0]! + railBottoms[1]!) / 2);
  const railsClose = railBottoms.slice(1).some((v, i) => v - railBottoms[i]! < POOL_BARRIER_RAIL_RULE_MM);
  const gap = style === 'privacy' ? 0 : poolBarrier && railsClose ? POOL_BARRIER_CLOSE_RAIL_GAP_MM : 3.5 * IN;

  let postCount = 0;
  let infillCount = 0;
  let prevEndPost: Ref | null = null;
  const worldAt = (f: PlanFrame, p: { u: number; v: number; w: number }) => {
    const w = toWorld(f, p);
    return { x: round6(w.x), y: round6(w.y), z: round6(w.z) };
  };

  const postMaterial = WOOD(style) ? materials.treatedLumber : style === 'chain-link' ? D.chainLinkPipe : D.aluminumPost;
  const addPost = (frame: PlanFrame, c: number, kind: 'line' | 'terminal' | 'gate'): Ref => {
    const sec =
      style === 'chain-link' ? (kind === 'line' ? S.chainLinkLine : S.chainLinkTerminal) : style === 'aluminum' || style === 'glass' ? S.aluminumPost : S.fencePost;
    const h = sectionDims(catalog, sec).width / 2;
    const top = style === 'chain-link' ? (kind === 'line' ? height - sectionDims(catalog, S.chainLinkRail).width : height + 2 * IN) : height;
    const key = specs.add(frame, {
      assembly: asm,
      role: 'post',
      tags: kind === 'gate' ? ['fence-post', 'gate-post'] : kind === 'terminal' ? ['fence-post', 'terminal-post'] : ['fence-post'],
      box: { u0: c - h, u1: c + h, v0: -below, v1: top, w0: -h, w1: h },
      lengthAxis: 'v',
      widthAxis: 'u',
      materialId: postMaterial,
      sectionId: sec,
      buildStep: step,
    });
    const pier = specs.add(frame, {
      assembly: asm,
      role: 'pier',
      tags: ['post-footing'],
      box: { u0: c - pierHalf, u1: c + pierHalf, v0: -below - 6 * IN, v1: 0, w0: -pierHalf, w1: pierHalf },
      lengthAxis: 'v',
      widthAxis: 'u',
      materialId: materials.concrete,
      buildStep: step,
    });
    joints.push({ a: key, b: pier, jointTypeId: J.postEmbedded, at: worldAt(frame, { u: c, v: -below, w: 0 }), fastenerCount: 1 });
    joints.push({ a: pier, b: GROUND, jointTypeId: J.castInPlace, at: worldAt(frame, { u: c, v: -below - 6 * IN, w: 0 }), fastenerCount: 1 });
    postCount++;
    return key;
  };

  /** Wood rails and boards over the bays of one run (post centres `cs`, refs `posts`). */
  const woodRun = (frame: PlanFrame, cs: number[], posts: Ref[], trim: { start: number; end: number }) => {
    const tags: string[] = [];
    const railsByBay: Array<{ u0: number; u1: number; refs: Ref[] }> = [];
    for (let k = 0; k + 1 < cs.length; k++) {
      const c0 = cs[k]!;
      const c1 = cs[k + 1]!;
      const refs: Ref[] = [];
      for (const v0 of railBottoms) {
        const box: FrameBox = { u0: c0 + hp, u1: c1 - hp, v0, v1: v0 + rail.depth, ...wSpan(hp - rail.width, hp) };
        const key = specs.add(frame, {
          assembly: asm,
          role: 'rail',
          tags: ['fence-rail', ...tags],
          box,
          lengthAxis: 'u',
          widthAxis: 'w',
          materialId: materials.lumber,
          sectionId: S.fenceRail,
          buildStep: step,
        });
        refs.push(key);
        const vc = v0 + rail.depth / 2;
        const wc = sigma * (hp - rail.width / 2);
        joints.push({ a: key, b: posts[k]!, jointTypeId: J.nail16d, at: worldAt(frame, { u: c0 + hp, v: vc, w: wc }), fastenerCount: 2 });
        joints.push({ a: key, b: posts[k + 1]!, jointTypeId: J.nail16d, at: worldAt(frame, { u: c1 - hp, v: vc, w: wc }), fastenerCount: 2 });
      }
      railsByBay.push({ u0: c0, u1: c1, refs });
    }
    woodBoards(frame, cs[0]! + trim.start, cs[cs.length - 1]! - trim.end, railsByBay, railBottoms, tags);
  };

  const woodBoards = (
    frame: PlanFrame,
    a: number,
    b: number,
    railsByBay: Array<{ u0: number; u1: number; refs: Ref[] }>,
    railVs: readonly number[],
    tags: string[] = [],
  ) => {
    const L = b - a;
    const n = Math.max(1, Math.floor((L + gap) / (board.depth + gap) + 1e-9));
    const pitch = L / n;
    for (let i = 0; i < n; i++) {
      const u0 = a + i * pitch + (pitch - board.depth) / 2;
      const key = specs.add(frame, {
        assembly: asm,
        role: 'panel',
        tags: ['fence-board', style, ...tags],
        box: { u0, u1: u0 + board.depth, v0: BOTTOM_GAP, v1: height, ...wSpan(hp, hp + board.width) },
        lengthAxis: 'v',
        widthAxis: 'w',
        materialId: infill,
        sectionId: boardSec,
        buildStep: step,
      });
      infillCount++;
      const uc = u0 + board.depth / 2;
      const bay = railsByBay.find((r) => uc >= r.u0 && uc <= r.u1) ?? railsByBay[railsByBay.length - 1]!;
      bay.refs.forEach((r, k) => {
        joints.push({
          a: key,
          b: r,
          jointTypeId: J.nail8d,
          at: worldAt(frame, { u: uc, v: railVs[k]! + rail.depth / 2, w: sigma * hp }),
          fastenerCount: 2,
        });
      });
    }
  };

  const fabric = (frame: PlanFrame, u0: number, u1: number, attach: Array<{ ref: Ref; u: number }>, tags: string[] = []) => {
    const rT = sectionDims(catalog, S.chainLinkTerminal).width / 2;
    const key = specs.add(frame, {
      assembly: asm,
      role: 'panel',
      tags: ['fence-fabric', ...tags],
      box: { u0, u1, v0: BOTTOM_GAP, v1: height, ...wSpan(rT, rT + FABRIC_THICKNESS) },
      lengthAxis: 'u',
      widthAxis: 'w',
      materialId: infill,
      buildStep: step,
    });
    infillCount++;
    for (const t of attach) joints.push({ a: key, b: t.ref, jointTypeId: J.boltedThrough, at: worldAt(frame, { u: t.u, v: height / 2, w: sigma * rT }), fastenerCount: 1 });
    return key;
  };

  /** Chain-link top rail and fabric over one run. */
  const chainRun = (frame: PlanFrame, cs: number[], posts: Ref[], trim: { start: number; end: number }) => {
    const rr = sectionDims(catalog, S.chainLinkRail).width / 2;
    const rT = sectionDims(catalog, S.chainLinkTerminal).width / 2;
    const c0 = cs[0]!;
    const c1 = cs[cs.length - 1]!;
    const top = specs.add(frame, {
      assembly: asm,
      role: 'rail',
      tags: ['fence-rail', 'top-rail'],
      box: { u0: c0 + rT, u1: c1 - rT, v0: height - 2 * rr, v1: height, w0: -rr, w1: rr },
      lengthAxis: 'u',
      widthAxis: 'w',
      materialId: D.chainLinkPipe,
      sectionId: S.chainLinkRail,
      buildStep: step,
    });
    posts.forEach((p, k) => {
      joints.push({ a: top, b: p, jointTypeId: J.boltedThrough, at: worldAt(frame, { u: cs[k]!, v: height - rr, w: 0 }), fastenerCount: 1 });
    });
    for (let k = 0; k + 1 < cs.length; k++) {
      fabric(frame, cs[k]! + (k === 0 ? trim.start : 0), cs[k + 1]! - (k + 2 === cs.length ? trim.end : 0), [
        { ref: posts[k]!, u: cs[k]! },
        { ref: posts[k + 1]!, u: cs[k + 1]! },
        { ref: top, u: (cs[k]! + cs[k + 1]!) / 2 },
      ]);
    }
  };

  const aluminumRun = (frame: PlanFrame, cs: number[], posts: Ref[]) => {
    for (let k = 0; k + 1 < cs.length; k++) {
      const u0 = cs[k]! + hp;
      const u1 = cs[k + 1]! - hp;
      const key = specs.add(frame, {
        assembly: asm,
        role: 'panel',
        tags: ['fence-panel', 'aluminum'],
        box: { u0, u1, v0: BOTTOM_GAP, v1: height, w0: -ALUMINUM_PANEL_THICKNESS / 2, w1: ALUMINUM_PANEL_THICKNESS / 2 },
        lengthAxis: 'u',
        widthAxis: 'w',
        materialId: infill,
        buildStep: step,
      });
      infillCount++;
      joints.push({ a: key, b: posts[k]!, jointTypeId: J.screwedStructural, at: worldAt(frame, { u: u0, v: height / 2, w: 0 }), fastenerCount: 4 });
      joints.push({ a: key, b: posts[k + 1]!, jointTypeId: J.screwedStructural, at: worldAt(frame, { u: u1, v: height / 2, w: 0 }), fastenerCount: 4 });
    }
  };

  const glassPanel = (frame: PlanFrame, u0: number, u1: number, tags: string[] = []): Ref => {
    const key = specs.add(frame, {
      assembly: asm,
      role: 'panel',
      tags: ['fence-panel', 'glass', ...tags],
      box: { u0, u1, v0: BOTTOM_GAP, v1: height, w0: -GLASS_THICKNESS / 2, w1: GLASS_THICKNESS / 2 },
      lengthAxis: 'u',
      widthAxis: 'w',
      materialId: infill,
      buildStep: step,
    });
    infillCount++;
    return key;
  };

  /** Glass panels on spigots between u = a and u = b, with a gap at both ends. */
  const glassRun = (frame: PlanFrame, a: number, b: number) => {
    const L = b - a - 2 * GLASS_PANEL_GAP_MM;
    if (L < 6 * IN) return;
    const n = Math.max(1, Math.ceil((L + GLASS_PANEL_GAP_MM) / (GLASS_PANEL_MAX_WIDTH_MM + GLASS_PANEL_GAP_MM) - 1e-9));
    const w = (L - (n - 1) * GLASS_PANEL_GAP_MM) / n;
    for (let i = 0; i < n; i++) {
      const u0 = a + GLASS_PANEL_GAP_MM + i * (w + GLASS_PANEL_GAP_MM);
      const key = glassPanel(frame, u0, u0 + w);
      joints.push({ a: key, b: GROUND, jointTypeId: J.glassSpigot, at: worldAt(frame, { u: u0 + w / 2, v: 0, w: 0 }), fastenerCount: 2 });
    }
  };

  /** A gate leaf between gate posts at centres cg0 and cg1. */
  const gateLeaf = (frame: PlanFrame, g: Gate & { u0: number; u1: number; index: number }, p0: Ref, p1: Ref) => {
    const l0 = g.u0 + GATE_CLEARANCE;
    const l1 = g.u1 - GATE_CLEARANCE;
    const tag = `gate:${g.index + 1}`;
    const hingeAt = g.hinge === 'start' ? { post: p0, u: l0 } : { post: p1, u: l1 };
    const latchAt = g.hinge === 'start' ? { post: p1, u: l1 } : { post: p0, u: l0 };
    let hingePart: Ref;
    let latchPart: Ref;
    if (WOOD(style)) {
      const refs: Ref[] = [];
      const leafRails = [railBottoms[0]!, railBottoms[railBottoms.length - 1]!];
      for (const v0 of leafRails) {
        refs.push(
          specs.add(frame, {
            assembly: asm,
            role: 'rail',
            tags: ['gate-frame', tag],
            box: { u0: l0, u1: l1, v0, v1: v0 + rail.depth, ...wSpan(hp - rail.width, hp) },
            lengthAxis: 'u',
            widthAxis: 'w',
            materialId: materials.lumber,
            sectionId: S.gateFrame,
            buildStep: step,
          }),
        );
      }
      woodBoards(frame, l0, l1, [{ u0: l0, u1: l1, refs }], leafRails, ['gate-leaf', tag]);
      hingePart = refs[1]!;
      latchPart = refs[1]!;
    } else if (style === 'chain-link') {
      const rs = sectionDims(catalog, S.chainLinkRail).width;
      const stile = (u: number) =>
        specs.add(frame, {
          assembly: asm,
          role: 'post',
          tags: ['gate-frame', tag],
          box: { u0: u, u1: u + rs, v0: BOTTOM_GAP, v1: height, w0: -rs / 2, w1: rs / 2 },
          lengthAxis: 'v',
          widthAxis: 'u',
          materialId: D.chainLinkPipe,
          sectionId: S.chainLinkRail,
          buildStep: step,
        });
      const s0 = stile(l0);
      const s1 = stile(l1 - rs);
      for (const v0 of [BOTTOM_GAP, height - rs]) {
        const r = specs.add(frame, {
          assembly: asm,
          role: 'rail',
          tags: ['gate-frame', tag],
          box: { u0: l0 + rs, u1: l1 - rs, v0, v1: v0 + rs, w0: -rs / 2, w1: rs / 2 },
          lengthAxis: 'u',
          widthAxis: 'w',
          materialId: D.chainLinkPipe,
          sectionId: S.chainLinkRail,
          buildStep: step,
        });
        joints.push({ a: r, b: s0, jointTypeId: J.boltedThrough, at: worldAt(frame, { u: l0 + rs, v: v0 + rs / 2, w: 0 }), fastenerCount: 1 });
        joints.push({ a: r, b: s1, jointTypeId: J.boltedThrough, at: worldAt(frame, { u: l1 - rs, v: v0 + rs / 2, w: 0 }), fastenerCount: 1 });
      }
      fabric(frame, l0, l1, [
        { ref: s0, u: l0 + rs / 2 },
        { ref: s1, u: l1 - rs / 2 },
      ], ['gate-leaf', tag]);
      hingePart = g.hinge === 'start' ? s0 : s1;
      latchPart = g.hinge === 'start' ? s1 : s0;
    } else {
      const key =
        style === 'glass'
          ? glassPanel(frame, l0, l1, ['gate-leaf', tag])
          : specs.add(frame, {
              assembly: asm,
              role: 'panel',
              tags: ['fence-panel', 'aluminum', 'gate-leaf', tag],
              box: { u0: l0, u1: l1, v0: BOTTOM_GAP, v1: height, w0: -ALUMINUM_PANEL_THICKNESS / 2, w1: ALUMINUM_PANEL_THICKNESS / 2 },
              lengthAxis: 'u',
              widthAxis: 'w',
              materialId: infill,
              buildStep: step,
            });
      if (style === 'aluminum') infillCount++;
      hingePart = key;
      latchPart = key;
    }
    joints.push({ a: hingePart, b: hingeAt.post, jointTypeId: hingeJoint, at: worldAt(frame, { u: hingeAt.u, v: height / 2, w: 0 }), fastenerCount: 1, note: `Gate ${g.index + 1} hinges` });
    joints.push({ a: latchPart, b: latchAt.post, jointTypeId: latchJoint, at: worldAt(frame, { u: latchAt.u, v: latchHeight, w: 0 }), fastenerCount: 1, note: `Gate ${g.index + 1} latch` });
  };

  // A closed path (last point on the first) ends on the first post. At an inside corner
  // on the infill side, the boards (or fabric) of the run coming in stop short of the
  // corner and the run going out starts at the post face, so the two faces don't cross.
  const n = input.path.length;
  const closed = n > 3 && Math.hypot(input.path[n - 1]!.x - input.path[0]!.x, input.path[n - 1]!.z - input.path[0]!.z) < 1;
  const dir = (s: number) => {
    const a = input.path[s]!;
    const b = input.path[s + 1]!;
    return { x: (b.x - a.x) / segLens[s]!, z: (b.z - a.z) / segLens[s]! };
  };
  /** Whether the corner at path point i (between segments i−1 and i) turns toward the infill side. */
  const insideCorner = (i: number): boolean => {
    const prev = i === 0 ? (closed ? segLens.length - 1 : -1) : i - 1;
    const next = i === segLens.length ? (closed ? 0 : -1) : i;
    if (prev < 0 || next < 0) return false;
    const d1 = dir(prev);
    const d2 = dir(next);
    const cross = d1.x * d2.z - d1.z * d2.x;
    return Math.abs(cross) > 1e-6 && Math.sign(cross) === sigma;
  };
  const faceDepth = WOOD(style) ? board.width : FABRIC_THICKNESS;
  const faceOffset = style === 'chain-link' ? sectionDims(catalog, S.chainLinkTerminal).width / 2 : hp;
  let firstPost: Ref | null = null;

  for (let s = 0; s + 1 < input.path.length; s++) {
    const a = input.path[s]!;
    const b = input.path[s + 1]!;
    const L = segLens[s]!;
    const frame: PlanFrame = { origin: { x: a.x, y: 0, z: a.z }, angleDeg: (Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI, wSign: 1 };
    const segGates = gatesBySeg[s]!;

    if (style === 'glass') {
      let cursor = 0;
      for (const g of segGates) {
        const cg0 = g.u0 - hp;
        const cg1 = g.u1 + hp;
        glassRun(frame, cursor, cg0 - hp);
        const p0 = addPost(frame, cg0, 'gate');
        const p1 = addPost(frame, cg1, 'gate');
        gateLeaf(frame, g, p0, p1);
        cursor = cg1 + hp;
      }
      glassRun(frame, cursor, L);
      continue;
    }

    // Fixed posts: the segment ends and both sides of each gate.
    type Run = { c0: number; c1: number; p0: Ref | null; p1: Ref | null };
    const runs: Run[] = [];
    let start = 0;
    for (const g of segGates) {
      runs.push({ c0: start, c1: g.u0 - hp, p0: null, p1: null });
      start = g.u1 + hp;
    }
    runs.push({ c0: start, c1: L, p0: null, p1: null });

    const runPosts: Ref[][] = [];
    for (const [ri, run] of runs.entries()) {
      const len = run.c1 - run.c0;
      const bays = Math.max(1, Math.ceil(len / spacing - 1e-9));
      const posts: Ref[] = [];
      const cs: number[] = [];
      for (let k = 0; k <= bays; k++) {
        const c = run.c0 + (k * len) / bays;
        cs.push(c);
        if (k === 0 && ri === 0 && prevEndPost) {
          posts.push(prevEndPost);
          continue;
        }
        if (k === bays && ri === runs.length - 1 && closed && s === segLens.length - 1 && firstPost) {
          posts.push(firstPost);
          continue;
        }
        const isGatePost = (k === 0 && ri > 0) || (k === bays && ri < runs.length - 1);
        const kind = isGatePost ? 'gate' : k === 0 || k === bays ? 'terminal' : 'line';
        posts.push(addPost(frame, c, kind));
      }
      firstPost ??= posts[0]!;
      runPosts.push(posts);
      const trim = {
        start: ri === 0 && insideCorner(s) ? faceOffset : 0,
        end: ri === runs.length - 1 && insideCorner(s + 1) ? faceOffset + faceDepth : 0,
      };
      if (WOOD(style)) woodRun(frame, cs, posts, trim);
      else if (style === 'chain-link') chainRun(frame, cs, posts, trim);
      else aluminumRun(frame, cs, posts);
      if (ri > 0) gateLeaf(frame, segGates[ri - 1]!, runPosts[ri - 1]![runPosts[ri - 1]!.length - 1]!, posts[0]!);
    }
    prevEndPost = runPosts[runPosts.length - 1]![runPosts[runPosts.length - 1]!.length - 1]!;
  }

  if (style === 'glass') {
    const support = supportUnder(project, input.path, catalog);
    notes.push(
      support.kind === 'concrete'
        ? 'The glass panels stand on stainless spigots core-drilled into the concrete under them.'
        : "The glass panels stand on stainless spigots that core-drill into a concrete deck, and there's no slab under this line: pour one (or use base-plate spigots on footings) before the glass goes in.",
    );
  }
  if (poolBarrier) {
    notes.push(
      'Pool barrier (reminder, not a code check): at least 4ft tall, gaps under 4in, at most 2in under it, gates self-closing and self-latching with the latch at least 54in up, swinging away from the pool. Check with your building department.',
    );
    if (WOOD(style) && railsClose) notes.push(`The rails are less than 45in apart, so they're on the pool side and the pickets are at most 1 3/4in apart.`);
    if (poolParts(project).length === 0 && input.poolSide === undefined) notes.push('There is no pool in the project, so I put the pool side on the left of the path.');
  }

  const name = input.name ?? 'Fence';
  const params: Record<string, unknown> = { path: input.path, height, style, postSpacing: spacing, materials };
  if (input.infill !== undefined) params.infill = input.infill;
  if (gates.length > 0) params.gates = gates.map((g) => ({ at: round6(g.at), width: round6(g.width), hinge: g.hinge, swing: g.swing }));
  if (poolBarrier) {
    params.poolBarrier = true;
    params.poolSide = poolSide;
  }
  const infillWord =
    style === 'chain-link' ? 'fabric panels' : style === 'aluminum' ? 'panels' : style === 'glass' ? 'glass panels' : 'boards';
  const gateWord = gates.length === 0 ? '' : `, ${gates.length} gate${gates.length === 1 ? '' : 's'}`;
  return {
    ok: true,
    layout: {
      assemblies: [
        {
          key: asm,
          kind: 'misc',
          name,
          buildStep: step,
          builder: () => ({ name: FENCE_BUILDER, params }),
        },
      ],
      parts: specs.parts,
      joints,
      notes,
      what: 'The new fence',
      summary: (id) =>
        WOOD(style)
          ? `Built fence ${id(asm)} "${name}": ${fi(total)} of ${fi(height)} ${style} fence, ${postCount} posts set ${fi(below)} deep in concrete, ${railCount} rails per bay, ${infillCount} boards${gateWord}.`
          : style === 'glass'
            ? `Built fence ${id(asm)} "${name}": ${fi(total)} of ${fi(height)} frameless glass fence, ${infillCount} glass panels on spigots${postCount > 0 ? `, ${postCount} gate posts set in concrete` : ''}${gateWord}.`
            : `Built fence ${id(asm)} "${name}": ${fi(total)} of ${fi(height)} ${style} fence, ${postCount} posts set ${fi(below)} deep in concrete, ${infillCount} ${infillWord}${gateWord}.`,
    },
  };
}
