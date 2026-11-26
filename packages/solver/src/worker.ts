/// <reference lib="webworker" />
/**
 * Web Worker entry: runs the solver off the main thread. In the web app it is loaded with
 * Vite's `?worker` import (see apps/web/src/analysis/solver-client.ts). All the logic is in
 * `handleSolverMessage`; this file only moves messages.
 */
import { createSolverState, handleSolverMessage, type SolverRequest } from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

const state = createSolverState();
self.onmessage = async (e: MessageEvent<SolverRequest>) => {
  self.postMessage(await handleSolverMessage(state, e.data));
};
