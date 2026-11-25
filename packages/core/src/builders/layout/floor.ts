/**
 * frame_floor layout: platform floor framing. Sill plates (or piers) under the
 * bearing edges, rim joists all round, joists on layout, a mid-span blocking row,
 * and a staggered 4x8 subfloor.
 */
import type { CatalogIndex } from '../../catalog/validate.ts';
import { commandError, type CommandError } from '../../commands/errors.ts';
import { toWorld, type FrameBox, type PlanFrame } from '../../geometry/frame.ts';
import { GROUND } from '../../model/ids.ts';
import type { Project } from '../../model/schema.ts';
import { MM_PER_FOOT, MM_PER_INCH } from '../../units/length.ts';
import { contactJoints } from '../contact.ts';
import { BUILDER_DEFAULTS, resolveMaterials, type BuilderMaterialsInput } from '../defaults.ts';
import { SpecList, fail, type JointSpec, type LayoutResult, type Ref } from '../emit.ts';
import { JOIST_TO_RIM_NAILS, SPACING_MM, STOCK_LENGTH_MM, anchorBoltCount, type SpacingLabel } from '../rules.ts';
import type { SiteDefaults } from '../../site/design-loads.ts';
import { builderSeq, compass, fi, footingDepth, requireMaterial, requireSection, round6, sectionDims, supportUnder, type PlanPoint } from '../util.ts';

const IN = MM_PER_INCH;
const FT = MM_PER_FOOT;
const T = BUILDER_DEFAULTS.twoBy;
const GAP = 0.75 * IN;
export const FLOOR_BUILDER = 'frame_floor';

export interface FrameFloorInput {
  from: PlanPoint;
  to: PlanPoint;
  top?: number;
  joistSize?: '2x6' | '2x8' | '2x10' | '2x12';
  spacing?: SpacingLabel;
  joistDirection?: 'x' | 'z';
  support?: 'foundation' | 'piers';
  materials?: BuilderMaterialsInput;
  name?: string;
}

export function layoutFloor(project: Project, input: FrameFloorInput, catalog: CatalogIndex, siteDefaults?: SiteDefaults): LayoutResult {
  const x0 = Math.min(input.from.x, input.to.x);
  const x1 = Math.max(input.from.x, input.to.x);
  const z0 = Math.min(input.from.z, input.to.z);
  const z1 = Math.max(input.from.z, input.to.z);
  const bad = (msg: string, path: string, hint?: string) => fail(commandError('invalid_input', msg, { path, ...(hint ? { hint } : {}) }));
  if (x1 - x0 < 4 * FT || z1 - z0 < 4 * FT) return bad('A floor must be at least 4\' 0" on each side.', 'to');

  const joistSection = input.joistSize ?? '2x8';
  const spacingLabel = input.spacing ?? '16in';
  const spacing = SPACING_MM[spacingLabel];
  const supportKind = input.support ?? 'foundation';
  const materials = resolveMaterials(input.materials);
  const errors: CommandError[] = [];
  for (const e of [
    requireSection(catalog, joistSection, 'joistSize'),
    requireSection(catalog, '2x6', 'joistSize'),
    requireMaterial(catalog, materials.lumber, ['lumber'], 'materials.lumber'),
    requireMaterial(catalog, materials.treatedLumber, ['lumber'], 'materials.treatedLumber'),
    requireMaterial(catalog, materials.subfloor, ['sheet'], 'materials.subfloor'),
    supportKind === 'piers' ? requireMaterial(catalog, materials.concrete, ['concrete'], 'materials.concrete') : null,
  ]) {
    if (e) errors.push(e);
  }
  if (errors.length > 0) return { ok: false, errors };

  // Joists run along the shorter side unless told otherwise.
  const dir = input.joistDirection ?? (x1 - x0 <= z1 - z0 ? 'x' : 'z');
  const frame: PlanFrame =
    dir === 'x'
      ? { origin: { x: x0, y: 0, z: z0 }, angleDeg: 0, wSign: 1 }
      : { origin: { x: x0, y: 0, z: z0 }, angleDeg: 90, wSign: -1 };
  const LJ = dir === 'x' ? x1 - x0 : z1 - z0;
  const LK = dir === 'x' ? z1 - z0 : x1 - x0;
  const depth = sectionDims(catalog, joistSection).depth;
  const sill = sectionDims(catalog, '2x6');
  const sub = BUILDER_DEFAULTS.subfloorThickness;
  const joistLen = LJ - 2 * T;
  if (joistLen > STOCK_LENGTH_MM + 1e-6) {
    return bad(
      `Joists across this floor would be ${fi(joistLen)} long, past the ${fi(STOCK_LENGTH_MM)} stock length; add a beam mid-span (frame it as two floors).`,
      'joistDirection',
    );
  }

  // Bearing edges: the two edges the joists end on.
  const uDir = dir === 'x' ? { x: 1, z: 0 } : { x: 0, z: 1 };
  const edgeName = (end: 0 | 1) => (end === 0 ? compass(-uDir.x, -uDir.z) : compass(uDir.x, uDir.z));
  const worldPt = (u: number, w: number) => {
    const p = toWorld(frame, { u, v: 0, w });
    return { x: p.x, z: p.z };
  };
  const notes: string[] = [];
  let top: number;
  const supports: Array<string | null> = [null, null];
  if (supportKind === 'foundation') {
    const tops: number[] = [];
    for (const end of [0, 1] as const) {
      const uc = end === 0 ? sill.depth / 2 : LJ - sill.depth / 2;
      const s = supportUnder(project, [0.1, 0.5, 0.9].map((k) => worldPt(uc, k * LK)), catalog);
      if (s.kind === 'none') {
        return bad(
          `There's nothing under the ${edgeName(end)} edge to bear on. Pour a slab or footing first, or use support: "piers".`,
          'support',
        );
      }
      tops.push(s.top);
      supports[end] = s.partIds[0] ?? null;
    }
    if (Math.abs(tops[0]! - tops[1]!) > 1) {
      return bad(`The ${edgeName(0)} and ${edgeName(1)} edges bear on supports at different heights (${fi(tops[0]!)} and ${fi(tops[1]!)}).`, 'support');
    }
    const needed = tops[0]! + T + depth + sub;
    if (input.top === undefined) top = needed;
    else if (input.top < needed - 1) {
      return bad(`"top" is too low: the sill, ${joistSection} joists and subfloor on the foundation need it at least ${fi(needed)}.`, 'top', 'Leave "top" out to sit the floor on the foundation.');
    } else if (input.top > needed + 1) {
      return bad(`"top" at ${fi(input.top)} would leave a ${fi(input.top - needed)} gap above the foundation.`, 'top', 'Leave "top" out to sit the floor on the foundation, or use support: "piers".');
    } else top = input.top;
  } else {
    top = input.top ?? 2 * FT;
    if (top - sub - depth < 6 * IN - 1e-6) {
      return bad(`"top" at ${fi(top)} leaves the joists less than 6" above grade, too low for piers.`, 'top');
    }
  }

  const jt = top - sub; // joist top
  const jb = jt - depth; // joist bottom
  const asm = '#f';
  const step = { phase: 'floor' as const, seq: builderSeq(project, FLOOR_BUILDER) };
  const specs = new SpecList('j');
  const framing = (role: 'rim' | 'joist' | 'blocking', tags: string[], box: FrameBox, along: 'u' | 'w') =>
    specs.add(frame, {
      assembly: asm,
      role,
      tags,
      box,
      lengthAxis: along,
      widthAxis: along === 'u' ? 'w' : 'u',
      materialId: materials.lumber,
      sectionId: joistSection,
      buildStep: step,
    });

  // Band rims at the joist ends, end rims along the sides.
  framing('rim', ['band'], { u0: 0, u1: T, v0: jb, v1: jt, w0: 0, w1: LK }, 'w');
  framing('rim', ['band'], { u0: LJ - T, u1: LJ, v0: jb, v1: jt, w0: 0, w1: LK }, 'w');
  framing('rim', ['end-joist'], { u0: T, u1: LJ - T, v0: jb, v1: jt, w0: 0, w1: T }, 'u');
  const joistsW: Array<[number, number]> = [[0, T]];
  for (let n = 1; n * spacing - T / 2 < LK - T - GAP; n++) {
    const w0 = n * spacing - T / 2;
    if (w0 < T + GAP - 1e-6 || w0 + T > LK - T - GAP + 1e-6) continue;
    framing('joist', ['common'], { u0: T, u1: LJ - T, v0: jb, v1: jt, w0, w1: w0 + T }, 'u');
    joistsW.push([w0, w0 + T]);
  }
  framing('rim', ['end-joist'], { u0: T, u1: LJ - T, v0: jb, v1: jt, w0: LK - T, w1: LK }, 'u');
  joistsW.push([LK - T, LK]);

  // Mid-span blocking.
  let blocks = 0;
  if (LJ > 8 * FT) {
    const mid = LJ / 2;
    for (let i = 0; i + 1 < joistsW.length; i++) {
      const w0 = joistsW[i]![1];
      const w1 = joistsW[i + 1]![0];
      if (w1 - w0 < 1) continue;
      framing('blocking', ['mid-span'], { u0: mid - T / 2, u1: mid + T / 2, v0: jb, v1: jt, w0, w1 }, 'w');
      blocks++;
    }
  }

  // Sills or piers under the bearing edges.
  const joints: JointSpec[] = [];
  const J = BUILDER_DEFAULTS.jointTypes;
  const at = (p: { u: number; v: number; w: number }) => {
    const w = toWorld(frame, p);
    return { x: round6(w.x), y: round6(w.y), z: round6(w.z) };
  };
  const piers: Ref[] = [];
  if (supportKind === 'foundation') {
    for (const end of [0, 1] as const) {
      const u0 = end === 0 ? 0 : LJ - sill.depth;
      const key = specs.add(frame, {
        assembly: asm,
        role: 'plate',
        tags: ['sill-plate'],
        box: { u0, u1: u0 + sill.depth, v0: jb - T, v1: jb, w0: 0, w1: LK },
        lengthAxis: 'w',
        widthAxis: 'v',
        materialId: materials.treatedLumber,
        sectionId: '2x6',
        buildStep: step,
      });
      joints.push({
        a: key,
        b: supports[end]!,
        jointTypeId: J.anchorBolt,
        at: at({ u: u0 + sill.depth / 2, v: jb - T, w: LK / 2 }),
        fastenerCount: anchorBoltCount(LK),
      });
    }
  } else {
    const fd = footingDepth(project, siteDefaults);
    const half = 6 * IN;
    const count = Math.max(2, Math.ceil(LK / (6 * FT) - 1e-9) + 1);
    for (const end of [0, 1] as const) {
      const u0 = end === 0 ? 0 : LJ - 2 * half;
      for (let i = 0; i < count; i++) {
        const c = half + (i * (LK - 2 * half)) / (count - 1);
        const key = specs.add(frame, {
          assembly: asm,
          role: 'pier',
          tags: ['pier'],
          box: { u0, u1: u0 + 2 * half, v0: -fd.mm, v1: jb, w0: c - half, w1: c + half },
          lengthAxis: 'v',
          widthAxis: 'u',
          materialId: materials.concrete,
          buildStep: step,
        });
        piers.push(key);
        joints.push({ a: key, b: GROUND, jointTypeId: J.castInPlace, at: at({ u: u0 + half, v: -fd.mm, w: c }), fastenerCount: 1 });
      }
    }
    notes.push(`Piers go ${fi(fd.mm)} below grade (${fd.note}).`);
  }

  // Subfloor: 4x8 sheets across the joists, staggered.
  const { long, short } = BUILDER_DEFAULTS.sheet;
  let sheets = 0;
  for (let row = 0, u0 = 0; u0 < LJ - 1; row++, u0 += short) {
    const u1 = Math.min(LJ, u0 + short);
    const cuts = [0];
    for (let w = row % 2 === 1 ? short : long; w < LK - 1; w += long) cuts.push(w);
    cuts.push(LK);
    for (let i = 0; i + 1 < cuts.length; i++) {
      specs.add(frame, {
        assembly: asm,
        role: 'sheathing',
        tags: ['subfloor'],
        box: { u0, u1, v0: jt, v1: top, w0: cuts[i]!, w1: cuts[i + 1]! },
        lengthAxis: 'w',
        widthAxis: 'u',
        materialId: materials.subfloor,
        buildStep: step,
      });
      sheets++;
    }
  }

  const members = specs.members.filter((m) => m.role !== 'pier');
  const contacts = contactJoints(frame, members);
  const roleOf = new Map(specs.members.map((m) => [m.ref, m.role]));
  for (const j of contacts) {
    const ra = roleOf.get(j.a);
    const rb = roleOf.get(j.b);
    if ((ra === 'rim' || ra === 'joist') && (rb === 'rim' || rb === 'joist')) j.fastenerCount = JOIST_TO_RIM_NAILS;
  }
  joints.push(...contacts);
  // Rims bear on the piers.
  for (const pier of piers) {
    const pm = specs.members.find((m) => m.ref === pier)!;
    for (const m of specs.members) {
      if (m.role !== 'rim' && m.role !== 'joist') continue;
      const b = m.box;
      if (Math.abs(b.v0 - pm.box.v1) > 0.05) continue;
      if (b.u1 <= pm.box.u0 + 1 || b.u0 >= pm.box.u1 - 1 || b.w1 <= pm.box.w0 + 1 || b.w0 >= pm.box.w1 - 1) continue;
      if (m.role !== 'rim' || !specs.parts.find((p) => p.key === m.ref)!.tags.includes('band')) continue;
      joints.push({ a: m.ref, b: pier, jointTypeId: J.postBase, at: at({ u: (pm.box.u0 + pm.box.u1) / 2, v: jb, w: (pm.box.w0 + pm.box.w1) / 2 }), fastenerCount: 1 });
    }
  }

  const joistCount = joistsW.length - 2;
  const name = input.name ?? 'Floor';
  return {
    ok: true,
    layout: {
      assemblies: [
        {
          key: asm,
          kind: 'floor',
          name,
          buildStep: step,
          builder: () => ({
            name: FLOOR_BUILDER,
            params: {
              from: { x: x0, z: z0 },
              to: { x: x1, z: z1 },
              top: round6(top),
              joistSize: joistSection,
              spacing: spacingLabel,
              joistDirection: dir,
              support: supportKind,
              materials,
            },
          }),
        },
      ],
      parts: specs.parts,
      joints,
      notes,
      what: 'The new floor',
      summary: (id) =>
        `Framed floor ${id(asm)} "${name}": ${fi(x1 - x0)} × ${fi(z1 - z0)}, ${joistCount} ${joistSection} joists at ${spacingLabel} running ${dir === 'x' ? 'east-west' : 'north-south'} (${fi(joistLen)} long)${blocks > 0 ? `, ${blocks} mid-span blocks` : ''}, ${sheets} subfloor sheets, top at ${fi(top)}, on ${supportKind === 'piers' ? `${piers.length} piers` : 'the foundation'}.`,
    },
  };
}
