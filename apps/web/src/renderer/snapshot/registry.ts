/**
 * The public snapshot entry point. Validates the request against the current project,
 * then hands it to the renderer mounted in the canvas (`SnapshotHost`), one at a time, with
 * a 10 s limit. Rejections are `SnapshotError`s with plain-language messages for Claude.
 */
import { commandError, type CatalogIndex, type Project } from '@slapdash/core';
import { useModelStore } from '../../state/model-store.ts';
import { SnapshotError, validateSnapshotRequest, type RenderableMode, type SnapshotRequest, type SnapshotResult } from './types.ts';

export type SnapshotImpl = (
  request: SnapshotRequest & { mode: RenderableMode },
  project: Project,
  catalog: CatalogIndex | null,
) => Promise<SnapshotResult>;

export const SNAPSHOT_TIMEOUT_MS = 10_000;

let impl: SnapshotImpl | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Called by `SnapshotHost` when the canvas mounts. Returns the unregister function. */
export function registerSnapshotRenderer(fn: SnapshotImpl): () => void {
  impl = fn;
  return () => {
    if (impl === fn) impl = null;
  };
}

export function isSnapshotReady(): boolean {
  return impl !== null;
}

const fail = (message: string, hint?: string) => new SnapshotError([commandError('not_allowed', message, hint ? { hint } : {})]);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(fail(`The snapshot took longer than ${ms / 1000} seconds and was stopped.`, 'Try a smaller size.')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Render a snapshot of the current model. The user's view never moves. */
export function renderSnapshot(raw: unknown = {}): Promise<SnapshotResult> {
  const { project, catalog } = useModelStore.getState();
  if (!project) return Promise.reject(fail('There is no project open to take a snapshot of.'));
  const checked = validateSnapshotRequest(raw, project);
  if (!checked.ok) return Promise.reject(new SnapshotError(checked.errors));
  const run = impl;
  if (!run) return Promise.reject(fail("The 3D view isn't ready yet.", 'Try again in a moment.'));
  const job = queue.then(() => withTimeout(run(checked.request, project, catalog), SNAPSHOT_TIMEOUT_MS));
  queue = job.catch(() => undefined);
  return job;
}
