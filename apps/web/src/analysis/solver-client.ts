/**
 * The web app's handle on the structural solver, which runs in a Web Worker
 * (`@slapdash/solver/worker`) so a solve never blocks the UI.
 *
 * `init` goes out once with the catalog; `analyze(project)` and `stability(project)`
 * return promises. For each kind the newest request wins: when a newer one is sent, the
 * older promise rejects with `StaleSolverRequest` and its reply, if it still comes, is
 * dropped. No UI here; the stress view will sit on top of this.
 */
import type { Catalog, Project } from '@slapdash/core';
import type { AnalysisOptions, AnalysisResult } from '@slapdash/solver';
import type { SolverRequest, SolverResponse } from '@slapdash/solver/protocol';
import type { StabilityOptions, StabilityResult } from '@slapdash/solver/stability';

/** The part of `Worker` the client uses, so tests can pass a fake. */
export interface SolverWorkerLike {
  postMessage(message: SolverRequest): void;
  onmessage: ((event: MessageEvent<SolverResponse>) => void) | null;
  terminate(): void;
}

/** A request superseded by a newer one of the same kind (or by `dispose`). */
export class StaleSolverRequest extends Error {
  constructor(kind: string) {
    super(`A newer ${kind} request replaced this one.`);
    this.name = 'StaleSolverRequest';
  }
}

export interface SolverClient {
  analyze(project: Project, options?: AnalysisOptions): Promise<AnalysisResult>;
  stability(project: Project, options?: StabilityOptions): Promise<StabilityResult>;
  dispose(): void;
}

type Kind = 'analyze' | 'stability';
interface Pending {
  id: number;
  resolve(value: never): void;
  reject(err: Error): void;
}

export function createSolverClient(catalog: Catalog, createWorker: () => SolverWorkerLike): SolverClient {
  const worker = createWorker();
  let nextId = 1;
  const latest = new Map<Kind, Pending>();

  worker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type !== 'analyze' && msg.type !== 'stability') {
      if (!msg.ok) console.error(`Solver: ${msg.error}`);
      return;
    }
    const pending = latest.get(msg.type);
    if (!pending || pending.id !== msg.id) return; // stale: a newer request is in flight
    latest.delete(msg.type);
    if (msg.ok) pending.resolve(msg.result as never);
    else pending.reject(new Error(msg.error));
  };
  worker.postMessage({ type: 'init', id: nextId++, catalog });

  function request<T>(kind: Kind, message: SolverRequest): Promise<T> {
    latest.get(kind)?.reject(new StaleSolverRequest(kind));
    return new Promise<T>((resolve, reject) => {
      latest.set(kind, { id: message.id, resolve: resolve as (v: never) => void, reject });
      worker.postMessage(message);
    });
  }

  return {
    analyze: (project, options) => request<AnalysisResult>('analyze', { type: 'analyze', id: nextId++, project, ...(options ? { options } : {}) }),
    stability: (project, options) => request<StabilityResult>('stability', { type: 'stability', id: nextId++, project, ...(options ? { options } : {}) }),
    dispose() {
      for (const [kind, p] of latest) p.reject(new StaleSolverRequest(kind));
      latest.clear();
      worker.onmessage = null;
      worker.terminate();
    },
  };
}
