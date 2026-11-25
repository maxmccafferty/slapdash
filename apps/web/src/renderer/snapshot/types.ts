/**
 * The `snapshot` request (ADR-0002 §B10): how Claude (or a test) asks for a picture of the
 * model. It renders offscreen, so the user's camera never moves.
 *
 * The request schema and its validation live in `@slapdash/agent` (the snapshot tool uses
 * them); they are re-exported here for the renderer. Only the browser result type, with its
 * PNG `Blob`, is defined here.
 */
export {
  SNAPSHOT_ANGLES,
  SNAPSHOT_MODES,
  SnapshotError,
  expandIds,
  validateSnapshotRequest,
  zSnapshotRequest,
  type RenderableMode,
  type SnapshotAngle,
  type SnapshotMode,
  type SnapshotRequest,
  type SnapshotRequestInput,
  type ValidatedSnapshot,
} from '@slapdash/agent';

import type { RenderableMode as AgentRenderableMode } from '@slapdash/agent';

/**
 * What the scene can draw: the snapshot modes plus the user's stress view. Stress stays
 * renderer-local (snapshots can't show it; Claude reads check_structure instead).
 */
export type SceneMode = AgentRenderableMode | 'stress';

export interface SnapshotResult {
  png: Blob;
  width: number;
  height: number;
  angle: string;
  mode: string;
  /** Plain-language notes for Claude, e.g. "The roof is hidden (looking from inside)." */
  notes: string[];
}
