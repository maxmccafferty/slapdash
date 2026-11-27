/**
 * A wall being framed or re-framed, in its own frame: u along the wall from its start
 * point (outside face), v up from the bottom of the bottom plate, w across from the
 * outside face of the framing inwards. `build_wall` fills it from scratch;
 * `add_opening` loads it from the wall's existing parts. Both then run the same
 * opening code, so a wall built with an opening equals a wall plus add_opening.
 */
import { boxInFrame, placeMember, type FrameAxis, type FrameBox, type PlanFrame } from '../../geometry/frame.ts';
import type { PartRole } from '../../model/ids.ts';
import { hasCuts } from '../../geometry/cuts.ts';
import type { BuildPhase, Part, PartCuts, Project } from '../../model/schema.ts';
import type { ResolvedMaterials } from '../defaults.ts';
import type { PartSpec, Ref } from '../emit.ts';
import type { Member } from '../contact.ts';
import type { SpacingLabel } from '../rules.ts';
import type { PlanPoint } from '../util.ts';

/** Resolved build_wall input, stored on the wall assembly as its builder recipe. */
export interface WallParams {
  start: PlanPoint;
  end: PlanPoint;
  exterior: 'left' | 'right';
  /** Outside-face length, start to end. */
  length: number;
  height: number;
  studLength: number;
  baseElevation: number;
  studSectionId: string;
  /** Stud depth (wall thickness without sheathing). */
  depth: number;
  spacing: number;
  spacingLabel: SpacingLabel;
  loadBearing: boolean;
  buildingWidthFt: number;
  buildingWidthNote: string;
  snowPsf: number;
  snowNote: string;
  bracing: 'sheathing' | 'let-in' | 'none';
  /** 0 when the wall has no sheathing. */
  sheathingThickness: number;
  materials: ResolvedMaterials;
  bottomPlateMaterial: string;
  support: { kind: 'concrete' | 'wood' | 'none'; partIds: string[] };
  /** Wall this one butts into at each end, if any. */
  butt: { start: string | null; end: string | null };
  /** Framing runs from frameU0 to frameU1 (shortened at butted ends). */
  frameU0: number;
  frameU1: number;
  /** Sheathing runs from sheathU0 to sheathU1 (extended at butted ends). */
  sheathU0: number;
  sheathU1: number;
  seq: number;
}

export const WALL_BUILDER = 'build_wall';
export const OPENING_BUILDER = 'add_opening';

export function wallFrame(p: Pick<WallParams, 'start' | 'end' | 'exterior' | 'baseElevation'>): PlanFrame {
  const angleDeg = (Math.atan2(p.end.z - p.start.z, p.end.x - p.start.x) * 180) / Math.PI;
  return {
    origin: { x: p.start.x, y: p.baseElevation, z: p.start.z },
    angleDeg,
    wSign: p.exterior === 'left' ? 1 : -1,
  };
}

export function wallParamsOf(project: Project, wallId: string): WallParams | null {
  const asm = project.assemblies[wallId];
  if (!asm || asm.builder?.name !== WALL_BUILDER) return null;
  return asm.builder.params as unknown as WallParams;
}

export interface WallItem extends Member {
  tags: string[];
  materialId: string;
  isNew: boolean;
}

/** A window or door unit framed into the state (see `layout/opening-unit.ts`). */
export interface UnitRecord {
  /** The opening assembly: a layout key or its ID. */
  openingRef: Ref;
  /** The rough opening, through the wall's stud depth (where the old single-box unit sat). */
  ro: FrameBox;
  /** The unit's pieces, as in `items` (so `keepUnchangedParts` swapping a ref shows here). */
  items: WallItem[];
  /** The bottom frame piece (sill or threshold) the other pieces are held to. */
  anchor: WallItem | null;
  /** The frame piece nailed to the framing on each side of the rough opening. */
  sides: Array<['start' | 'end' | 'head' | 'bottom', WallItem]>;
}

export interface WallState {
  frame: PlanFrame;
  params: WallParams;
  /** The wall assembly: a layout key (new wall) or its ID. */
  wallRef: Ref;
  items: WallItem[];
  /** Window and door units framed in this state. Their parts are in `items` too, but aren't wall framing. */
  units: UnitRecord[];
  specs: PartSpec[];
  /** Existing part IDs removed. */
  removed: string[];
  nextKey: number;
}

export function newWallState(frame: PlanFrame, params: WallParams, wallRef: Ref): WallState {
  return { frame, params, wallRef, items: [], units: [], specs: [], removed: [], nextKey: 0 };
}

/** Load an existing wall's parts into a state. */
export function loadWallState(project: Project, wallId: string, params: WallParams): WallState {
  const frame = wallFrame(params);
  const state = newWallState(frame, params, wallId);
  for (const part of Object.values(project.parts)) {
    if (part.assemblyId !== wallId) continue;
    state.items.push(itemOf(frame, part));
  }
  return state;
}

export function itemOf(frame: PlanFrame, part: Part): WallItem {
  return {
    ref: part.id,
    role: part.role,
    tags: part.tags,
    materialId: part.materialId,
    box: boxInFrame(frame, part),
    isNew: false,
  };
}

export interface MemberInput {
  role: PartRole;
  tags: string[];
  box: FrameBox;
  lengthAxis: FrameAxis;
  widthAxis: FrameAxis;
  materialId: string;
  sectionId?: string;
  phase: BuildPhase;
  /** Defaults to the state's wall. */
  assembly?: Ref;
  frame?: PlanFrame;
  seq?: number;
}

export function addMember(state: WallState, m: MemberInput): WallItem {
  const key = `#m${state.nextKey++}`;
  const frame = m.frame ?? state.frame;
  const placed = placeMember(frame, m.box, m.lengthAxis, m.widthAxis);
  const spec: PartSpec = {
    key,
    assembly: m.assembly ?? state.wallRef,
    role: m.role,
    materialId: m.materialId,
    tags: m.tags,
    buildStep: { phase: m.phase, seq: m.seq ?? state.params.seq },
    ...placed,
  };
  if (m.sectionId !== undefined) spec.sectionId = m.sectionId;
  state.specs.push(spec);
  const item: WallItem = {
    ref: key,
    role: m.role,
    tags: m.tags,
    materialId: m.materialId,
    box: frame === state.frame ? m.box : boxInFrame(state.frame, placed),
    isNew: true,
  };
  state.items.push(item);
  return item;
}

export function removeItem(state: WallState, item: WallItem): void {
  state.items = state.items.filter((i) => i !== item);
  if (item.isNew) state.specs = state.specs.filter((s) => s.key !== item.ref);
  else state.removed.push(item.ref);
}

export const hasTag = (item: { tags: readonly string[] }, tag: string) => item.tags.includes(tag);

/** Top of the studs (underside of the top plate), in wall v. */
export const studTop = (p: WallParams, t: number) => t + p.studLength;

const SAME_MM = 0.01;
const SAME_DEG = 1e-6;
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const sameTags = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((t, i) => t === b[i]);

/**
 * Whether two cut sets are the same: numbers within `SAME_MM` (profile mm and angles alike,
 * far tighter than any cut that matters), a missing key the same as an undefined one, and no
 * cuts the same as an empty set.
 */
export function sameCuts(a: PartCuts | undefined, b: PartCuts | undefined): boolean {
  if (!hasCuts({ cuts: a }) || !hasCuts({ cuts: b })) return hasCuts({ cuts: a }) === hasCuts({ cuts: b });
  return sameValue(a, b);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return near(a, b, SAME_MM);
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
    for (const k of keys) if (!sameValue(ra[k], rb[k])) return false;
    return true;
  }
  return a === b;
}

function sameAsPart(spec: PartSpec, part: Part): boolean {
  return (
    spec.assembly === part.assemblyId &&
    spec.role === part.role &&
    spec.materialId === part.materialId &&
    spec.sectionId === part.sectionId &&
    spec.name === part.name &&
    spec.buildStep.phase === part.buildStep.phase &&
    spec.buildStep.seq === part.buildStep.seq &&
    sameTags(spec.tags, part.tags) &&
    (['x', 'y', 'z'] as const).every((k) => near(spec.position[k], part.position[k], SAME_MM) && near(spec.rotation[k], part.rotation[k], SAME_DEG)) &&
    near(spec.size.length, part.size.length, SAME_MM) &&
    near(spec.size.width, part.size.width, SAME_MM) &&
    near(spec.size.height, part.size.height, SAME_MM) &&
    sameCuts(spec.cuts, part.cuts)
  );
}

/**
 * Re-framing takes an opening's framing out and lays it out again, so a part that ends up
 * exactly where it was, with the same size and cuts (a king stud when only the height changed,
 * an uncut sheathing sheet), would come back under a new ID. Keep the old part instead: its ID, joints and any edits stay,
 * and the view doesn't show it arriving again. Run after framing, before working out joints.
 */
export function keepUnchangedParts(state: WallState, project: Project): void {
  const removed = new Set(state.removed);
  for (const item of state.items) {
    if (!item.isNew) continue;
    const spec = state.specs.find((s) => s.key === item.ref);
    if (!spec || spec.tags.some((t) => t.includes('#'))) continue;
    let match: string | undefined;
    for (const id of removed) {
      const part = project.parts[id];
      if (part && sameAsPart(spec, part)) {
        match = id;
        break;
      }
    }
    if (match === undefined) continue;
    removed.delete(match);
    state.removed = state.removed.filter((id) => id !== match);
    state.specs = state.specs.filter((s) => s !== spec);
    item.ref = match;
    item.isNew = false;
  }
}
