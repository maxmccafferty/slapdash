/**
 * The renderer's public surface for the rest of the app (and, later, the agent package's
 * `snapshot` tool): take a snapshot of the model without moving the user's view.
 */
export { renderSnapshot, isSnapshotReady, SNAPSHOT_TIMEOUT_MS } from './snapshot/registry.ts';
export {
  zSnapshotRequest,
  validateSnapshotRequest,
  SnapshotError,
  SNAPSHOT_ANGLES,
  SNAPSHOT_MODES,
  type SnapshotRequest,
  type SnapshotRequestInput,
  type SnapshotResult,
} from './snapshot/types.ts';
