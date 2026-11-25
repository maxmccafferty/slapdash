/**
 * The real solver worker, built by Vite (`?worker`, ES format so the worker can split
 * Rapier into a lazy chunk). Kept apart from solver-client.ts so tests can use a fake.
 *
 *   const solver = createSolverClient(CATALOG, createSolverWorker);
 */
import SolverWorker from '@slapdash/solver/worker?worker';
import type { SolverWorkerLike } from './solver-client.ts';

export function createSolverWorker(): SolverWorkerLike {
  return new SolverWorker({ name: 'slapdash-solver' }) as unknown as SolverWorkerLike;
}
