/**
 * The app's one solver client. The client and its worker load on the first request,
 * never at startup. The stress view uses the `'view'` channel and Claude's
 * check_structure the `'claude'` channel, so neither cancels the other.
 */
import { CATALOG } from '@slapdash/catalog';
import type { Project } from '@slapdash/core';
import type { AnalysisOptions, AnalysisResult } from '@slapdash/solver';
import type { SolverClient } from './solver-client.ts';

let client: Promise<SolverClient> | undefined;

export function solver(): Promise<SolverClient> {
  client ??= Promise.all([import('./solver-client.ts'), import('./solver-worker.ts')]).then(([c, w]) =>
    c.createSolverClient(CATALOG, w.createSolverWorker),
  );
  return client;
}

/** Analyse a project on a channel (newest wins per channel). */
export async function analyzeProject(project: Project, options?: AnalysisOptions, channel = 'default'): Promise<AnalysisResult> {
  return (await solver()).analyze(project, options, channel);
}
