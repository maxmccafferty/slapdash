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
