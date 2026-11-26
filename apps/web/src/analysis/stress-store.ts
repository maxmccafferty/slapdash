/**
 * The stress view's analysis state. `useStressAnalysis` writes it; the scene, the
 * legend and the automatic explain turn read it. The last result stays on screen while
 * a new one runs. UI-free.
 */
import type { Project } from '@slapdash/core';
import type { AnalysisResult } from '@slapdash/solver';
import { create } from 'zustand';

export type StressStatus = 'idle' | 'running' | 'ready' | 'error';

export interface StressState {
  status: StressStatus;
  result: AnalysisResult | null;
  /** The project the result is for. */
  forProject: Project | null;
  error: string | null;
  /** Counts Stress switch-ons, so the automatic turn runs once per switch-on. */
  switchOn: number;
  /** The switch-on whose first result has been considered for the automatic turn. */
  explainedFor: number | null;
}

export const initialStressState: StressState = {
  status: 'idle',
  result: null,
  forProject: null,
  error: null,
  switchOn: 0,
  explainedFor: null,
};

export const useStressStore = create<StressState>()(() => ({ ...initialStressState }));

/** Back to the initial state (tests). */
export function resetStressStore(): void {
  useStressStore.setState(initialStressState);
}
