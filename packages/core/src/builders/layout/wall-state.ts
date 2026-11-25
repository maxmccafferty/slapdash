/**
 * A wall being framed or re-framed, in its own frame: u along the wall from its start
 * point (outside face), v up from the bottom of the bottom plate, w across from the
 * outside face of the framing inwards. `build_wall` fills it from scratch;
 * `add_opening` loads it from the wall's existing parts. Both then run the same
 * opening code, so a wall built with an opening equals a wall plus add_opening.
 */
import { boxInFrame, placeMember, type FrameAxis, type FrameBox, type PlanFrame } from '../../geometry/frame.ts';
import type { PartRole } from '../../model/ids.ts';
import type { BuildPhase, Part, Project } from '../../model/schema.ts';
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

export interface WallState {
  frame: PlanFrame;
  params: WallParams;
  /** The wall assembly: a layout key (new wall) or its ID. */
  wallRef: Ref;
  items: WallItem[];
  specs: PartSpec[];
  /** Existing part IDs removed. */
  removed: string[];
  nextKey: number;
}

export function newWallState(frame: PlanFrame, params: WallParams, wallRef: Ref): WallState {
  return { frame, params, wallRef, items: [], specs: [], removed: [], nextKey: 0 };
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
