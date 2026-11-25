/**
 * @slapdash/core — the parts-and-joints model, catalog schema, command bus with undo,
 * and units. Pure TypeScript: no DOM, no React, no Three.js.
 */
export * from './units/index.ts';
export * from './geometry/vec3.ts';
export * from './catalog/index.ts';
export * from './model/index.ts';
export * from './site/design-loads.ts';

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
export type { AnyCommandDef, AppliedCommand, ApplyResult, CommandContext, CommandDef } from './commands/types.ts';
export { commandRegistry, exposedCommands } from './commands/registry.ts';
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
