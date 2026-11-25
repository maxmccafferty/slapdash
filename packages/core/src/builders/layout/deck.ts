/**
 * build_deck layout: a freestanding deck on posts (a ledger to the house is out of scope).
 *
 * Plan frame: u runs along the beams, w along the joists. Rows of 6x6 posts on piers carry
 * doubled 2x10 beams that sandwich the post tops; joists sit on the beams between two rim
 * joists; decking boards (role sheathing, so the solver puts the 40 psf live load through
 * them) run across the joists with 1/8 in gaps.
 *
 * Guards go on every side when the deck is more than 30 in up (IRC R312.1.1): 4x4 posts
 * bolted to the rim's outside face, a 2x6 cap 36 in above the decking, and 2x2
 * balusters, cable or glass between. Stairs come down from one side on 2x12 stringers to a
 * concrete pad, risers at most 7 3/4 in and treads at least 10 in (IRC R311.7.5), with a
 * handrail when there are four or more risers.
 */
import type { CatalogIndex } from '../../catalog/validate.ts';
import { commandError, type CommandError } from '../../commands/errors.ts';
import { placeOriented, toWorld, type FrameAxis, type FrameBox, type FrameVec, type PlanFrame } from '../../geometry/frame.ts';
import { GROUND, type PartRole } from '../../model/ids.ts';
import type { BuildStep, Project } from '../../model/schema.ts';
import type { SiteDefaults } from '../../site/design-loads.ts';
import { MM_PER_FOOT, MM_PER_INCH } from '../../units/length.ts';
import { BUILDER_DEFAULTS, resolveMaterials, type BuilderMaterialsInput } from '../defaults.ts';
import { SpecList, fail, type AssemblySpec, type JointSpec, type LayoutResult, type Ref } from '../emit.ts';
import {
  DECK_BEAM_MAX_SPAN_MM,
  DECK_GUARD_HEIGHT_MM,
  DECK_GUARD_TRIGGER_MM,
  DECK_JOIST_SIZES,
  DECK_JOIST_SPAN_MM,
  DECK_RAIL_POST_MAX_SPACING_MM,
  GUARD_MAX_OPENING_MM,
  JOIST_TO_RIM_NAILS,
  SPACING_MM,
  STAIR_HANDRAIL_RISERS,
  STAIR_MAX_RISER_MM,
  STAIR_MAX_STRINGER_SPACING_MM,
  framingNailCount,
} from '../rules.ts';
import { builderSeq, compass, fi, footingDepth, requireMaterial, requireSection, round6, sectionDims, type PlanPoint } from '../util.ts';

const IN = MM_PER_INCH;
const FT = MM_PER_FOOT;
const T = BUILDER_DEFAULTS.twoBy;
export const DECK_BUILDER = 'build_deck';
const PIER_HALF = 6 * IN;
const BOARD_GAP = 0.125 * IN;
const PAD_THICKNESS = 4 * IN;
const HANDRAIL_ABOVE_NOSING = 34 * IN;
const CABLE_POST_MAX_SPACING_MM = 4 * FT;
type Side = 'north' | 'south' | 'east' | 'west';

export interface BuildDeckInput {
  from: PlanPoint;
  to: PlanPoint;
  height: number;
  joistSize?: '2x6' | '2x8' | '2x10' | '2x12';
  spacing?: '12in' | '16in';
  joistDirection?: 'x' | 'z';
  decking?: string;
  railing?: 'auto' | 'none' | 'wood' | 'cable' | 'glass';
  stairs?: { side: Side; at: number; width?: number };
  materials?: BuilderMaterialsInput;
  name?: string;
}

interface SideFrame {
  side: Side;
  frame: PlanFrame;
  len: number;
  /** The rim or end joist on this side. */
  rim: Ref;
}

export function layoutDeck(project: Project, input: BuildDeckInput, catalog: CatalogIndex, siteDefaults?: SiteDefaults): LayoutResult {
  const bad = (msg: string, path: string, hint?: string): LayoutResult => fail(commandError('invalid_input', msg, { path, ...(hint ? { hint } : {}) }));
  const D = BUILDER_DEFAULTS.materials;
  const S = BUILDER_DEFAULTS.sections;
  const J = BUILDER_DEFAULTS.jointTypes;
  const x0 = Math.min(input.from.x, input.to.x);
  const x1 = Math.max(input.from.x, input.to.x);
  const z0 = Math.min(input.from.z, input.to.z);
  const z1 = Math.max(input.from.z, input.to.z);
  if (x1 - x0 < 4 * FT || z1 - z0 < 4 * FT) return bad('A deck must be at least 4\' 0" on each side.', 'to');
  const height = input.height;
  if (height > 10 * FT + 1e-6) return bad(`Freestanding decks over 10' 0" need engineering (you asked for ${fi(height)}).`, 'height');
  const materials = resolveMaterials(input.materials);
  const wood = materials.treatedLumber;
  const decking = input.decking ?? D.woodDecking;
  const errs: CommandError[] = [];
  for (const e of [
    requireMaterial(catalog, wood, ['lumber'], 'materials.treatedLumber'),
    requireMaterial(catalog, materials.concrete, ['concrete'], 'materials.concrete'),
    requireMaterial(catalog, decking, ['lumber', 'decking'], 'decking'),
    requireSection(catalog, S.deckBoard, 'decking'),
    requireSection(catalog, S.deckPost, 'height'),
  ]) {
    if (e) errs.push(e);
  }
  if (errs.length > 0) return fail(...errs);
  const composite = catalog.materials.get(decking)!.category === 'decking';
  const spacingLabel = input.spacing ?? (composite ? '12in' : '16in');
  const spacing = SPACING_MM[spacingLabel];
  const railing = input.railing ?? 'auto';
  const guardNeeded = height > DECK_GUARD_TRIGGER_MM + 1e-6;
  if (railing === 'none' && guardNeeded) {
    return bad(
      `A deck more than 30in above grade needs a guard on its open sides (IRC R312.1.1); this one is ${fi(height)} up.`,
      'railing',
      'Leave "railing" out (or "auto") for a wood guard, or pick "cable" or "glass".',
    );
  }
  const guard: 'wood' | 'cable' | 'glass' | null = railing === 'auto' ? (guardNeeded ? 'wood' : null) : railing === 'none' ? null : railing;
  if (guard === 'cable' && errs.length === 0) {
    const e = requireMaterial(catalog, D.cableRail, ['decking'], 'railing');
    if (e) return fail(e);
  }
  if (guard === 'glass') {
    const e = requireMaterial(catalog, D.glassRailing, ['decking'], 'railing');
    if (e) return fail(e);
  }

  // Frame: u along the beams, w along the joists (joists span the shorter side by default).
  const joistAxis = input.joistDirection ?? (x1 - x0 <= z1 - z0 ? 'x' : 'z');
  const frame: PlanFrame = joistAxis === 'z' ? { origin: { x: x0, y: 0, z: z0 }, angleDeg: 0, wSign: 1 } : { origin: { x: x0, y: 0, z: z0 }, angleDeg: 90, wSign: -1 };
  const LU = joistAxis === 'z' ? x1 - x0 : z1 - z0;
  const LW = joistAxis === 'z' ? z1 - z0 : x1 - x0;

  const p = sectionDims(catalog, S.deckPost).width;
  const board = sectionDims(catalog, S.deckBoard);
  const deckT = board.width;
  const beamDepth = sectionDims(catalog, S.deckBeam).depth;

  // Beam rows and joist size from IRC Table R507.6.
  const spanFor = (rows: number) => (LW - 2 * T - p) / (rows - 1);
  let rows = 2;
  let joistSize: string | undefined;
  for (; rows <= 4; rows++) {
    const span = spanFor(rows);
    const fits = (size: string) => DECK_JOIST_SPAN_MM[size]![spacingLabel] >= span - 1e-6;
    if (input.joistSize) {
      if (fits(input.joistSize)) {
        joistSize = input.joistSize;
        break;
      }
    } else {
      joistSize = DECK_JOIST_SIZES.find(fits);
      if (joistSize) break;
    }
  }
  if (!joistSize) return bad(`No joist size in IRC Table R507.6 spans this deck at ${spacingLabel} even with 4 beams.`, 'to');
  const joistDepth = sectionDims(catalog, joistSize).depth;
  const joistTop = height - deckT;
  const beamTop = joistTop - joistDepth;
  if (beamTop - beamDepth < 2 * IN - 1e-6) {
    return bad(
      `A deck ${fi(height)} up is too low for posts, doubled 2x10 beams and ${joistSize} joists (it needs about ${fi(deckT + joistDepth + beamDepth + 2 * IN)}).`,
      'height',
      'For a low deck, pour a slab (pour_slab) or make it taller.',
    );
  }

  const footing = footingDepth(project, siteDefaults);
  const seq = builderSeq(project, DECK_BUILDER);
  const asm = '#d';
  const railAsm = '#rl';
  const stairAsm = '#st';
  const step = { phase: 'floor' as const, seq };
  const railStep = { phase: 'finish' as const, seq };
  const stairStep = { phase: 'framing' as const, seq };
  const specs = new SpecList('d');
  const joints: JointSpec[] = [];
  const notes: string[] = [];
  const worldOf = (f: PlanFrame) => (q: FrameVec) => {
    const w = toWorld(f, q);
    return { x: round6(w.x), y: round6(w.y), z: round6(w.z) };
  };
  const at = worldOf(frame);
  const add = (
    assembly: Ref,
    role: PartRole,
    tags: string[],
    box: FrameBox,
    lengthAxis: FrameAxis,
    widthAxis: FrameAxis,
    materialId: string,
    sectionId: string | undefined,
    buildStep: BuildStep,
    f = frame,
  ) =>
    specs.add(f, { assembly, role, tags, box, lengthAxis, widthAxis, materialId, ...(sectionId ? { sectionId } : {}), buildStep });

  // ── Posts, piers and beams ──
  const rowCentres = Array.from({ length: rows }, (_, i) => T + p / 2 + i * spanFor(rows));
  const postBays = Math.max(1, Math.ceil((LU - p) / DECK_BEAM_MAX_SPAN_MM - 1e-9));
  const postU = Array.from({ length: postBays + 1 }, (_, k) => p / 2 + (k * (LU - p)) / postBays);
  const rowPlies: Array<[Ref, Ref]> = [];
  let postCount = 0;
  for (const [ri, wc] of rowCentres.entries()) {
    const posts: Ref[] = [];
    for (const uc of postU) {
      const post = add(asm, 'post', ['deck-post'], { u0: uc - p / 2, u1: uc + p / 2, v0: 0, v1: beamTop, w0: wc - p / 2, w1: wc + p / 2 }, 'v', 'u', wood, S.deckPost, step);
      const pier = add(asm, 'pier', ['post-footing', 'sonotube'], { u0: uc - PIER_HALF, u1: uc + PIER_HALF, v0: -footing.mm, v1: 0, w0: wc - PIER_HALF, w1: wc + PIER_HALF }, 'v', 'u', materials.concrete, undefined, step);
      joints.push({ a: post, b: pier, jointTypeId: J.postBase, at: at({ u: uc, v: 0, w: wc }), fastenerCount: 1 });
      joints.push({ a: pier, b: GROUND, jointTypeId: J.castInPlace, at: at({ u: uc, v: -footing.mm, w: wc }), fastenerCount: 1 });
      posts.push(post);
      postCount++;
    }
    const plies = [wc - p / 2 - T, wc + p / 2].map((w0) => {
      const ply = add(asm, 'beam', ['deck-beam', `row:${ri + 1}`], { u0: 0, u1: LU, v0: beamTop - beamDepth, v1: beamTop, w0, w1: w0 + T }, 'u', 'w', wood, S.deckBeam, step);
      posts.forEach((post, k) => joints.push({ a: ply, b: post, jointTypeId: J.boltedThrough, at: at({ u: postU[k]!, v: beamTop - beamDepth / 2, w: w0 + T / 2 }), fastenerCount: 2 }));
      return ply;
    }) as [Ref, Ref];
    rowPlies.push(plies);
  }

  // ── Rims and joists ──
  const rimLow = add(asm, 'rim', ['rim-joist'], { u0: 0, u1: LU, v0: beamTop, v1: joistTop, w0: 0, w1: T }, 'u', 'w', wood, joistSize, step);
  const rimHigh = add(asm, 'rim', ['rim-joist'], { u0: 0, u1: LU, v0: beamTop, v1: joistTop, w0: LW - T, w1: LW }, 'u', 'w', wood, joistSize, step);
  joints.push({ a: rimLow, b: rowPlies[0]![0], jointTypeId: J.nail16d, at: at({ u: LU / 2, v: beamTop, w: T / 2 }), fastenerCount: framingNailCount(LU) });
  joints.push({ a: rimHigh, b: rowPlies[rows - 1]![1], jointTypeId: J.nail16d, at: at({ u: LU / 2, v: beamTop, w: LW - T / 2 }), fastenerCount: framingNailCount(LU) });
  const joistU: number[] = [0];
  for (let k = 1; k * spacing - T / 2 < LU - T - 0.75 * IN; k++) {
    const u0 = k * spacing - T / 2;
    if (u0 + T > LU - T - 0.75 * IN) break;
    joistU.push(u0);
  }
  joistU.push(LU - T);
  const joists: Ref[] = [];
  for (const [k, u0] of joistU.entries()) {
    const end = k === 0 || k === joistU.length - 1;
    const key = add(asm, 'joist', [end ? 'end-joist' : 'common'], { u0, u1: u0 + T, v0: beamTop, v1: joistTop, w0: T, w1: LW - T }, 'w', 'u', wood, joistSize, step);
    joists.push(key);
    const uc = u0 + T / 2;
    joints.push({ a: key, b: rimLow, jointTypeId: J.nail16d, at: at({ u: uc, v: beamTop + joistDepth / 2, w: T }), fastenerCount: JOIST_TO_RIM_NAILS });
    joints.push({ a: key, b: rimHigh, jointTypeId: J.nail16d, at: at({ u: uc, v: beamTop + joistDepth / 2, w: LW - T }), fastenerCount: JOIST_TO_RIM_NAILS });
    rowPlies.forEach((plies, ri) => {
      const ply = ri === 0 ? plies[1] : plies[0];
      const wc = ri === 0 ? rowCentres[0]! + p / 2 + T / 2 : rowCentres[ri]! - p / 2 - T / 2;
      joints.push({ a: key, b: ply, jointTypeId: J.hurricaneTie, at: at({ u: uc, v: beamTop, w: wc }), fastenerCount: 1 });
    });
  }

  // ── Decking ──
  const nBoards = Math.max(1, Math.floor((LW + BOARD_GAP) / (board.depth + BOARD_GAP) + 1e-9));
  const pitch = LW / nBoards;
  for (let i = 0; i < nBoards; i++) {
    const w0 = i * pitch + (pitch - board.depth) / 2;
    const key = add(asm, 'sheathing', ['decking', composite ? 'composite' : 'wood'], { u0: 0, u1: LU, v0: joistTop, v1: height, w0, w1: w0 + board.depth }, 'u', 'w', decking, S.deckBoard, step);
    // Boards over the joists (the outermost board may land on a rim instead).
    const wc = w0 + board.depth / 2;
    const overJoists = wc > T && wc < LW - T;
    if (overJoists) {
      joistU.forEach((u0, k) => joints.push({ a: key, b: joists[k]!, jointTypeId: J.screwedDeck, at: at({ u: u0 + T / 2, v: joistTop, w: wc }), fastenerCount: 2 }));
    } else {
      joints.push({ a: key, b: wc <= T ? rimLow : rimHigh, jointTypeId: J.screwedDeck, at: at({ u: LU / 2, v: joistTop, w: wc }), fastenerCount: framingNailCount(LU) });
    }
  }

  // ── Sides: one frame per side, u' along the side, w' outward from the rim face ──
  const corner = (u: number, w: number) => toWorld(frame, { u, v: 0, w });
  const centre = corner(LU / 2, LW / 2);
  const sideFrames: SideFrame[] = [];
  const loop: Array<[number, number, number, number, Ref]> = [
    [0, 0, LU, 0, rimLow],
    [LU, 0, LU, LW, joists[joists.length - 1]!],
    [LU, LW, 0, LW, rimHigh],
    [0, LW, 0, 0, joists[0]!],
  ];
  for (const [ua, wa, ub, wb, rim] of loop) {
    const A = corner(ua, wa);
    const B = corner(ub, wb);
    const angleDeg = (Math.atan2(B.z - A.z, B.x - A.x) * 180) / Math.PI;
    const mid = { x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 };
    const rad = (angleDeg * Math.PI) / 180;
    // +w' with wSign 1 is (−sin, cos); pick the sign that points away from the deck centre.
    const out = (-Math.sin(rad) * (mid.x - centre.x) + Math.cos(rad) * (mid.z - centre.z)) >= 0 ? 1 : -1;
    const f: PlanFrame = { origin: { x: A.x, y: 0, z: A.z }, angleDeg, wSign: out };
    const n = { x: -Math.sin(rad) * out, z: Math.cos(rad) * out };
    // Name the side by its outward normal.
    const side = compass(n.x, n.z) as Side;
    // Ordered so `at` runs from the west end (north and south sides) or the north end (east and west sides).
    sideFrames.push({ side, frame: f, len: Math.hypot(B.x - A.x, B.z - A.z), rim });
  }
  /** `at` along a side (from its west or north end) in the side frame's u'. */
  const alongSide = (sf: SideFrame, atMm: number, width: number) => {
    const dirX = Math.cos((sf.frame.angleDeg * Math.PI) / 180);
    const dirZ = Math.sin((sf.frame.angleDeg * Math.PI) / 180);
    const forward = sf.side === 'north' || sf.side === 'south' ? dirX > 0 : dirZ > 0;
    return forward ? atMm : sf.len - atMm - width;
  };

  // ── Stairs ──
  let stairOpening: { side: Side; u0: number; u1: number } | null = null;
  let risers = 0;
  let stringerCount = 0;
  let stringerSize = '';
  if (input.stairs) {
    const st = input.stairs;
    const width = st.width ?? 3 * FT;
    const sf = sideFrames.find((s) => s.side === st.side);
    if (!sf) return bad(`The deck has no ${st.side} side.`, 'stairs.side');
    const u0 = alongSide(sf, st.at, width);
    const postW = sectionDims(catalog, S.railPost).width;
    if (width < 3 * FT - 1e-6) return bad(`Stairs must be at least 3' 0" wide (IRC R311.7.1); you gave ${fi(width)}.`, 'stairs.width');
    if (u0 < (guard ? postW : 0) - 1e-6 || u0 + width > sf.len - (guard ? postW : 0) + 1e-6) {
      return bad(`Stairs ${fi(width)} wide starting ${fi(st.at)} along the ${st.side} side don't fit on its ${fi(sf.len)}.`, 'stairs.at');
    }
    stairOpening = { side: st.side, u0, u1: u0 + width };
    risers = Math.max(2, Math.ceil(height / STAIR_MAX_RISER_MM - 1e-9));
    const riser = height / risers;
    const run = 2 * board.depth + BOARD_GAP;
    const tan = riser / run;
    const cos = Math.cos(Math.atan(tan));
    const sin = Math.sin(Math.atan(tan));
    const vTop0 = height - deckT - riser;
    const size = (['2x12', '2x10', '2x8', '2x6'] as const).find((s) => catalog.sections.has(s) && vTop0 - sectionDims(catalog, s).depth / cos >= 1 * IN);
    if (!size) return bad(`A deck ${fi(height)} up is too low for framed stairs; use a step box or a single step.`, 'stairs');
    stringerSize = size;
    const sd = sectionDims(catalog, size).depth;
    const vb = vTop0 - sd / cos;
    const tB = vb / tan;
    const sLen = tB / cos;
    const sat = worldOf(sf.frame);
    stringerCount = Math.max(2, Math.ceil((width - T) / STAIR_MAX_STRINGER_SPACING_MM - 1e-9) + 1);
    const stringers: Array<{ ref: Ref; u: number }> = [];
    for (let k = 0; k < stringerCount; k++) {
      const u = u0 + (k * (width - T)) / (stringerCount - 1);
      const placed = placeOriented(
        sf.frame,
        { u, v: vb, w: 0 },
        { x: { u: 0, v: -sin, w: cos }, y: { u: 1, v: 0, w: 0 }, z: { u: 0, v: cos, w: sin } },
        { length: sLen, width: T, height: sd },
      );
      const ref = specs.addPlaced({ assembly: stairAsm, role: 'beam', materialId: wood, sectionId: size, tags: ['stair-stringer', 'notches-not-modelled'], buildStep: stairStep, ...placed });
      stringers.push({ ref, u });
      joints.push({ a: ref, b: sf.rim, jointTypeId: J.boltedThrough, at: sat({ u: u + T / 2, v: vb + sd / 2, w: 0 }), fastenerCount: 2 });
    }
    // Pad on grade under the stringer feet.
    const pad = add(stairAsm, 'slab', ['stair-pad'], { u0, u1: u0 + width, v0: -PAD_THICKNESS, v1: 0, w0: tB - 6 * IN, w1: tB + Math.max(12 * IN, sd * sin + 2 * IN) }, 'u', 'w', materials.concrete, undefined, stairStep, sf.frame);
    joints.push({ a: pad, b: GROUND, jointTypeId: J.castInPlace, at: sat({ u: u0 + width / 2, v: -PAD_THICKNESS, w: tB }), fastenerCount: 1 });
    for (const s of stringers) joints.push({ a: s.ref, b: pad, jointTypeId: J.anchorBolt, at: sat({ u: s.u + T / 2, v: 0, w: tB }), fastenerCount: 1 });
    // Treads: two deck boards per step, their back edges on the stringers' top line.
    for (let i = 1; i < risers; i++) {
      const top = height - i * riser;
      for (let b = 0; b < 2; b++) {
        const w0 = (i - 1) * run + b * (board.depth + BOARD_GAP);
        const tread = add(stairAsm, 'panel', ['stair-tread', `step:${i}`], { u0, u1: u0 + width, v0: top - deckT, v1: top, w0, w1: w0 + board.depth }, 'u', 'w', decking, S.deckBoard, stairStep, sf.frame);
        for (const s of stringers) joints.push({ a: tread, b: s.ref, jointTypeId: J.screwedDeck, at: sat({ u: s.u + T / 2, v: top - deckT, w: w0 + board.depth / 2 }), fastenerCount: 2 });
      }
    }
    // Handrail on both sides from four risers up (IRC R311.7.8).
    if (risers >= STAIR_HANDRAIL_RISERS) {
      const pw = sectionDims(catalog, S.railPost).width;
      const cap = sectionDims(catalog, S.railCap);
      const rail = sectionDims(catalog, S.purlin);
      const tEnd = (risers - 1) * run;
      const ta = cap.depth;
      const railLine = (t: number) => height - t * tan + HANDRAIL_ABOVE_NOSING;
      for (const [k, uPost] of [
        [0, u0 - pw],
        [stringerCount - 1, u0 + width],
      ] as const) {
        const outer = stringers[k]!.ref;
        const postsHere: Ref[] = [];
        for (const t0 of [ta, tEnd - pw]) {
          const bottom = Math.max(0, vb - (t0 + pw) * tan);
          const post = add(stairAsm, 'post', ['stair-rail-post'], { u0: uPost, u1: uPost + pw, v0: bottom, v1: railLine(t0 + pw), w0: t0, w1: t0 + pw }, 'v', 'u', wood, S.railPost, stairStep, sf.frame);
          joints.push({ a: post, b: outer, jointTypeId: J.boltedThrough, at: sat({ u: k === 0 ? u0 : u0 + width, v: Math.max(bottom, vb - t0 * tan) + 2 * IN, w: t0 + pw / 2 }), fastenerCount: 2 });
          postsHere.push(post);
        }
        const placed = placeOriented(
          sf.frame,
          { u: uPost + pw / 2 - T / 2, v: railLine(ta), w: ta },
          { x: { u: 0, v: -sin, w: cos }, y: { u: 1, v: 0, w: 0 }, z: { u: 0, v: cos, w: sin } },
          { length: (tEnd - ta) / cos, width: T, height: rail.depth },
        );
        const hr = specs.addPlaced({ assembly: stairAsm, role: 'rail', materialId: wood, sectionId: S.purlin, tags: ['stair-handrail'], buildStep: stairStep, ...placed });
        postsHere.forEach((post, j) => {
          const t = j === 0 ? ta + pw / 2 : tEnd - pw / 2;
          joints.push({ a: hr, b: post, jointTypeId: J.screwedDeck, at: sat({ u: uPost + pw / 2, v: railLine(t), w: t }), fastenerCount: 2 });
        });
      }
    }
  }

  // ── Guards ──
  let guardPosts = 0;
  if (guard) {
    const pw = sectionDims(catalog, S.railPost).width;
    const cap = sectionDims(catalog, S.railCap);
    const bal = sectionDims(catalog, S.baluster);
    const bottomRail = sectionDims(catalog, S.purlin);
    const capTop = height + DECK_GUARD_HEIGHT_MM;
    const capBottom = capTop - cap.width;
    const postBottom = beamTop;
    const maxBay = guard === 'cable' ? CABLE_POST_MAX_SPACING_MM : DECK_RAIL_POST_MAX_SPACING_MM;
    for (const sf of sideFrames) {
      const sat = worldOf(sf.frame);
      // Spans of rail along the side, broken at the stair opening.
      const spans: Array<[number, number]> =
        stairOpening && stairOpening.side === sf.side
          ? [
              [0, stairOpening.u0],
              [stairOpening.u1, sf.len],
            ]
          : [[0, sf.len]];
      for (const [a, b] of spans) {
        if (b - a < 2 * pw) continue;
        const bays = Math.max(1, Math.ceil((b - a - pw) / maxBay - 1e-9));
        const centres = Array.from({ length: bays + 1 }, (_, k) => a + pw / 2 + (k * (b - a - pw)) / bays);
        const posts = centres.map((c) => {
          const post = add(railAsm, 'post', ['guard-post'], { u0: c - pw / 2, u1: c + pw / 2, v0: postBottom, v1: capBottom, w0: 0, w1: pw }, 'v', 'u', wood, S.railPost, railStep, sf.frame);
          joints.push({ a: post, b: sf.rim, jointTypeId: J.boltedThrough, at: sat({ u: c, v: joistTop - joistDepth / 2, w: 0 }), fastenerCount: 2 });
          guardPosts++;
          return post;
        });
        const capRef = add(railAsm, 'rail', ['guard-cap'], { u0: a, u1: b, v0: capBottom, v1: capTop, w0: 0, w1: cap.depth }, 'u', 'v', wood, S.railCap, railStep, sf.frame);
        posts.forEach((post, k) => joints.push({ a: capRef, b: post, jointTypeId: J.screwedDeck, at: sat({ u: centres[k]!, v: capBottom, w: pw / 2 }), fastenerCount: 2 }));
        for (let k = 0; k < bays; k++) {
          const c0 = centres[k]! + pw / 2;
          const c1 = centres[k + 1]! - pw / 2;
          if (guard === 'wood') {
            const br = add(railAsm, 'rail', ['guard-bottom-rail'], { u0: c0, u1: c1, v0: height + 2 * IN, v1: height + 2 * IN + T, w0: 0, w1: bottomRail.depth }, 'u', 'v', wood, S.purlin, railStep, sf.frame);
            joints.push({ a: br, b: posts[k]!, jointTypeId: J.screwedDeck, at: sat({ u: c0, v: height + 2 * IN, w: pw / 2 }), fastenerCount: 2 });
            joints.push({ a: br, b: posts[k + 1]!, jointTypeId: J.screwedDeck, at: sat({ u: c1, v: height + 2 * IN, w: pw / 2 }), fastenerCount: 2 });
            // Balusters under 4in apart (IRC R312.1.3).
            const span = c1 - c0;
            const n = Math.max(1, Math.ceil((span - (GUARD_MAX_OPENING_MM - 0.5 * IN)) / (bal.width + GUARD_MAX_OPENING_MM - 0.5 * IN) - 1e-9));
            const gapB = (span - n * bal.width) / (n + 1);
            for (let i = 0; i < n; i++) {
              const bu = c0 + gapB + i * (bal.width + gapB);
              const b2 = add(railAsm, 'post', ['guard-baluster'], { u0: bu, u1: bu + bal.width, v0: height + 2 * IN + T, v1: capBottom, w0: pw / 2 - bal.depth / 2, w1: pw / 2 + bal.depth / 2 }, 'v', 'u', wood, S.baluster, railStep, sf.frame);
              joints.push({ a: b2, b: br, jointTypeId: J.screwedDeck, at: sat({ u: bu + bal.width / 2, v: height + 2 * IN + T, w: pw / 2 }), fastenerCount: 1 });
              joints.push({ a: b2, b: capRef, jointTypeId: J.screwedDeck, at: sat({ u: bu + bal.width / 2, v: capBottom, w: pw / 2 }), fastenerCount: 1 });
            }
          } else {
            const thick = guard === 'glass' ? 12 : 6;
            const inset = guard === 'glass' ? 0.5 * IN : 0;
            const infill = add(
              railAsm,
              'panel',
              [guard === 'glass' ? 'guard-glass' : 'guard-cable'],
              { u0: c0 + inset, u1: c1 - inset, v0: height + 2 * IN, v1: capBottom - (guard === 'glass' ? 2 * IN : 1 * IN), w0: pw / 2 - thick / 2, w1: pw / 2 + thick / 2 },
              'u',
              'w',
              guard === 'glass' ? D.glassRailing : D.cableRail,
              undefined,
              railStep,
              sf.frame,
            );
            joints.push({ a: infill, b: posts[k]!, jointTypeId: J.screwedStructural, at: sat({ u: c0, v: (height + capBottom) / 2, w: pw / 2 }), fastenerCount: 2 });
            joints.push({ a: infill, b: posts[k + 1]!, jointTypeId: J.screwedStructural, at: sat({ u: c1, v: (height + capBottom) / 2, w: pw / 2 }), fastenerCount: 2 });
          }
        }
      }
    }
  }

  notes.push('It is freestanding: attaching a deck to the house with a ledger is not supported yet.');
  notes.push(`The piers go ${fi(footing.mm)} deep (${footing.note}).`);
  if (guard) notes.push(`Guards are ${fi(DECK_GUARD_HEIGHT_MM)} tall above the decking with openings under 4in (IRC R312.1).`);

  const name = input.name ?? 'Deck';
  const params: Record<string, unknown> = {
    from: { x: x0, z: z0 },
    to: { x: x1, z: z1 },
    height,
    joistSize,
    spacing: spacingLabel,
    joistDirection: joistAxis,
    decking,
    railing: guard ?? 'none',
    materials,
  };
  if (input.stairs) params.stairs = { side: input.stairs.side, at: input.stairs.at, width: input.stairs.width ?? 3 * FT };
  const assemblies: AssemblySpec[] = [{ key: asm, kind: 'floor', name, buildStep: step, builder: () => ({ name: DECK_BUILDER, params }) }];
  if (guard) {
    assemblies.push({ key: railAsm, kind: 'misc', name: `${name} railing`, buildStep: railStep, builder: (id) => ({ name: DECK_BUILDER, params: { part: 'railing', deck: id(asm) } }) });
  }
  if (input.stairs) {
    assemblies.push({ key: stairAsm, kind: 'misc', name: `${name} stairs`, buildStep: stairStep, builder: (id) => ({ name: DECK_BUILDER, params: { part: 'stairs', deck: id(asm) } }) });
  }
  const deckingName = composite ? 'composite' : '5/4x6 wood';
  return {
    ok: true,
    layout: {
      assemblies,
      parts: specs.parts,
      joints,
      notes,
      what: 'The new deck',
      summary: (id) =>
        `Built deck ${id(asm)} "${name}": ${fi(LU)} × ${fi(LW)}, ${fi(height)} up, ${postCount} 6x6 posts on piers, ${rows} doubled 2x10 beams, ${joists.length} ${joistSize} joists at ${spacingLabel} (IRC R507.6), ${nBoards} rows of ${deckingName} decking` +
        (guard ? `; ${guard} guard ${id(railAsm)} on ${guardPosts} posts` : '') +
        (input.stairs ? `; stairs ${id(stairAsm)} down the ${input.stairs.side} side: ${risers} risers of ${fi(height / risers)} on ${stringerCount} ${stringerSize} stringers` : '') +
        '.',
    },
  };
}
