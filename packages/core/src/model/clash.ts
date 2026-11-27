/**
 * Clash detection: do new parts run through existing ones? Uses each part's exact shape,
 * cuts included (`geometry/cuts.ts`): a rafter's birdsmouth sits on the plate, a trimmed
 * tie stays under the sheathing. The test is separating-axis on convex pieces with a 1 mm
 * penetration tolerance, so touching faces are fine; uncut pairs keep the oriented-box
 * fast path. Used by the builders, and exported for evals and the future `measure` tool.
 */
import { aabbOf, aabbsOverlap, boxesOverlap, partBox, type Aabb, type OrientedBox, type PartLike } from '../geometry/obb.ts';
import { hasCuts, partSolidAabb, partsOverlap } from '../geometry/cuts.ts';
import { commandError, type CommandError } from '../commands/errors.ts';
import type { Part, PartCuts, Project } from './schema.ts';

export const CLASH_TOLERANCE_MM = 1;

export interface ClashCandidate extends PartLike {
  /** An ID or a label used in messages. */
  id: string;
  /** The part's cuts, if any, so the check sees its real shape. */
  cuts?: PartCuts;
}

export interface Clash {
  newPart: string;
  existingId: string;
}

export interface FindClashesOptions {
  /** Existing part IDs to skip (e.g. ones the same change removes). */
  ignore?: ReadonlySet<string>;
  /** Skip a pair when this returns true. */
  skip?: (candidate: ClashCandidate, existing: Part) => boolean;
  tolMm?: number;
}

interface Boxed<T> {
  item: T;
  box: OrientedBox;
  aabb: Aabb;
  cut: boolean;
}

function boxed<T extends PartLike & { cuts?: PartCuts | undefined }>(item: T): Boxed<T> {
  const box = partBox(item);
  const cut = hasCuts(item);
  // A cut part's AABB comes from its solid, which is tighter than its box's.
  return { item, box, cut, aabb: cut ? partSolidAabb(item) : aabbOf(box) };
}

/** Boxes computed once per part; the exact cut-shape test only when a cut part is involved. */
function overlap<A extends PartLike, B extends PartLike>(a: Boxed<A>, b: Boxed<B>, tol: number): boolean {
  if (!a.cut && !b.cut) return boxesOverlap(a.box, b.box, tol);
  return partsOverlap(a.item, b.item, tol);
}

/** New parts against the project's existing parts (not against each other). */
export function findClashes(
  project: Project,
  candidates: readonly ClashCandidate[],
  opts: FindClashesOptions = {},
): Clash[] {
  const tol = opts.tolMm ?? CLASH_TOLERANCE_MM;
  const existing = Object.values(project.parts)
    .filter((p) => !opts.ignore?.has(p.id))
    .map(boxed);
  const out: Clash[] = [];
  for (const c of candidates.map(boxed)) {
    for (const e of existing) {
      if (!aabbsOverlap(c.aabb, e.aabb, tol)) continue;
      if (opts.skip?.(c.item, e.item)) continue;
      if (overlap(c, e, tol)) out.push({ newPart: c.item.id, existingId: e.item.id });
    }
  }
  return out;
}

/** Every pair of the project's own parts that interpenetrate. */
export function findAllClashes(
  project: Project,
  opts: { skip?: (a: Part, b: Part) => boolean; tolMm?: number } = {},
): Array<[string, string]> {
  const tol = opts.tolMm ?? CLASH_TOLERANCE_MM;
  const all = Object.values(project.parts).map(boxed).sort((a, b) => a.aabb.min.x - b.aabb.min.x);
  const out: Array<[string, string]> = [];
  for (let i = 0; i < all.length; i++) {
    const a = all[i]!;
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j]!;
      if (b.aabb.min.x >= a.aabb.max.x - tol) break;
      if (!aabbsOverlap(a.aabb, b.aabb, tol)) continue;
      if (opts.skip?.(a.item, b.item)) continue;
      if (overlap(a, b, tol)) out.push([a.item.id, b.item.id]);
    }
  }
  return out;
}

/**
 * One plain sentence naming what the new thing would run through, grouped by
 * assembly: `The new wall would run through X1 "Existing house" (X1-X01) and W2
 * "North wall" (W2-S03). Move it, or delete those parts first.`
 */
export function describeClashes(project: Project, clashes: readonly Clash[], what: string): CommandError {
  const byAssembly = new Map<string, string[]>();
  for (const c of clashes) {
    const part = project.parts[c.existingId];
    const key = part?.assemblyId ?? '';
    const list = byAssembly.get(key) ?? [];
    if (!list.includes(c.existingId)) list.push(c.existingId);
    byAssembly.set(key, list);
  }
  const groups = [...byAssembly.entries()].map(([asmId, ids]) => {
    const shown = ids.slice(0, 4).join(', ') + (ids.length > 4 ? ` and ${ids.length - 4} more` : '');
    const asm = project.assemblies[asmId];
    return asm ? `${asm.id} "${asm.name}" (${shown})` : shown;
  });
  const list =
    groups.length === 1 ? groups[0]! : `${groups.slice(0, -1).join(', ')} and ${groups[groups.length - 1]!}`;
  return commandError('conflict', `${what} would run through ${list}.`, {
    hint: 'Move it, or delete those parts first.',
  });
}
