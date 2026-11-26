/**
 * The Floors slider's stops and the header's part count, from the model. While a project
 * has one level, the heights are: Foundation = top of the foundation, Floor 1 = top of the
 * walls (the top plate), Roof = top of the roof (the ridge). A stop with nothing built yet
 * keeps its placeholder height.
 */
import { formatFeetInches, type AssemblyKind, type Project } from '@slapdash/core';
import { PLACEHOLDER_FLOORS, PLACEHOLDER_PROJECT, type FloorStop, type ProjectSummary } from '../placeholder.ts';
import { isContextPart, partAabb } from '../renderer/bounds.ts';
import { toPrimes } from '../renderer/units.ts';
import { useModelStore } from '../state/model-store.ts';
import type { FloorId } from '../state/shell-store.ts';

const STOP_KIND: Record<FloorId, AssemblyKind> = { roof: 'roof', 'floor-1': 'wall', foundation: 'foundation' };

function topOf(project: Project, kind: AssemblyKind): number | null {
  let top: number | null = null;
  for (const part of Object.values(project.parts)) {
    if (project.assemblies[part.assemblyId]?.kind !== kind || isContextPart(part)) continue;
    const y = partAabb(part).max.y;
    if (top === null || y > top) top = y;
  }
  return top;
}

const cache = new WeakMap<Project, FloorStop[]>();

export function floorStops(project: Project | null): FloorStop[] {
  if (!project) return PLACEHOLDER_FLOORS;
  const cached = cache.get(project);
  if (cached) return cached;
  const stops = PLACEHOLDER_FLOORS.map((stop) => {
    const top = topOf(project, STOP_KIND[stop.id]);
    return top === null ? stop : { ...stop, height: toPrimes(formatFeetInches(top, { precision: 1 })) };
  });
  cache.set(project, stops);
  return stops;
}

export function useFloorStops(): FloorStop[] {
  return useModelStore((s) => floorStops(s.project));
}

/** The number of parts that are built (site context doesn't count). */
export function partCount(project: Project): number {
  return Object.values(project.parts).filter((p) => !isContextPart(p)).length;
}

const summaryCache = new WeakMap<Project, ProjectSummary>();

/**
 * The header: the project's name (first run reads "New project"), placeholder specs, and the
 * real part count once a project has parts.
 */
export function projectSummary(project: Project | null): ProjectSummary {
  if (!project) return PLACEHOLDER_PROJECT;
  const cached = summaryCache.get(project);
  if (cached) return cached;
  const count = partCount(project);
  const summary = {
    ...PLACEHOLDER_PROJECT,
    name: project.name,
    specs: PLACEHOLDER_PROJECT.specs.map((s) => (s.label === 'Parts' && count > 0 ? { ...s, value: String(count) } : s)),
  };
  summaryCache.set(project, summary);
  return summary;
}

export function useProjectSummary(): ProjectSummary {
  return useModelStore((s) => projectSummary(s.project));
}
