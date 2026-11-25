export { SYSTEM_PROMPT } from './system-prompt.ts';
export { agentTools, buildAgentTools, type AgentTool } from './tools.ts';
export {
  KEYHOLE_STATES,
  formatSseEvent,
  parseKeyholeEvents,
  parseKeyholeRequest,
  zKeyholeRequest,
  type BudgetState,
  type BudgetStatus,
  type KeyholeDone,
  type KeyholeError,
  type KeyholeEvent,
  type KeyholeRequest,
  type KeyholeState,
  type KeyholeStatus,
  type KeyholeStreamError,
} from './protocol.ts';

// The loop
export { runTurn, type AgentDeps, type AgentEvent, type TurnResult, type UserInput } from './loop.ts';
export {
  fetchKeyholeClient,
  KeyholeRequestError,
  stateOf,
  type FetchInitLike,
  type FetchLike,
  type FetchResponseLike,
  type KeyholeClient,
  type KeyholeRequestFailure,
} from './client.ts';
export { accumulateMessage, INVALID_JSON_KEY, KeyholeStreamFailure, type AccumulatedMessage, type AccumulateCallbacks, type AssistantBlock } from './stream.ts';
export {
  AgentMemory,
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_TURNS,
  IMAGE_KEEP_TURNS,
  MAX_SUMMARY_CHARS,
  PHOTO_STUB,
  PHOTO_WRAPPER,
  PROJECT_STUB,
  snapshotStub,
  type ChatLogLike,
  type ChatPrefs,
  type Json,
  type LoadedFile,
  type MemoryOptions,
  type StoredBlock,
  type StoredMessage,
} from './memory.ts';
export {
  BIG_CHANGE_MESSAGE,
  BIG_CHANGE_PART_THRESHOLD,
  BIG_CHANGE_TOOLS,
  DEFAULT_CAPS,
  HISTORY_CHANGE_TOOLS,
  MUTATING_TOOLS,
  checkCall,
  newTurnState,
  type TurnCaps,
  type TurnState,
} from './guard.ts';
export { dispatchTool, NO_SNAPSHOT_MESSAGE, type DispatchContext, type PlanEvent, type ToolCall, type ToolEffects, type ToolOutcome } from './dispatch.ts';
export { projectSummary, type SummaryOptions } from './summary.ts';

// Tools that are not bus commands
export {
  AGENT_TOOL_NAMES,
  agentToolDefs,
  zFindParts,
  zGetPart,
  zListMaterials,
  zMeasure,
  zProposePlan,
  zRequestPhoto,
  zSetPreferences,
  type AgentToolName,
  type PlanProposal,
} from './tools/schemas.ts';
export { QUERY_TOOLS, findParts, getPartInfo, listMaterials, measure, type QueryResult } from './tools/queries.ts';
export {
  SNAPSHOT_ANGLES,
  SNAPSHOT_MODES,
  SnapshotError,
  expandIds,
  snapshotLabel,
  validateSnapshotRequest,
  zSnapshotRequest,
  type RenderableMode,
  type RenderableSnapshotRequest,
  type SnapshotAngle,
  type SnapshotImage,
  type SnapshotMode,
  type SnapshotProvider,
  type SnapshotRequest,
  type SnapshotRequestInput,
  type ValidatedSnapshot,
} from './tools/snapshot.ts';
