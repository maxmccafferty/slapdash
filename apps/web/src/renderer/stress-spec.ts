/** The stress overlay for the user's view: bands for every part and the callout on the most loaded visible one. */
import type { Project } from '@slapdash/core';
import type { AnalysisResult } from '@slapdash/solver';
import { calloutText, mostLoaded, stressBands } from '../analysis/stress.ts';
import type { StressSpec } from './SceneContent.tsx';

export function stressSpec(project: Project, result: AnalysisResult, isVisible: (partId: string) => boolean): StressSpec {
  const worst = mostLoaded(result, project, isVisible);
  return {
    bands: stressBands(project, result),
    callout: worst ? { partId: worst.id, text: calloutText(worst.label, worst.utilization), over: worst.utilization > 1 } : null,
  };
}
