/**
 * Dev and e2e only: `window.__slapdash.solver.analyze()` / `.stability()` run the solver
 * worker on the current project and resolve with the result and the round-trip time. The
 * client and the worker load on the first call, never at startup.
 */
import type { SolverClient } from './solver-client.ts';
import { solver } from './solver.ts';
import { useModelStore } from '../state/model-store.ts';
import { useSiteStore } from '../state/site-store.ts';

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
  analyze: () => timed((c) => c.analyze(project(), { siteDefaults: useSiteStore.getState().siteDefaults }, 'debug')),
  stability: () => timed((c) => c.stability(project(), undefined, 'debug')),
};
