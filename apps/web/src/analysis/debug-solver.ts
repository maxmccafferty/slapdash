/**
 * Dev and e2e only: `window.__slapdash.solver.analyze()` / `.stability()` run the solver
 * worker on the current project and resolve with the result and the round-trip time. The
 * client and the worker load on the first call, never at startup.
 */
import { TIER1_CATALOG } from '@slapdash/catalog';
import type { SolverClient } from './solver-client.ts';
import { useModelStore } from '../state/model-store.ts';

let client: Promise<SolverClient> | undefined;

function solver(): Promise<SolverClient> {
  client ??= Promise.all([import('./solver-client.ts'), import('./solver-worker.ts')]).then(([c, w]) => c.createSolverClient(TIER1_CATALOG, w.createSolverWorker));
  return client;
}

async function timed<T>(run: (c: SolverClient) => Promise<T>): Promise<{ ms: number; result: T }> {
  const c = await solver();
  const start = performance.now();
  const result = await run(c);
  return { ms: performance.now() - start, result };
}

function project() {
  const p = useModelStore.getState().project;
  if (!p) throw new Error('No project is open.');
  return p;
}

export const solverDebug = {
  analyze: () => timed((c) => c.analyze(project())),
  stability: () => timed((c) => c.stability(project())),
};
