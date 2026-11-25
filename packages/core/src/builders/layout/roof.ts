/**
 * build_roof layout: stick-framed gable or shed roof on existing walls. Common rafters
 * on layout from the footprint corner, a ridge board one size deeper (gable), rafter
 * ties at plate level (gable), and OSB roof sheathing. Birdsmouths are not modelled:
 * each rafter's underside passes through the outside face of the wall sheathing at
 * plate height.
 */
import type { CatalogIndex } from '../../catalog/validate.ts';
import { commandError, type CommandError } from '../../commands/errors.ts';
import { boxInFrame, placeOriented, toWorld, type FrameBox, type FrameVec, type PlanFrame } from '../../geometry/frame.ts';
import type { Project } from '../../model/schema.ts';
import { MM_PER_FOOT, MM_PER_INCH } from '../../units/length.ts';
import { formatPitch, type Pitch } from '../../units/pitch.ts';
import { BUILDER_DEFAULTS, resolveMaterials, type BuilderMaterialsInput } from '../defaults.ts';
import { SpecList, fail, type JointSpec, type LayoutResult, type Ref } from '../emit.ts';
import {
  HEEL_JOINT_NAILS,
  MAX_PITCH_RISE,
  MIN_PITCH_RISE,
  RAFTER_NAILS,
  RIDGE_FOR_RAFTER,
  SPACING_MM,
  STOCK_LENGTH_MM,
  sheathingNailCount,
} from '../rules.ts';
import { builderSeq, compass, fi, requireMaterial, requireSection, round6, sectionDims, type PlanPoint } from '../util.ts';
import { WALL_BUILDER, type WallParams } from './wall-state.ts';

const IN = MM_PER_INCH;
const T = BUILDER_DEFAULTS.twoBy;
const GAP = 0.75 * IN;
export const ROOF_BUILDER = 'build_roof';

export interface BuildRoofInput {
  type: 'gable' | 'shed';
  from: PlanPoint;
  to: PlanPoint;
  pitch: Pitch;
  ridgeAxis?: 'x' | 'z';
  lowSide?: 'north' | 'south' | 'east' | 'west';
  rafterSize?: '2x6' | '2x8' | '2x10';
  spacing?: '12in' | '16in' | '24in';
  overhang?: number;
  rake?: number;
  bearingHeight?: number;
  sheathing?: boolean;
  materials?: BuilderMaterialsInput;
  name?: string;
}

interface EdgeWalls {
  walls: Array<{ id: string; params: WallParams }>;
  /** Top of cap plate, if all walls agree. */
  top: number | null;
  mismatch: boolean;
  sheathing: number;
  depth: number;
}

/** Builder walls whose outside face runs along the line w = wEdge (in the roof frame). */
function wallsOnEdge(project: Project, frame: PlanFrame, wEdge: number): EdgeWalls {
  const walls: EdgeWalls['walls'] = [];
  for (const asm of Object.values(project.assemblies)) {
    if (asm.builder?.name !== WALL_BUILDER) continue;
    const p = asm.builder.params as unknown as WallParams;
    const a = toFrameXZ(frame, p.start);
    const b = toFrameXZ(frame, p.end);
    if (Math.abs(a.w - wEdge) < 1 && Math.abs(b.w - wEdge) < 1) walls.push({ id: asm.id, params: p });
  }
  const tops = walls.map((w) => w.params.baseElevation + w.params.height);
  const top = tops.length > 0 ? Math.max(...tops) : null;
  return {
    walls,
    top,
    mismatch: tops.some((t) => Math.abs(t - top!) > 1),
    sheathing: Math.max(0, ...walls.map((w) => w.params.sheathingThickness)),
    depth: Math.max(0, ...walls.map((w) => w.params.depth)),
  };
}

function toFrameXZ(f: PlanFrame, p: PlanPoint): { u: number; w: number } {
  const rad = (f.angleDeg * Math.PI) / 180;
  const dx = p.x - f.origin.x;
  const dz = p.z - f.origin.z;
  return { u: dx * Math.cos(rad) + dz * Math.sin(rad), w: f.wSign * (-dx * Math.sin(rad) + dz * Math.cos(rad)) };
}

export function layoutRoof(project: Project, input: BuildRoofInput, catalog: CatalogIndex): LayoutResult {
  const bad = (msg: string, path: string, hint?: string): LayoutResult =>
    fail(commandError('invalid_input', msg, { path, ...(hint ? { hint } : {}) }));
  const x0 = Math.min(input.from.x, input.to.x);
  const x1 = Math.max(input.from.x, input.to.x);
  const z0 = Math.min(input.from.z, input.to.z);
  const z1 = Math.max(input.from.z, input.to.z);
  if (x1 - x0 < 4 * MM_PER_FOOT || z1 - z0 < 4 * MM_PER_FOOT) return bad('A roof footprint must be at least 4\' 0" on each side.', 'to');
  const pitch = input.pitch;
  if (pitch.rise < MIN_PITCH_RISE - 1e-6 || pitch.rise > MAX_PITCH_RISE + 1e-6) {
    return bad(`A roof pitch must be between ${MIN_PITCH_RISE} in 12 and ${MAX_PITCH_RISE} in 12 (you gave ${formatPitch(pitch)}).`, 'pitch');
  }
  const rafterSection = input.rafterSize ?? '2x6';
  const ridgeSection = RIDGE_FOR_RAFTER[rafterSection]!;
  const spacingLabel = input.spacing ?? '16in';
  const spacing = SPACING_MM[spacingLabel];
  const overhang = input.overhang ?? 12 * IN;
  const rake = input.rake ?? 0;
  const sheathe = input.sheathing ?? true;
  const materials = resolveMaterials(input.materials);
  const errors: CommandError[] = [];
  for (const e of [
    requireSection(catalog, rafterSection, 'rafterSize'),
    input.type === 'gable' ? requireSection(catalog, ridgeSection, 'rafterSize') : null,
    requireMaterial(catalog, materials.lumber, ['lumber'], 'materials.lumber'),
    sheathe ? requireMaterial(catalog, materials.sheathing, ['sheet'], 'materials.sheathing') : null,
  ]) {
    if (e) errors.push(e);
  }
  if (errors.length > 0) return { ok: false, errors };
  if (overhang < 0) return bad('"overhang" can\'t be negative.', 'overhang');
  if (rake < 0) return bad('"rake" can\'t be negative.', 'rake');

  // Roof frame: u along the ridge (or the low eave), w across, low/first eave at w = 0.
  let frame: PlanFrame;
  let LR: number;
  let S: number;
  if (input.type === 'gable') {
    const axis = input.ridgeAxis ?? (x1 - x0 >= z1 - z0 ? 'x' : 'z');
    frame = axis === 'x' ? { origin: { x: x0, y: 0, z: z0 }, angleDeg: 0, wSign: 1 } : { origin: { x: x0, y: 0, z: z0 }, angleDeg: 90, wSign: -1 };
    LR = axis === 'x' ? x1 - x0 : z1 - z0;
    S = axis === 'x' ? z1 - z0 : x1 - x0;
  } else {
    if (!input.lowSide) return bad('A shed roof needs "lowSide" (north, south, east or west).', 'lowSide');
    const low = input.lowSide;
    frame =
      low === 'north'
        ? { origin: { x: x0, y: 0, z: z0 }, angleDeg: 0, wSign: 1 }
        : low === 'south'
          ? { origin: { x: x0, y: 0, z: z1 }, angleDeg: 0, wSign: -1 }
          : low === 'west'
            ? { origin: { x: x0, y: 0, z: z0 }, angleDeg: 90, wSign: -1 }
            : { origin: { x: x1, y: 0, z: z0 }, angleDeg: 90, wSign: 1 };
    LR = low === 'north' || low === 'south' ? x1 - x0 : z1 - z0;
    S = low === 'north' || low === 'south' ? z1 - z0 : x1 - x0;
  }
  const wDir = toWorld({ ...frame, origin: { x: 0, y: 0, z: 0 } }, { u: 0, v: 0, w: 1 });
  const sideName = (side: 0 | 1) => (side === 0 ? compass(-wDir.x, -wDir.z) : compass(wDir.x, wDir.z));

  const edgeA = wallsOnEdge(project, frame, 0);
  const edgeB = wallsOnEdge(project, frame, S);
  for (const [edge, side] of [
    [edgeA, 0],
    [edgeB, 1],
  ] as const) {
    if (edge.mismatch) return bad(`The ${sideName(side)} walls are not all the same height, so the roof can't bear on all of them.`, 'bearingHeight');
  }

  const r = pitch.ratio;
  const cos = Math.cos(Math.atan(r));
  const sin = Math.sin(Math.atan(r));
  const rafterDepth = sectionDims(catalog, rafterSection).depth;
  let yb: number; // low (or both) bearing height
  if (input.bearingHeight !== undefined) yb = input.bearingHeight;
  else if (input.type === 'gable') {
    if (edgeA.top === null || edgeB.top === null) {
      const side = edgeA.top === null ? 0 : 1;
      return bad(`There are no walls under the ${sideName(side)} edge of the roof to bear on.`, 'from', 'Build the walls first (their outside faces on the footprint edges), or give "bearingHeight".');
    }
    if (Math.abs(edgeA.top - edgeB.top) > 1) {
      return bad(
        `The ${sideName(0)} walls top out at ${fi(edgeA.top)} but the ${sideName(1)} walls at ${fi(edgeB.top)}; a gable needs them level.`,
        'bearingHeight',
      );
    }
    yb = edgeA.top;
  } else {
    if (edgeA.top === null) {
      return bad(`There are no walls under the low (${sideName(0)}) edge of the roof to bear on.`, 'lowSide', 'Build the walls first, or give "bearingHeight".');
    }
    yb = edgeA.top;
  }
  const t = input.type === 'gable' ? Math.max(edgeA.sheathing, edgeB.sheathing) : edgeA.sheathing;

  // Rafter geometry along w (side A runs from the eave at w = -overhang up towards +w).
  const highW = input.type === 'gable' ? S / 2 - T / 2 : S + overhang;
  const rafterRun = highW + overhang;
  const rafterLen = rafterRun / cos;
  if (rafterLen > STOCK_LENGTH_MM + 1e-6) {
    return bad(
      `A ${formatPitch(pitch)} ${input.type} roof over ${fi(S)} needs ${fi(rafterLen)} rafters, past the ${fi(STOCK_LENGTH_MM)} stock length.`,
      'pitch',
      'Lower the pitch, shorten the overhang, or add a bearing wall mid-span.',
    );
  }
  const edgeY = (w: number) => yb + (w + t) * r; // underside of side-A rafters at w

  if (input.type === 'shed') {
    const dHigh = edgeB.depth || sectionDims(catalog, '2x4').depth;
    const needed = edgeY(S - dHigh);
    if (edgeB.top !== null) {
      if (edgeB.top < needed - 1.5 * IN) {
        return bad(
          `The ${sideName(1)} walls top out at ${fi(edgeB.top)} but a ${formatPitch(pitch)} shed roof over ${fi(S)} needs them at ${fi(needed)}. Build them taller or lower the pitch.`,
          'pitch',
        );
      }
      if (edgeB.top > needed + 1) {
        return bad(
          `The ${sideName(1)} walls top out at ${fi(edgeB.top)}, above the roof line (${fi(needed)}) of a ${formatPitch(pitch)} shed roof over ${fi(S)}. Lower them or steepen the pitch.`,
          'pitch',
        );
      }
    }
  }

  const asm = '#r';
  const step = { phase: 'roofing' as const, seq: builderSeq(project, ROOF_BUILDER) };
  const specs = new SpecList('r');
  const joints: JointSpec[] = [];
  const J = BUILDER_DEFAULTS.jointTypes;
  const at = (p: FrameVec) => {
    const w = toWorld(frame, p);
    return { x: round6(w.x), y: round6(w.y), z: round6(w.z) };
  };

  // Rafter positions along u.
  const positions: Array<{ u0: number; fly: boolean }> = [{ u0: 0, fly: false }];
  for (let n = 1; n * spacing - T / 2 < LR - T - GAP; n++) {
    const u0 = n * spacing - T / 2;
    if (u0 < T + GAP - 1e-6 || u0 + T > LR - T - GAP + 1e-6) continue;
    positions.push({ u0, fly: false });
  }
  positions.push({ u0: LR - T, fly: false });
  if (rake > 0) {
    positions.unshift({ u0: -rake, fly: true });
    positions.push({ u0: LR + rake - T, fly: true });
  }

  const sides: Array<0 | 1> = input.type === 'gable' ? [0, 1] : [0];
  /** Place a rafter on a side; returns its key and its frame box. */
  const rafter = (side: 0 | 1, u0: number, fly: boolean) => {
    const s = side === 0 ? 1 : -1;
    const wEave = side === 0 ? -overhang : S + overhang;
    const origin = { u: u0, v: edgeY(-overhang), w: wEave };
    const placed = placeOriented(
      frame,
      origin,
      { x: { u: 0, v: sin, w: s * cos }, y: { u: 1, v: 0, w: 0 }, z: { u: 0, v: cos, w: -s * sin } },
      { length: rafterLen, width: T, height: rafterDepth },
    );
    const key = specs.addPlaced({
      assembly: asm,
      role: 'rafter',
      materialId: materials.lumber,
      sectionId: rafterSection,
      tags: [fly ? 'fly-rafter' : 'common', `side:${sideName(side)}`, 'birdsmouth-not-modelled'],
      buildStep: step,
      ...placed,
    });
    return { key, box: boxInFrame(frame, placed) };
  };

  const rafters: Array<{ key: Ref; side: 0 | 1; u0: number; fly: boolean }> = [];
  for (const p of positions) for (const side of sides) rafters.push({ ...rafter(side, p.u0, p.fly), side, u0: p.u0, fly: p.fly });

  // Ridge (gable): top flush with the rafter tops at the ridge face.
  let ridge: Ref | null = null;
  if (input.type === 'gable') {
    const ridgeDepth = sectionDims(catalog, ridgeSection).depth;
    const ridgeTop = edgeY(S / 2 - T / 2) + rafterDepth / cos;
    ridge = specs.add(frame, {
      assembly: asm,
      role: 'ridge',
      tags: ['ridge-board'],
      box: { u0: -rake, u1: LR + rake, v0: ridgeTop - ridgeDepth, v1: ridgeTop, w0: S / 2 - T / 2, w1: S / 2 + T / 2 },
      lengthAxis: 'u',
      widthAxis: 'w',
      materialId: materials.lumber,
      sectionId: ridgeSection,
      buildStep: step,
    });
    for (const rf of rafters) {
      joints.push({
        a: rf.key,
        b: ridge,
        jointTypeId: J.nail16d,
        at: at({ u: rf.u0 + T / 2, v: ridgeTop - rafterDepth / cos / 2, w: rf.side === 0 ? S / 2 - T / 2 : S / 2 + T / 2 }),
        fastenerCount: RAFTER_NAILS,
      });
    }
  }

  // Rafters to the cap plates they sit on: any builder wall's cap plate inside the
  // footprint whose plan strip lies on the bearing line (at a butted corner that is
  // the end wall's plate).
  const caps = Object.values(project.parts)
    .filter((p) => p.role === 'plate' && p.tags.includes('top-cap') && project.assemblies[p.assemblyId]?.builder?.name === WALL_BUILDER)
    .map((p) => ({ part: p, box: boxInFrame(frame, p) }))
    .filter(({ box }) => box.u0 > -rake - 1 && box.u1 < LR + rake + 1 && box.w0 > -1 && box.w1 < S + 1);
  const strip = (side: 0 | 1) => {
    const d = (side === 0 ? edgeA.depth : edgeB.depth) || T;
    return side === 0 ? [0, d] : [S - d, S];
  };
  const capsBySide = ([0, 1] as const).map((side) => {
    const [a, b] = strip(side);
    return caps.filter(({ box }) => box.w0 < b! - 1 && a! < box.w1 - 1).map((c) => c.part);
  });
  const overlapsU = (a: FrameBox, u0: number, u1: number) => a.u0 < u1 - 1 && u0 < a.u1 - 1;
  const bearings = input.type === 'gable' ? [[0, 0] as const, [1, 1] as const] : [[0, 0] as const, [0, 1] as const];
  for (const rf of rafters) {
    if (rf.fly) continue;
    for (const [rSide, wallSide] of bearings) {
      if (rf.side !== rSide) continue;
      for (const plate of capsBySide[wallSide]!) {
        const pb = boxInFrame(frame, plate);
        if (!overlapsU(pb, rf.u0, rf.u0 + T)) continue;
        const where = at({ u: rf.u0 + T / 2, v: pb.v1, w: (pb.w0 + pb.w1) / 2 });
        joints.push({ a: rf.key, b: plate.id, jointTypeId: J.hurricaneTie, at: where, fastenerCount: 1 });
        joints.push({ a: rf.key, b: plate.id, jointTypeId: J.nail16d, at: where, fastenerCount: RAFTER_NAILS, note: 'toenail' });
      }
    }
  }

  // Rafter ties (gable) at plate level beside each rafter pair.
  let ties = 0;
  if (input.type === 'gable') {
    const tieDepth = rafterDepth;
    for (const p of positions) {
      if (p.fly) continue;
      const u0 = p.u0 + T + T > LR ? p.u0 - T : p.u0 + T;
      const tie = specs.add(frame, {
        assembly: asm,
        role: 'joist',
        tags: ['rafter-tie', 'ceiling-joist'],
        box: { u0, u1: u0 + T, v0: yb, v1: yb + tieDepth, w0: 0, w1: S },
        lengthAxis: 'w',
        widthAxis: 'u',
        materialId: materials.lumber,
        sectionId: rafterSection,
        buildStep: step,
      });
      ties++;
      for (const rf of rafters.filter((x) => x.u0 === p.u0 && !x.fly)) {
        const w = rf.side === 0 ? edgeA.depth / 2 : S - edgeB.depth / 2;
        joints.push({ a: tie, b: rf.key, jointTypeId: J.nail16d, at: at({ u: u0, v: yb + tieDepth / 2, w }), fastenerCount: HEEL_JOINT_NAILS, note: 'heel joint' });
      }
      for (const side of [0, 1] as const) {
        for (const plate of capsBySide[side]!) {
          const pb = boxInFrame(frame, plate);
          if (!overlapsU(pb, u0, u0 + T)) continue;
          joints.push({ a: tie, b: plate.id, jointTypeId: J.nail16d, at: at({ u: u0 + T / 2, v: yb, w: (pb.w0 + pb.w1) / 2 }), fastenerCount: 2, note: 'toenail' });
        }
      }
    }
  }

  // Roof sheathing on the rafter tops: 8ft along the eave, 4ft up the slope, staggered.
  let panels = 0;
  if (sheathe) {
    const th = BUILDER_DEFAULTS.sheathingThickness;
    const { long, short } = BUILDER_DEFAULTS.sheet;
    const uStart = -rake;
    const uEnd = LR + rake;
    for (const side of sides) {
      const s = side === 0 ? 1 : -1;
      const wEave = side === 0 ? -overhang : S + overhang;
      const base = { u: 0, v: edgeY(-overhang) + cos * rafterDepth, w: wEave - s * sin * rafterDepth };
      for (let row = 0, s0 = 0; s0 < rafterLen - 1; row++, s0 += short) {
        const s1 = Math.min(rafterLen, s0 + short);
        const cuts = [uStart];
        for (let u = uStart + (row % 2 === 1 ? short : long); u < uEnd - 1; u += long) cuts.push(u);
        cuts.push(uEnd);
        for (let i = 0; i + 1 < cuts.length; i++) {
          const u0 = cuts[i]!;
          const u1 = cuts[i + 1]!;
          const placed = placeOriented(
            frame,
            { u: u0, v: base.v + s0 * sin, w: base.w + s * s0 * cos },
            { x: { u: 1, v: 0, w: 0 }, y: { u: 0, v: sin, w: s * cos }, z: { u: 0, v: cos, w: -s * sin } },
            { length: u1 - u0, width: s1 - s0, height: th },
          );
          const key = specs.addPlaced({
            assembly: asm,
            role: 'sheathing',
            materialId: materials.sheathing,
            tags: ['roof-sheathing', 'brace:panel', `side:${sideName(side)}`],
            buildStep: step,
            ...placed,
          });
          panels++;
          for (const rf of rafters) {
            if (rf.side !== side || !(rf.u0 < u1 - 1 && u0 < rf.u0 + T - 1)) continue;
            const edge = rf.u0 <= u0 + 1 || rf.u0 + T >= u1 - 1;
            const mid = (s0 + s1) / 2;
            joints.push({
              a: key,
              b: rf.key,
              jointTypeId: J.nail8d,
              at: at({ u: rf.u0 + T / 2, v: base.v + mid * sin, w: base.w + s * mid * cos }),
              fastenerCount: sheathingNailCount(s1 - s0, edge),
            });
          }
        }
      }
    }
  }

  const pairs = positions.filter((p) => !p.fly).length;
  const name = input.name ?? 'Roof';
  const notes: string[] = [];
  if (input.bearingHeight === undefined) notes.push(`It bears on the walls at ${fi(yb)}.`);
  return {
    ok: true,
    layout: {
      assemblies: [
        {
          key: asm,
          kind: 'roof',
          name,
          buildStep: step,
          builder: () => ({
            name: ROOF_BUILDER,
            params: {
              type: input.type,
              from: { x: x0, z: z0 },
              to: { x: x1, z: z1 },
              pitchRise: pitch.rise,
              ridgeAxis: input.type === 'gable' ? (frame.angleDeg === 0 ? 'x' : 'z') : null,
              lowSide: input.lowSide ?? null,
              rafterSize: rafterSection,
              spacing: spacingLabel,
              overhang,
              rake,
              bearingHeight: round6(yb),
              sheathing: sheathe,
              materials,
            },
          }),
        },
      ],
      parts: specs.parts,
      joints,
      notes,
      what: 'The new roof',
      summary: (id) =>
        input.type === 'gable'
          ? `Built gable roof ${id(asm)} "${name}" at ${formatPitch(pitch)}: ${pairs} pairs of ${rafterSection} rafters at ${spacingLabel} (${fi(rafterLen)} long), a ${ridgeSection} ridge${ridge ? ` ${id(ridge)}` : ''}, ${ties} rafter ties${panels > 0 ? `, ${panels} sheathing panels` : ''}.`
          : `Built shed roof ${id(asm)} "${name}" at ${formatPitch(pitch)}, low side ${input.lowSide}: ${pairs} ${rafterSection} rafters at ${spacingLabel} (${fi(rafterLen)} long)${panels > 0 ? `, ${panels} sheathing panels` : ''}.`,
    },
  };
}

