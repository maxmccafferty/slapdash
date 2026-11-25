/** What every view needs: the visible build, grouped by assembly. */
import type { Assembly, AssemblyKind, Part, Project, StepKey } from '@slapdash/core';
import { isContextPart, partAabb, unionAabb } from '../renderer/bounds.ts';
import { isPartVisible } from '../renderer/visibility.ts';
import type { FloorId } from '../state/shell-store.ts';

export interface SheetOptions {
  floor: FloorId;
  dimensions: boolean;
  /** While Build steps is open: the steps shown, so the sheet matches the 3D view. */
  steps?: ReadonlySet<StepKey> | null;
}

export interface AssemblyGroup {
  id: string;
  /** Missing for parts whose assembly is gone (a broken file): drawn as misc. */
  assembly: Assembly | undefined;
  kind: AssemblyKind;
  parts: Part[];
}

export interface DrawContext {
  project: Project;
  opts: SheetOptions;
  groups: AssemblyGroup[];
  byId: Map<string, AssemblyGroup>;
  /** Ground level (the lowest level), mm. */
  ground: number;
  /** Where heights are measured from: the foundation top, else the ground. */
  base: number;
}

export function drawContext(project: Project, opts: SheetOptions): DrawContext {
  const byId = new Map<string, AssemblyGroup>();
  for (const part of Object.values(project.parts)) {
    if (isContextPart(part)) continue;
    const assembly = project.assemblies[part.assemblyId];
    if (!isPartVisible(part, assembly, { floor: opts.floor, lookFrom: 'outside', steps: opts.steps ?? null })) continue;
    let g = byId.get(part.assemblyId);
    if (!g) {
      g = { id: part.assemblyId, assembly, kind: assembly?.kind ?? 'misc', parts: [] };
      byId.set(part.assemblyId, g);
    }
    g.parts.push(part);
  }
  const groups = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const levels = project.levels;
  const ground = levels.reduce((low, l) => Math.min(low, l.elevation_mm), levels[0]?.elevation_mm ?? 0);
  const foundation = unionAabb(groups.filter((g) => g.kind === 'foundation').flatMap((g) => g.parts.map(partAabb)));
  return { project, opts, groups, byId, ground, base: foundation ? foundation.max.y : ground };
}

export function groupsOf(ctx: DrawContext, kind: AssemblyKind): AssemblyGroup[] {
  return ctx.groups.filter((g) => g.kind === kind);
}
