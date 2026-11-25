/**
 * Build steps for the materials list (ADR-0003 §F) and, later, the Build steps screen.
 * A step comes from a part's assembly: the slab, the floor, the walls (with their
 * openings), the roof, a fence, a deck, a pergola, a structure, other items Claude placed
 * by hand (plumbing, electrical). Site context isn't built, so it is left out.
 * Steps are ordered by the earliest build phase among their parts, then by the fixed
 * order below (phases alone can tie, e.g. a fence and a structure are both site work).
 */
import type { Catalog } from '../catalog/schema.ts';
import { isCatalogIndex, type CatalogIndex } from '../catalog/validate.ts';
import { BUILDER_DEFAULTS } from '../builders/defaults.ts';
import { GROUND } from '../model/ids.ts';
import { BUILD_PHASES, type Assembly, type Joint, type Part, type Project } from '../model/schema.ts';

export const STEP_KEYS = ['slab', 'foundation', 'floor', 'walls', 'roof', 'fence', 'deck', 'pergola', 'structures', 'other', 'site'] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export const STEP_TITLES: Record<StepKey, string> = {
  slab: 'Slab',
  foundation: 'Foundation',
  floor: 'Floor',
  walls: 'Walls',
  roof: 'Roof',
  fence: 'Fence',
  deck: 'Deck',
  pergola: 'Pergola',
  structures: 'Structures',
  other: 'Other items',
  site: 'Site',
};

export interface BuildStepGroup {
  step: StepKey;
  title: string;
  /** The part ids in this step, sorted. */
  partIds: string[];
  /** The earliest `BUILD_PHASES` index among the parts. */
  phaseIndex: number;
}

/** Builders whose assemblies form their own step, whatever the assembly kind (a deck is a floor, a pergola roof a roof). */
const BUILDER_STEPS: Readonly<Record<string, StepKey>> = {
  build_fence: 'fence',
  build_deck: 'deck',
  build_pergola: 'pergola',
};

/** The step an assembly's parts belong to: its builder's step first, then its kind. */
export function stepOfAssembly(assembly: Assembly | undefined): StepKey {
  const name = assembly?.builder?.name;
  const byBuilder = name !== undefined && Object.hasOwn(BUILDER_STEPS, name) ? BUILDER_STEPS[name] : undefined;
  if (byBuilder) return byBuilder;
  switch (assembly?.kind) {
    case 'foundation':
      return assembly.builder?.name === 'pour_slab' ? 'slab' : 'foundation';
    case 'floor':
      return 'floor';
    case 'wall':
    case 'opening':
      return 'walls';
    case 'roof':
      return 'roof';
    case 'misc':
      return 'other';
    case 'structure':
      return 'structures';
    default:
      return 'site';
  }
}

export function stepOfPart(project: Project, part: Part): StepKey {
  return stepOfAssembly(project.assemblies[part.assemblyId]);
}

/** Whether a part is built (not site context: the house next door, a tree). */
export function isBuiltPart(part: Part, catalog?: Catalog | CatalogIndex): boolean {
  if (part.materialId === BUILDER_DEFAULTS.materials.siteContext) return false;
  if (!catalog) return true;
  const material = isCatalogIndex(catalog) ? catalog.materials.get(part.materialId) : catalog.materials.find((m) => m.id === part.materialId);
  return material?.category !== 'site';
}

/** The built parts grouped into build steps, in build order. */
export function buildStepGroups(project: Project, catalog?: Catalog | CatalogIndex): BuildStepGroup[] {
  const groups = new Map<StepKey, BuildStepGroup>();
  for (const part of Object.values(project.parts)) {
    if (!isBuiltPart(part, catalog)) continue;
    const step = stepOfPart(project, part);
    let g = groups.get(step);
    if (!g) {
      g = { step, title: STEP_TITLES[step], partIds: [], phaseIndex: BUILD_PHASES.length };
      groups.set(step, g);
    }
    g.partIds.push(part.id);
    g.phaseIndex = Math.min(g.phaseIndex, BUILD_PHASES.indexOf(part.buildStep.phase));
  }
  const list = [...groups.values()];
  for (const g of list) g.partIds.sort();
  return list.sort((a, b) => a.phaseIndex - b.phaseIndex || STEP_KEYS.indexOf(a.step) - STEP_KEYS.indexOf(b.step));
}

/**
 * The step a joint's hardware is bought for: the later of its two parts' steps (a
 * hurricane tie between a rafter and a wall plate goes with the roof). `GROUND` takes the
 * other part's step. Null when neither end is a built part.
 */
export function stepOfJoint(project: Project, joint: Joint, order: readonly StepKey[], catalog?: Catalog | CatalogIndex): StepKey | null {
  let best: StepKey | null = null;
  for (const id of joint.partIds) {
    if (id === GROUND) continue;
    const part = project.parts[id];
    if (!part || !isBuiltPart(part, catalog)) continue;
    const step = stepOfPart(project, part);
    if (best === null || order.indexOf(step) > order.indexOf(best)) best = step;
  }
  return best;
}
