/** The build steps of the open project and where the Build steps panel is. */
import { buildStepGroups, type BuildStepGroup, type CatalogIndex, type Project, type StepKey } from '@slapdash/core';
import { useMemo } from 'react';
import { stepsUpTo } from '../renderer/visibility.ts';
import { useModelStore } from '../state/model-store.ts';
import { useShellStore } from '../state/shell-store.ts';

const cache = new WeakMap<Project, BuildStepGroup[]>();
const NONE: BuildStepGroup[] = [];

/** `buildStepGroups`, memoised per project state. */
export function stepGroups(project: Project | null, catalog: CatalogIndex | null): BuildStepGroup[] {
  if (!project) return NONE;
  let groups = cache.get(project);
  if (!groups) cache.set(project, (groups = buildStepGroups(project, catalog ?? undefined)));
  return groups;
}

/** The store's step index, clamped to the steps there are (parts can be removed under it). */
export function clampStep(index: number, count: number): number {
  return count === 0 ? 0 : Math.min(Math.max(0, index), count - 1);
}

export interface BuildSteps {
  groups: BuildStepGroup[];
  index: number;
  current: BuildStepGroup | null;
}

export function useBuildSteps(): BuildSteps {
  const project = useModelStore((s) => s.project);
  const catalog = useModelStore((s) => s.catalog);
  const stepIndex = useShellStore((s) => s.stepIndex);
  const groups = stepGroups(project, catalog);
  const index = clampStep(stepIndex, groups.length);
  return { groups, index, current: groups[index] ?? null };
}

/** The steps the model shows: those up to the current one while Build steps is open, else null (everything). */
export function useStepFilter(): ReadonlySet<StepKey> | null {
  const open = useShellStore((s) => s.panel === 'steps');
  const { groups, index } = useBuildSteps();
  // Keyed by the step keys, so a new project state with the same steps keeps the same set
  // (and the scene doesn't refilter every part on each change).
  const key = open ? [...stepsUpTo(groups, index)].join(',') : null;
  return useMemo(() => (key === null ? null : new Set(key.split(',').filter(Boolean) as StepKey[])), [key]);
}
