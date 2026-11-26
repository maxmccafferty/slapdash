/**
 * The solver's message protocol, shared by the Web Worker entry (`./worker`) and any
 * other transport. `handleSolverMessage` is pure apart from the state it is given, so it
 * runs and is tested in Node; Node callers can also just call `analyze` directly.
 *
 * The client sends `init` once with the catalog, then `analyze` or `stability` requests
 * carrying `{ id, project, options }`. Every reply is `{ id, type, ok, result | error }`.
 * Ids let the client drop stale replies (the newest request wins).
 *
 * The stability sim is imported lazily here too, so a worker that only analyses never
 * loads Rapier's WASM.
 */
import { indexCatalog, isCatalogIndex, type Catalog, type CatalogIndex, type Project } from '@slapdash/core';
import { analyze } from './analyze.ts';
import type { StabilityOptions, StabilityResult } from './stability/index.ts';
import type { AnalysisOptions, AnalysisResult } from './types.ts';

export type SolverRequest =
  | { type: 'init'; id: number; catalog: Catalog }
  | { type: 'analyze'; id: number; project: Project; options?: AnalysisOptions }
  | { type: 'stability'; id: number; project: Project; options?: StabilityOptions };

export interface SolverResults {
  init: { ready: true };
  analyze: AnalysisResult;
  stability: StabilityResult;
}

export type SolverResponse<T extends keyof SolverResults = keyof SolverResults> =
  | { id: number; type: T; ok: true; result: SolverResults[T] }
  | { id: number; type: T | 'unknown'; ok: false; error: string };

export interface SolverState {
  catalog?: CatalogIndex;
}

export function createSolverState(): SolverState {
  return {};
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function handleSolverMessage(state: SolverState, msg: SolverRequest): Promise<SolverResponse> {
  const id = typeof msg?.id === 'number' ? msg.id : -1;
  try {
    switch (msg?.type) {
      case 'init':
        state.catalog = isCatalogIndex(msg.catalog) ? msg.catalog : indexCatalog(msg.catalog);
        return { id, type: 'init', ok: true, result: { ready: true } };
      case 'analyze':
        if (!state.catalog) throw new Error('The solver has no catalog yet: send init first.');
        return { id, type: 'analyze', ok: true, result: analyze(msg.project, state.catalog, msg.options) };
      case 'stability': {
        if (!state.catalog) throw new Error('The solver has no catalog yet: send init first.');
        const { simulateStability } = await import('./stability/index.ts');
        return { id, type: 'stability', ok: true, result: await simulateStability(msg.project, state.catalog, msg.options) };
      }
      default:
        return { id, type: 'unknown', ok: false, error: `Unknown solver message type: ${String((msg as { type?: unknown })?.type)}` };
    }
  } catch (err) {
    return { id, type: msg.type, ok: false, error: message(err) };
  }
}
