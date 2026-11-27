/**
 * build_wall layout: US platform framing. Single bottom plate, double top plate,
 * end studs, common studs on layout from the wall's start, openings, structural
 * sheathing or let-in bracing, and California corners where it butts into a wall.
 */
import type { CatalogIndex } from '../../catalog/validate.ts';
import { commandError, type CommandError } from '../../commands/errors.ts';
import { boxInFrame, placeOriented, toWorld, type FrameBox, type PlanFrame } from '../../geometry/frame.ts';
import { aabbOf, partBox } from '../../geometry/obb.ts';
import type { Project } from '../../model/schema.ts';
import type { SiteDefaults } from '../../site/design-loads.ts';
import { MM_PER_FOOT, MM_PER_INCH } from '../../units/length.ts';
import { contactJoints, type Member } from '../contact.ts';
import { BUILDER_DEFAULTS, resolveMaterials, type BuilderMaterialsInput } from '../defaults.ts';
import type { JointSpec, PartSpec, Ref } from '../emit.ts';
import { SPACING_MM, STOCK_LENGTH_MM, anchorBoltCount, framingNailCount, type SpacingLabel } from '../rules.ts';
import {
  buildingWidth,
  builderSeq,
  fi,
  partAabb,
  requireMaterial,
  requireSection,
  round6,
  sectionDims,
  snowLoad,
  supportUnder,
  type PlanPoint,
} from '../util.ts';
import {
  bottomPlates,
  frameOpening,
  openingParamsOf,
  resolveOpening,
  type ExistingOpening,
  type OpeningInput,
  type OpeningUnitInput,
  type ResolvedOpening,
} from './opening.ts';
import { resolveUnitSpec, unitJoints } from './opening-unit.ts';
import {
  WALL_BUILDER,
  addMember,
  itemOf,
  newWallState,
  studTop,
  wallFrame,
  wallParamsOf,
  type WallItem,
  type WallParams,
  type WallState,
} from './wall-state.ts';

const IN = MM_PER_INCH;
const T = BUILDER_DEFAULTS.twoBy;
const GAP = 0.75 * IN;

export interface BuildWallInput {
  start: PlanPoint;
  end: PlanPoint;
  height: number;
  studLength?: number;
  exterior?: 'left' | 'right';
  baseElevation?: number;
  studSize?: '2x4' | '2x6';
  spacing?: SpacingLabel;
  loadBearing?: boolean;
  buildingWidth?: number;
  bracing?: 'sheathing' | 'let-in' | 'none';
  openings?: OpeningInput[];
  materials?: BuilderMaterialsInput;
  name?: string;
}

interface Butt {
  wallId: string;
  params: WallParams;
  /** Which end of the through wall the corner is at. */
  atEnd: 'start' | 'end';
}

const sub = (a: PlanPoint, b: PlanPoint) => ({ x: a.x - b.x, z: a.z - b.z });
const dot2 = (a: PlanPoint, b: PlanPoint) => a.x * b.x + a.z * b.z;

function planAxes(p: Pick<WallParams, 'start' | 'end' | 'exterior'>) {
  const d = sub(p.end, p.start);
  const len = Math.hypot(d.x, d.z);
  const u = { x: d.x / len, z: d.z / len };
  const s = p.exterior === 'left' ? 1 : -1;
  return { u, w: { x: -u.z * s, z: u.x * s }, len };
}

/** Does the new wall's end `pt` land on an existing builder wall's outside face? */
function findButt(
  project: Project,
  pt: PlanPoint,
  away: PlanPoint,
  newW: PlanPoint,
  which: 'start' | 'end',
): { butt: Butt | null; error?: CommandError } {
  for (const asm of Object.values(project.assemblies)) {
    const params = wallParamsOf(project, asm.id);
    if (!params) continue;
    const ax = planAxes(params);
    const rel = sub(pt, params.start);
    const tu = dot2(rel, ax.u);
    const tw = dot2(rel, ax.w);
    if (Math.abs(tw) > 1 || tu < -1 || tu > ax.len + 1) continue;
    const atEnd = tu < 1 ? 'start' : tu > ax.len - 1 ? 'end' : null;
    if (!atEnd) {
      return {
        butt: null,
        error: commandError(
          'not_allowed',
          `The ${which} of the new wall lands part-way along ${asm.id} "${asm.name}" (${fi(tu)} from its start). Corners are only supported at wall ends.`,
          { path: which, hint: `Move the ${which} to an end of ${asm.id}, or build ${asm.id} as two walls.` },
        ),
      };
    }
    if (Math.abs(dot2(away, ax.u)) > 0.01) {
      return {
        butt: null,
        error: commandError('not_allowed', `The new wall meets ${asm.id} "${asm.name}" at an angle; only square corners are supported.`, {
          path: which,
        }),
      };
    }
    if (dot2(away, ax.w) <= 0) {
      return {
        butt: null,
        error: commandError(
          'not_allowed',
          `The new wall would run outward from ${asm.id} "${asm.name}"'s outside face; walls can only meet it at a corner on its inside.`,
          { path: which },
        ),
      };
    }
    const bodyDir = atEnd === 'start' ? ax.u : { x: -ax.u.x, z: -ax.u.z };
    if (dot2(newW, bodyDir) <= 0) {
      return {
        butt: null,
        error: commandError(
          'not_allowed',
          `The new wall's exterior side would face into ${asm.id} "${asm.name}". List walls clockwise (exterior on the left), or set "exterior".`,
          { path: 'exterior' },
        ),
      };
    }
    return { butt: { wallId: asm.id, params, atEnd } };
  }
  return { butt: null };
}

export function resolveWall(
  project: Project,
  input: BuildWallInput,
  catalog: CatalogIndex,
  siteDefaults?: SiteDefaults,
): { ok: true; params: WallParams; butts: { start: Butt | null; end: Butt | null }; notes: string[] } | { ok: false; errors: CommandError[] } {
  const bad = (msg: string, path?: string, hint?: string) => ({
    ok: false as const,
    errors: [commandError('invalid_input', msg, { ...(path ? { path } : {}), ...(hint ? { hint } : {}) })],
  });
  const exterior = input.exterior ?? 'left';
  const d = sub(input.end, input.start);
  const length = Math.hypot(d.x, d.z);
  if (length < 1) return bad('"start" and "end" are the same point; a wall needs a length.', 'end');

  const studSectionId = input.studSize ?? '2x4';
  const secErr = requireSection(catalog, studSectionId, 'studSize');
  if (secErr) return { ok: false, errors: [secErr] };
  const depth = sectionDims(catalog, studSectionId).depth;
  const spacingLabel = input.spacing ?? '16in';
  const spacing = SPACING_MM[spacingLabel];
  const bracing = input.bracing ?? 'sheathing';
  const materials = resolveMaterials(input.materials);

  const errors: CommandError[] = [];
  for (const e of [
    requireMaterial(catalog, materials.lumber, ['lumber'], 'materials.lumber'),
    requireMaterial(catalog, materials.treatedLumber, ['lumber'], 'materials.treatedLumber'),
    bracing === 'sheathing' ? requireMaterial(catalog, materials.sheathing, ['sheet'], 'materials.sheathing') : null,
  ]) {
    if (e) errors.push(e);
  }
  if (errors.length > 0) return { ok: false, errors };

  // Corners.
  const ax = planAxes({ start: input.start, end: input.end, exterior });
  const startButt = findButt(project, input.start, ax.u, ax.w, 'start');
  if (startButt.error) return { ok: false, errors: [startButt.error] };
  const endButt = findButt(project, input.end, { x: -ax.u.x, z: -ax.u.z }, ax.w, 'end');
  if (endButt.error) return { ok: false, errors: [endButt.error] };
  const sb = startButt.butt;
  const eb = endButt.butt;
  const frameU0 = sb ? sb.params.depth : 0;
  const frameU1 = length - (eb ? eb.params.depth : 0);
  const sheathU0 = sb ? -sb.params.sheathingThickness : 0;
  const sheathU1 = length + (eb ? eb.params.sheathingThickness : 0);
  const framing = frameU1 - frameU0;
  if (framing < 2 * spacing - 1e-6) {
    return bad(
      `A wall needs at least ${fi(2 * spacing)} of framing (two stud spaces at ${spacingLabel}); this one has ${fi(framing)}${sb || eb ? ' after the corners' : ''}.`,
      'end',
    );
  }

  // Heights.
  if (input.height < 4 * MM_PER_FOOT - 1e-6) return bad(`A wall must be at least 4' 0" tall (you gave ${fi(input.height)}).`, 'height');
  const studLength = input.studLength ?? input.height - 3 * T;
  const height = studLength + 3 * T;
  if (input.studLength !== undefined && input.studLength <= 0) return bad('"studLength" must be more than zero.', 'studLength');
  if (studLength > STOCK_LENGTH_MM + 1e-6) {
    return bad(`Studs for this wall would be ${fi(studLength)} long, past the ${fi(STOCK_LENGTH_MM)} stock length.`, 'height', 'Build it as two storeys, or lower it.');
  }

  // What it stands on.
  const samples = [0.1, 0.5, 0.9].map((k) => {
    const uu = frameU0 + k * framing;
    return { x: input.start.x + ax.u.x * uu + ax.w.x * (depth / 2), z: input.start.z + ax.u.z * uu + ax.w.z * (depth / 2) };
  });
  const found = supportUnder(project, samples, catalog);
  const notes: string[] = [];
  let baseElevation: number;
  let support: WallParams['support'] = { kind: 'none', partIds: [] };
  if (input.baseElevation !== undefined) {
    baseElevation = input.baseElevation;
    if (found.kind !== 'none' && Math.abs(found.top - baseElevation) < 1) support = { kind: found.kind, partIds: found.partIds };
  } else if (found.kind !== 'none') {
    baseElevation = found.top;
    support = { kind: found.kind, partIds: found.partIds };
  } else {
    baseElevation = 0;
    notes.push('Nothing is under this wall, so it sits on the ground (y = 0) with no anchors.');
  }
  if (support.kind === 'wood' && found.assembly) {
    // Nail the plate to the floor framing (joists and rims), not the subfloor.
    support = {
      kind: 'wood',
      partIds: Object.values(project.parts)
        .filter((p) => p.assemblyId === found.assembly!.id && (p.role === 'joist' || p.role === 'rim'))
        .map((p) => p.id),
    };
  }

  const snow = snowLoad(project, siteDefaults);
  const bw = buildingWidth(project, input.buildingWidth, found);

  const params: WallParams = {
    start: { x: input.start.x, z: input.start.z },
    end: { x: input.end.x, z: input.end.z },
    exterior,
    length: round6(length),
    height: round6(height),
    studLength: round6(studLength),
    baseElevation: round6(baseElevation),
    studSectionId,
    depth,
    spacing,
    spacingLabel,
    loadBearing: input.loadBearing ?? true,
    buildingWidthFt: bw.ft,
    buildingWidthNote: bw.note,
    snowPsf: snow.psf,
    snowNote: snow.note,
    bracing,
    sheathingThickness: bracing === 'sheathing' ? BUILDER_DEFAULTS.sheathingThickness : 0,
    materials,
    bottomPlateMaterial: support.kind === 'wood' ? materials.lumber : materials.treatedLumber,
    support,
    butt: { start: sb?.wallId ?? null, end: eb?.wallId ?? null },
    frameU0: round6(frameU0),
    frameU1: round6(frameU1),
    sheathU0: round6(sheathU0),
    sheathU1: round6(sheathU1),
    seq: builderSeq(project, WALL_BUILDER),
  };
  return { ok: true, params, butts: { start: sb, end: eb }, notes };
}

/** Plates, end studs and common studs on layout. */
function frameBareWall(state: WallState): void {
  const p = state.params;
  const D = p.depth;
  const top = studTop(p, T);
  const lumber = p.materials.lumber;
  const plate = (tag: string, v0: number, materialId: string) =>
    addMember(state, {
      role: 'plate',
      tags: [tag],
      box: { u0: p.frameU0, u1: p.frameU1, v0, v1: v0 + T, w0: 0, w1: D },
      lengthAxis: 'u',
      widthAxis: 'v',
      materialId,
      sectionId: p.studSectionId,
      phase: 'framing',
    });
  plate('bottom', 0, p.bottomPlateMaterial);
  plate('top', top, lumber);
  plate('top-cap', top + T, lumber);

  const stud = (tag: string, u0: number) =>
    addMember(state, {
      role: 'stud',
      tags: [tag],
      box: { u0, u1: u0 + T, v0: T, v1: top, w0: 0, w1: D },
      lengthAxis: 'v',
      widthAxis: 'u',
      materialId: lumber,
      sectionId: p.studSectionId,
      phase: 'framing',
    });
  stud('end', p.frameU0);
  for (const u0 of commonStudPositions(p)) stud('common', u0);
  stud('end', p.frameU1 - T);
}

/** The near edge (u0) of every common stud on layout in a bare wall, measured from the wall start. */
export function commonStudPositions(p: Pick<WallParams, 'frameU0' | 'frameU1' | 'spacing'>): number[] {
  const out: number[] = [];
  const lo = p.frameU0 + T + GAP;
  const hi = p.frameU1 - T - GAP;
  for (let n = 1; n * p.spacing - T / 2 < hi; n++) {
    const u0 = n * p.spacing - T / 2;
    if (u0 < lo - 1e-6 || u0 + T > hi + 1e-6) continue;
    out.push(u0);
  }
  return out;
}

/** The common stud a bare wall has at `u0`, as built by build_wall. */
export function commonStud(state: WallState, u0: number): WallItem {
  const p = state.params;
  return addMember(state, {
    role: 'stud',
    tags: ['common'],
    box: { u0, u1: u0 + T, v0: T, v1: studTop(p, T), w0: 0, w1: p.depth },
    lengthAxis: 'v',
    widthAxis: 'u',
    materialId: p.materials.lumber,
    sectionId: p.studSectionId,
    phase: 'framing',
  });
}

/**
 * The full 4x8 sheathing grid of a bare wall, in wall u/v/w: joints fall on layout,
 * 19.2in layout lays the sheets horizontally. Empty when the wall isn't sheathed.
 */
export function sheathingCells(
  p: Pick<WallParams, 'bracing' | 'spacingLabel' | 'sheathU0' | 'sheathU1' | 'height' | 'sheathingThickness'>,
): FrameBox[] {
  if (p.bracing !== 'sheathing') return [];
  const { long, short } = BUILDER_DEFAULTS.sheet;
  const horizontal = p.spacingLabel === '19.2in';
  const pu = horizontal ? long : short;
  const pv = horizontal ? short : long;
  const cuts = (from: number, to: number, step: number) => {
    const out = [from];
    for (let k = 1; k * step < to - 1; k++) if (k * step > from + 1) out.push(k * step);
    out.push(to);
    // A corner lap shorter than 1in joins the next sheet rather than being its own sliver.
    if (out.length > 2 && out[1]! - out[0]! < IN) out.splice(1, 1);
    if (out.length > 2 && out[out.length - 1]! - out[out.length - 2]! < IN) out.splice(out.length - 2, 1);
    return out;
  };
  const us = cuts(p.sheathU0, p.sheathU1, pu);
  const vs = cuts(0, p.height, pv);
  const out: FrameBox[] = [];
  for (let j = 0; j + 1 < vs.length; j++) {
    for (let i = 0; i + 1 < us.length; i++) {
      out.push({ u0: us[i]!, u1: us[i + 1]!, v0: vs[j]!, v1: vs[j + 1]!, w0: -p.sheathingThickness, w1: 0 });
    }
  }
  return out;
}

/** 4x8 panels on the outside face. */
function sheatheWall(state: WallState): void {
  const p = state.params;
  for (const box of sheathingCells(p)) {
    addMember(state, {
      role: 'sheathing',
      tags: ['shear-panel', 'brace:panel'],
      box,
      lengthAxis: 'u',
      widthAxis: 'v',
      materialId: p.materials.sheathing,
      phase: 'sheathing',
    });
  }
}

interface BraceLayout {
  spec: PartSpec;
  box: FrameBox;
  /** v on the brace centreline at u. */
  vAt: (u: number) => number;
}

/** A 1x4 let-in brace in the end bay at `side`, 45°–60°, within [limit…] of the end. */
function letInBrace(state: WallState, side: 'start' | 'end', room: number, catalog: CatalogIndex): BraceLayout | null {
  const p = state.params;
  const sec = sectionDims(catalog, BUILDER_DEFAULTS.sections.letInBrace);
  const b = sec.depth;
  const H = p.height;
  for (let deg = 45; deg <= 60 + 1e-9; deg += 0.5) {
    const phi = (deg * Math.PI) / 180;
    const len = (H - b * Math.cos(phi)) / Math.sin(phi);
    const extent = b * Math.sin(phi) + len * Math.cos(phi);
    if (extent > room) continue;
    const s = side === 'start' ? 1 : -1;
    const uEdge = side === 'start' ? p.frameU0 : p.frameU1;
    const origin = { u: uEdge + s * b * Math.sin(phi), v: 0, w: 0 };
    const placed = placeOriented(
      state.frame,
      origin,
      {
        x: { u: s * Math.cos(phi), v: Math.sin(phi), w: 0 },
        y: { u: 0, v: 0, w: 1 },
        z: { u: -s * Math.sin(phi), v: Math.cos(phi), w: 0 },
      },
      { length: len, width: sec.width, height: b },
    );
    const key = `#m${state.nextKey++}`;
    const spec: PartSpec = {
      key,
      assembly: state.wallRef,
      role: 'brace',
      materialId: p.materials.lumber,
      sectionId: BUILDER_DEFAULTS.sections.letInBrace,
      tags: ['brace:diagonal', 'let-in'],
      buildStep: { phase: 'framing', seq: p.seq },
      ...placed,
    };
    const box = boxInFrame(state.frame, placed);
    const mid = { u: origin.u + s * (-b / 2) * Math.sin(phi), v: (b / 2) * Math.cos(phi) };
    const vAt = (u: number) => mid.v + ((u - mid.u) * s * Math.sin(phi)) / Math.cos(phi);
    return { spec, box, vAt };
  }
  return null;
}

/** Joints from the bottom plate(s) to whatever the wall stands on. */
export function supportJoints(project: Project, state: WallState, plates: readonly WallItem[], specs: ReadonlyMap<string, PartSpec>): JointSpec[] {
  const p = state.params;
  const out: JointSpec[] = [];
  const ids = p.support.partIds.filter((id) => Object.hasOwn(project.parts, id));
  for (const plate of plates) {
    const len = plate.box.u1 - plate.box.u0;
    const at = toWorld(state.frame, { u: (plate.box.u0 + plate.box.u1) / 2, v: 0, w: p.depth / 2 });
    const atClean = { x: round6(at.x), y: round6(at.y), z: round6(at.z) };
    if (p.support.kind === 'concrete' && ids[0]) {
      out.push({ a: plate.ref, b: ids[0], jointTypeId: BUILDER_DEFAULTS.jointTypes.anchorBolt, at: atClean, fastenerCount: anchorBoltCount(len) });
    } else if (p.support.kind === 'wood') {
      const spec = specs.get(plate.ref);
      const plateBox = spec ? aabbOf(partBox(spec)) : partAabb(project.parts[plate.ref]!);
      for (const id of ids) {
        const b = partAabb(project.parts[id]!);
        const ox = Math.min(b.max.x, plateBox.max.x) - Math.max(b.min.x, plateBox.min.x);
        const oz = Math.min(b.max.z, plateBox.max.z) - Math.max(b.min.z, plateBox.min.z);
        if (ox <= 1 || oz <= 1) continue;
        out.push({
          a: plate.ref,
          b: id,
          jointTypeId: BUILDER_DEFAULTS.jointTypes.nail16d,
          at: atClean,
          fastenerCount: framingNailCount(Math.max(ox, oz)),
        });
      }
    }
  }
  return out;
}

/** Wall parts of other walls that may touch this one (square to it), as contact members. */
export function neighbourMembers(project: Project, frame: PlanFrame, wallIds: readonly string[], exclude: ReadonlySet<string> = new Set()): Member[] {
  const out: Member[] = [];
  for (const part of Object.values(project.parts)) {
    if (!wallIds.includes(part.assemblyId) || part.role === 'brace' || exclude.has(part.id)) continue;
    out.push(itemOf(frame, part));
  }
  return out;
}

/**
 * The material for door/window units: the first catalog material in the "opening"
 * category that can be nailed in (16d). None in the sample catalog, so no unit is added.
 * The tier-1 catalog (`packages/catalog`) lists the generic `opening-unit` first on
 * purpose, so builders add a neutral unit rather than a specific window or door.
 */
export function openingUnitMaterial(catalog: CatalogIndex): string | null {
  for (const m of catalog.materials.values()) {
    if (m.category === 'opening' && m.acceptsJoints.includes(BUILDER_DEFAULTS.jointTypes.nail16d)) return m.id;
  }
  return null;
}

/**
 * The unit to put in a resolved opening: its product, else the generic unit, drawn as
 * `resolveUnitSpec` says. None when the catalog has no unit at all. `note` says when the
 * product's style didn't fit the opening's kind.
 */
export function openingUnitFor(o: ResolvedOpening, catalog: CatalogIndex, seq: number): { unit?: OpeningUnitInput; note?: string } {
  const materialId = o.product ?? openingUnitMaterial(catalog);
  if (!materialId) return {};
  const r = resolveUnitSpec(materialId, o.kind, catalog);
  return { unit: { materialId, spec: r.spec, seq }, ...(r.note ? { note: r.note } : {}) };
}

/** The wall state's items that aren't window or door unit pieces. */
export function framingItems(state: WallState): WallItem[] {
  const units = new Set(state.units.flatMap((u) => u.items));
  return state.items.filter((i) => !units.has(i));
}

/** Joints for every unit framed in the state (see `unitJoints`). */
export const allUnitJoints = (state: WallState): JointSpec[] => state.units.flatMap((u) => unitJoints(state, u));

/** Existing openings in a wall, from their O assemblies. */
export function openingsIn(project: Project, wallId: string): ExistingOpening[] {
  return Object.values(project.assemblies)
    .flatMap((a) => {
      const params = openingParamsOf(a);
      return params && params.wallId === wallId ? [{ label: a.id, framingU0: params.framingU0, framingU1: params.framingU1 }] : [];
    });
}

export interface WallLayout {
  state: WallState;
  openings: ResolvedOpening[];
  joints: JointSpec[];
  /** Specs added to other walls (corner backers). */
  backers: PartSpec[];
  notes: string[];
  errors: CommandError[];
}

/** Lay out a whole new wall (and its corner backers in the walls it butts into). */
export function layoutWall(
  project: Project,
  params: WallParams,
  butts: { start: Butt | null; end: Butt | null },
  openings: readonly OpeningInput[],
  wallRef: Ref,
  openingRef: (i: number) => Ref,
  catalog: CatalogIndex,
  openingSeq = 0,
): WallLayout {
  const frame = wallFrame(params);
  const state = newWallState(frame, params, wallRef);
  const notes: string[] = [];
  const errors: CommandError[] = [];
  frameBareWall(state);
  if (params.bracing === 'sheathing') sheatheWall(state);

  const resolved: ResolvedOpening[] = [];
  openings.forEach((input, i) => {
    const existing = resolved.map((o, k) => ({ label: `openings[${k}]`, framingU0: o.framingU0, framingU1: o.framingU1 }));
    const r = resolveOpening(params, input, existing, [], (id) => sectionDims(catalog, id).depth, `openings[${i}].`);
    if (!r.ok) {
      errors.push(...r.errors);
      return;
    }
    resolved.push(r.opening);
    const u = openingUnitFor(r.opening, catalog, openingSeq + resolved.length - 1);
    if (u.note) notes.push(u.note);
    frameOpening(state, r.opening, openingRef(i), u.unit);
  });
  if (errors.length > 0) return { state, openings: resolved, joints: [], backers: [], notes, errors };

  // Let-in braces at each end, clear of openings.
  const braces: BraceLayout[] = [];
  if (params.bracing === 'let-in') {
    const mid = (params.frameU0 + params.frameU1) / 2;
    const firstOpening = Math.min(mid, ...resolved.map((o) => o.framingU0));
    const lastOpening = Math.max(mid, ...resolved.map((o) => o.framingU1));
    for (const side of ['start', 'end'] as const) {
      const room = side === 'start' ? firstOpening - params.frameU0 : params.frameU1 - lastOpening;
      const brace = letInBrace(state, side, room, catalog);
      if (!brace) {
        errors.push(
          commandError(
            'invalid_input',
            `There isn't room for a let-in brace at the ${side} of this wall (a ${fi(params.height)} wall needs about ${fi(params.height * Math.tan(Math.PI / 6) + 4 * IN)} of solid wall at each end).`,
            { path: 'bracing', hint: 'Use bracing: "sheathing", or move the openings away from the ends.' },
          ),
        );
        continue;
      }
      braces.push(brace);
      state.specs.push(brace.spec);
    }
    if (errors.length > 0) return { state, openings: resolved, joints: [], backers: [], notes, errors };
  }

  // Corner backers in the walls this one butts into.
  const backers: PartSpec[] = [];
  const backerItems: WallItem[] = [];
  for (const which of ['start', 'end'] as const) {
    const butt = butts[which];
    if (!butt) continue;
    const tp = butt.params;
    const tFrame = wallFrame(tp);
    const D_T = tp.depth;
    const a = Math.max(T, params.depth + T - D_T);
    const box: FrameBox =
      butt.atEnd === 'start'
        ? { u0: tp.frameU0 + a, u1: tp.frameU0 + a + D_T, v0: T, v1: studTop(tp, T), w0: D_T - T, w1: D_T }
        : { u0: tp.frameU1 - a - D_T, u1: tp.frameU1 - a, v0: T, v1: studTop(tp, T), w0: D_T - T, w1: D_T };
    const blocked = Object.values(project.parts).find((part) => {
      if (part.assemblyId !== butt.wallId || part.role === 'sheathing' || part.role === 'brace' || part.role === 'plate') return false;
      const pb = boxInFrame(tFrame, part);
      return pb.u0 < box.u1 - 1 && box.u0 < pb.u1 - 1 && pb.v0 < box.v1 - 1 && box.v0 < pb.v1 - 1 && pb.w0 < box.w1 - 1 && box.w0 < pb.w1 - 1;
    });
    if (blocked) {
      notes.push(`${blocked.id} already backs the corner in ${butt.wallId}, so no extra backer was added there.`);
      continue;
    }
    const item = addMember(state, {
      role: 'stud',
      tags: ['corner-backer'],
      box,
      lengthAxis: 'v',
      widthAxis: 'w',
      materialId: tp.materials.lumber,
      sectionId: tp.studSectionId,
      phase: 'framing',
      assembly: butt.wallId,
      frame: tFrame,
      seq: tp.seq,
    });
    backerItems.push(item);
  }
  for (const item of backerItems) {
    const spec = state.specs.find((s) => s.key === item.ref)!;
    backers.push(spec);
  }

  // Joints: contacts within the wall and with the walls it butts into.
  const neighbours = neighbourMembers(
    project,
    frame,
    [butts.start?.wallId, butts.end?.wallId].filter((x): x is string => x !== undefined),
  );
  const joints = contactJoints(frame, framingItems(state), neighbours);
  joints.push(...allUnitJoints(state));
  const specMap = new Map(state.specs.map((s) => [s.key, s]));
  joints.push(...supportJoints(project, state, bottomPlates(state), specMap));
  joints.push(...braceJoints(state, braces));
  return { state, openings: resolved, joints, backers, notes, errors };
}

/** Let-in brace nailed (2-8d) to each stud and plate it crosses. */
function braceJoints(state: WallState, braces: readonly BraceLayout[]): JointSpec[] {
  const out: JointSpec[] = [];
  for (const b of braces) {
    for (const item of state.items) {
      if (item.role !== 'stud' && item.role !== 'plate') continue;
      if (item.box.u1 <= b.box.u0 + 1 || item.box.u0 >= b.box.u1 - 1) continue;
      // On a plate, the nails go where the brace centreline crosses the plate's mid-height.
      const plateV = (item.box.v0 + item.box.v1) / 2;
      const slope = b.vAt(1) - b.vAt(0);
      const u =
        item.role === 'stud'
          ? (item.box.u0 + item.box.u1) / 2
          : Math.max(Math.max(b.box.u0, item.box.u0), Math.min(Math.min(b.box.u1, item.box.u1), (plateV - b.vAt(0)) / slope));
      const v = item.role === 'stud' ? Math.max(item.box.v0, Math.min(item.box.v1, b.vAt(u))) : plateV;
      if (item.role === 'stud' && (b.vAt(u) < item.box.v0 - 1 || b.vAt(u) > item.box.v1 + 1)) continue;
      if (item.role === 'plate') {
        // A plate is crossed only where the brace reaches its height band.
        const crosses = b.box.v0 < item.box.v1 - 1 && b.box.v1 > item.box.v0 + 1;
        if (!crosses) continue;
      }
      const at = toWorld(state.frame, { u, v, w: 9.525 });
      out.push({
        a: b.spec.key,
        b: item.ref,
        jointTypeId: BUILDER_DEFAULTS.jointTypes.nail8d,
        at: { x: round6(at.x), y: round6(at.y), z: round6(at.z) },
        fastenerCount: 2,
      });
    }
  }
  return out;
}

