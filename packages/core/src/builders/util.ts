/** Helpers shared by the builder layouts. */
import { z } from 'zod';
import type { MaterialCategory } from '../catalog/schema.ts';
import type { CatalogIndex } from '../catalog/validate.ts';
import { commandError, notFound, type CommandError } from '../commands/errors.ts';
import { aabbOf, partBox, type Aabb } from '../geometry/obb.ts';
import type { Assembly, Part, Project } from '../model/schema.ts';
import { KPA_PER_PSF } from '../site/design-loads.ts';
import { formatFeetInches, MM_PER_FOOT } from '../units/length.ts';
import { LENGTH_DESCRIPTION, zLength } from '../units/zod.ts';
import { BUILDER_DEFAULTS } from './defaults.ts';

export const zPlanPoint = z
  .strictObject({
    x: zLength.describe(`East-west position (+x is east). ${LENGTH_DESCRIPTION}`),
    z: zLength.describe(`North-south position (+z is south). ${LENGTH_DESCRIPTION}`),
  })
  .describe('A point on the plan, from the ground origin corner (+x east, +z south).');
export type PlanPoint = { x: number; z: number };

export const zBuilderName = z.string().trim().min(1).optional().describe('Readable name for the new assembly.');

/** Feet-and-inches text for messages: `9' 0"`, or just inches under a foot (`3 1/2"`). */
export const fi = (mm: number) => {
  const s = formatFeetInches(mm);
  return s.replace(/^(-?)0' /, '$1');
};

export function snowLoad(project: Project): { psf: number; note: string } {
  const o = project.site.designLoads.groundSnow;
  if (o) {
    const psf = o.value / KPA_PER_PSF;
    return { psf, note: `the project's ${Number(psf.toFixed(1))} psf ground snow load` };
  }
  return { psf: BUILDER_DEFAULTS.groundSnowPsf, note: `the default ${BUILDER_DEFAULTS.groundSnowPsf} psf ground snow load` };
}

export function footingDepth(project: Project): { mm: number; note: string } {
  const o = project.site.designLoads.frostDepth;
  if (o && o.value > BUILDER_DEFAULTS.footingDepth) {
    return { mm: o.value, note: `the project's ${fi(o.value)} frost depth` };
  }
  return {
    mm: BUILDER_DEFAULTS.footingDepth,
    note: o ? `the 12in minimum (deeper than the ${fi(o.value)} frost depth)` : 'the default 12in depth (no frost depth set)',
  };
}

/** How many assemblies this builder has made already: the build-step seq for the next one. */
export function builderSeq(project: Project, builderName: string): number {
  return Object.values(project.assemblies).filter((a) => a.builder?.name === builderName).length;
}

export function partAabb(part: Part): Aabb {
  return aabbOf(partBox(part));
}

export function containsPlan(a: Aabb, p: PlanPoint, tol = 1): boolean {
  return p.x >= a.min.x - tol && p.x <= a.max.x + tol && p.z >= a.min.z - tol && p.z <= a.max.z + tol;
}

export interface Support {
  kind: 'concrete' | 'wood' | 'none';
  /** Top of the highest supporting part (or 0 on the ground). */
  top: number;
  /** The supporting part(s). */
  partIds: string[];
  assembly?: Assembly;
}

/**
 * What is under these plan points: the highest foundation or floor part whose plan
 * extent covers any of them.
 */
export function supportUnder(project: Project, points: readonly PlanPoint[], catalog: CatalogIndex): Support {
  let best: { part: Part; top: number } | null = null;
  for (const part of Object.values(project.parts)) {
    const asm = project.assemblies[part.assemblyId];
    if (!asm || (asm.kind !== 'foundation' && asm.kind !== 'floor')) continue;
    const box = partAabb(part);
    if (!points.some((p) => containsPlan(box, p, -1))) continue;
    if (!best || box.max.y > best.top + 1e-6) best = { part, top: box.max.y };
  }
  if (!best) return { kind: 'none', top: 0, partIds: [] };
  const material = catalog.materials.get(best.part.materialId);
  const kind = material?.category === 'concrete' ? 'concrete' : 'wood';
  return { kind, top: best.top, partIds: [best.part.id], assembly: project.assemblies[best.part.assemblyId] };
}

/** Plan extent of an assembly's parts. */
export function assemblyFootprint(project: Project, assemblyId: string): Aabb | null {
  let out: Aabb | null = null;
  for (const p of Object.values(project.parts)) {
    if (p.assemblyId !== assemblyId) continue;
    const b = partAabb(p);
    out = out
      ? {
          min: { x: Math.min(out.min.x, b.min.x), y: Math.min(out.min.y, b.min.y), z: Math.min(out.min.z, b.min.z) },
          max: { x: Math.max(out.max.x, b.max.x), y: Math.max(out.max.y, b.max.y), z: Math.max(out.max.z, b.max.z) },
        }
      : b;
  }
  return out;
}

/** Building width for header sizing: given, else the shorter side of what's underneath, else 36 ft. */
export function buildingWidth(
  project: Project,
  given: number | undefined,
  support: Support,
): { ft: number; note: string } {
  if (given !== undefined) return { ft: given / MM_PER_FOOT, note: `a ${fi(given)} building width` };
  if (support.assembly) {
    const fp = assemblyFootprint(project, support.assembly.id);
    if (fp) {
      const w = Math.min(fp.max.x - fp.min.x, fp.max.z - fp.min.z);
      return { ft: w / MM_PER_FOOT, note: `a ${fi(w)} building width (the short side of ${support.assembly.id})` };
    }
  }
  return {
    ft: BUILDER_DEFAULTS.buildingWidthFt,
    note: `the widest (${BUILDER_DEFAULTS.buildingWidthFt}ft) building-width column, since nothing tells me the building width`,
  };
}

/** "east", "north-west"… for a plan direction (+x east, +z south). */
export function compass(dx: number, dz: number): string {
  const ang = (Math.atan2(-dz, dx) * 180) / Math.PI; // 0 = east, 90 = north
  const names = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
  return names[((Math.round(ang / 45) % 8) + 8) % 8]!;
}

export function requireMaterial(
  catalog: CatalogIndex,
  id: string,
  categories: readonly MaterialCategory[],
  path: string,
): CommandError | null {
  const m = catalog.materials.get(id);
  if (!m) return notFound('material', id, catalog.materials.keys(), path);
  if (!categories.includes(m.category)) {
    return commandError('invalid_input', `${m.name} ("${id}") is ${m.category}, but this needs ${categories.join(' or ')}.`, { path });
  }
  return null;
}

export function requireSection(catalog: CatalogIndex, id: string, path: string): CommandError | null {
  return catalog.sections.has(id) ? null : notFound('section', id, catalog.sections.keys(), path);
}

export function sectionDims(catalog: CatalogIndex, id: string): { width: number; depth: number } {
  const s = catalog.sections.get(id);
  if (!s) throw new Error(`missing section ${id}`);
  return { width: s.dims_mm.width, depth: s.dims_mm.depth };
}

export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
