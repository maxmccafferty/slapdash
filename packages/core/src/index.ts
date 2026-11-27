/**
 * @slapdash/core — the parts-and-joints model, catalog schema, command bus with undo,
 * and units. Pure TypeScript: no DOM, no React, no Three.js.
 */
export * from './units/index.ts';
export * from './geometry/vec3.ts';
export * from './catalog/index.ts';
export * from './model/index.ts';
export * from './site/design-loads.ts';
export { partBox, boxCorners, boxesOverlap, aabbOf, rotationAxes, type OrientedBox, type Aabb } from './geometry/obb.ts';
export {
  hasCuts,
  validateCuts,
  buildSolid,
  partSolid,
  solidSurfaceTriangles,
  partSolidCorners,
  partSolidAabb,
  partFeatureEdges,
  convexPiecesOverlap,
  partsOverlap,
  describeCuts,
  pitchAngleDeg,
  frameProfileToLocal,
  shortLength,
  type CutDescription,
  type CutLabel,
  type CutName,
  type NotchDescription,
  type Solid,
  type ConvexPiece,
  type CutPartLike,
} from './geometry/cuts.ts';
export { placeMember, placeOriented, boxInFrame, toWorld, toFrame, type PlanFrame, type FrameBox } from './geometry/frame.ts';
export { findClashes, findAllClashes, describeClashes, CLASH_TOLERANCE_MM, type Clash, type ClashCandidate } from './model/clash.ts';
export { BUILDER_DEFAULTS } from './builders/defaults.ts';
export { codeNotes, type CodeNote } from './code/index.ts';
export { FENCE_STYLES, poolParts, poolSideOf, type BuildFenceInput, type FenceGateInput, type FenceStyle } from './builders/layout/fence.ts';
export { STRUCTURE_KINDS, type StructureKind } from './builders/layout/structure.ts';
export type { BuildPergolaInput } from './builders/layout/pergola.ts';
export type { BuildDeckInput } from './builders/layout/deck.ts';
export {
  HEADER_TABLE,
  KING_STUD_TABLE,
  pickHeader,
  kingStudsFor,
  anchorBoltCount,
  type HeaderChoice,
  type HeaderRow,
} from './builders/rules.ts';

export {
  commandError,
  formatErrors,
  notFound,
  suggest,
  editDistance,
  zodIssuesToErrors,
  type CommandError,
  type CommandErrorCode,
} from './commands/errors.ts';
export { checkJoint, type JointFields } from './commands/joints.ts';
export type { AnyCommandDef, AppliedCommand, ApplyResult, CommandContext, CommandDef } from './commands/types.ts';
export { commandRegistry, exposedCommands } from './commands/registry.ts';
export { zId } from './commands/common.ts';
export { commandJsonSchemas, historyToolSchemas, toInputJsonSchema, type ToolSchema } from './commands/json-schema.ts';

export {
  CommandBus,
  type BusEvent,
  type BusEventType,
  type BusListener,
  type BusResult,
  type CommandBusOptions,
  type ExecResult,
  type SerializedBus,
  type UndoResult,
} from './bus/command-bus.ts';
export {
  DEFAULT_HISTORY_LIMIT,
  historyToolDefs,
  type GroupMeta,
  type HistoryEntry,
  type HistoryListItem,
  type HistorySource,
  type RecordedCommand,
} from './bus/history.ts';
export type { SavedVersion, VersionListItem } from './bus/versions.ts';
export * from './materials/index.ts';
