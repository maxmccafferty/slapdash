/**
 * The web app's handle on the structural solver, which runs in a Web Worker
 * (`@slapdash/solver/worker`) so a solve never blocks the UI.
 *
 * `init` goes out once with the catalog; `analyze(project)` and `stability(project)`
 * return promises. For each kind and channel the newest request wins: when a newer one is
 * sent, the older promise rejects with `StaleSolverRequest` and its reply, if it still
 * comes, is dropped. Channels keep independent callers apart: the stress view's analysis
 * (`'view'`) and Claude's check_structure (`'claude'`) never cancel each other.
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
  analyze(project: Project, options?: AnalysisOptions, channel?: string): Promise<AnalysisResult>;
  stability(project: Project, options?: StabilityOptions, channel?: string): Promise<StabilityResult>;
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
  /** The newest pending request per `kind:channel`. */
  const latest = new Map<string, Pending>();

  worker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type !== 'analyze' && msg.type !== 'stability') {
      if (!msg.ok) console.error(`Solver: ${msg.error}`);
      return;
    }
    const entry = [...latest].find(([key, p]) => p.id === msg.id && key.startsWith(`${msg.type}:`));
    if (!entry) return; // stale: a newer request is in flight
    const [key, pending] = entry;
    latest.delete(key);
    if (msg.ok) pending.resolve(msg.result as never);
    else pending.reject(new Error(msg.error));
  };
  worker.postMessage({ type: 'init', id: nextId++, catalog });

  function request<T>(kind: Kind, channel: string, message: SolverRequest): Promise<T> {
    const key = `${kind}:${channel}`;
    latest.get(key)?.reject(new StaleSolverRequest(kind));
    return new Promise<T>((resolve, reject) => {
      latest.set(key, { id: message.id, resolve: resolve as (v: never) => void, reject });
      worker.postMessage(message);
    });
  }

  return {
    analyze: (project, options, channel = 'default') =>
      request<AnalysisResult>('analyze', channel, { type: 'analyze', id: nextId++, project, ...(options ? { options } : {}) }),
    stability: (project, options, channel = 'default') =>
      request<StabilityResult>('stability', channel, { type: 'stability', id: nextId++, project, ...(options ? { options } : {}) }),
    dispose() {
      for (const [key, p] of latest) p.reject(new StaleSolverRequest(key.split(':')[0]!));
      latest.clear();
      worker.onmessage = null;
      worker.terminate();
    },
  };
}
