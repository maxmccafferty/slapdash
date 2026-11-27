/**
 * Bounds the renderer derives from the model, in mm. Memoised per project object: the
 * project is immutable, so a new object is the only change signal.
 */
import { MM_PER_FOOT, aabbOf, hasCuts, partBox, partSolidAabb, type Aabb, type Part, type Project } from '@slapdash/core';

/** Site-context parts (place_structure) are drawn stippled and are not "the build". */
export function isContextPart(part: Part): boolean {
  return part.tags.includes('stippled') || part.tags.includes('site-context');
}

/** The part's world AABB, mm. A cut part's comes from its solid, so cut-away box corners don't count. */
export function partAabb(part: Part): Aabb {
  return hasCuts(part) ? partSolidAabb(part) : aabbOf(partBox(part));
}

export function unionAabb(boxes: Iterable<Aabb>): Aabb | null {
  let out: Aabb | null = null;
  for (const b of boxes) {
    if (!out) {
      out = { min: { ...b.min }, max: { ...b.max } };
      continue;
    }
    out.min.x = Math.min(out.min.x, b.min.x);
    out.min.y = Math.min(out.min.y, b.min.y);
    out.min.z = Math.min(out.min.z, b.min.z);
    out.max.x = Math.max(out.max.x, b.max.x);
    out.max.y = Math.max(out.max.y, b.max.y);
    out.max.z = Math.max(out.max.z, b.max.z);
  }
  return out;
}

const modelBoundsCache = new WeakMap<Project, Aabb | null>();

/** The AABB of every non-context part, or null for an empty build. */
export function modelBounds(project: Project): Aabb | null {
  if (modelBoundsCache.has(project)) return modelBoundsCache.get(project)!;
  const box = unionAabb(
    Object.values(project.parts)
      .filter((p) => !isContextPart(p))
      .map(partAabb),
  );
  modelBoundsCache.set(project, box);
  return box;
}

/** Margin around the build on the floor. */
export const FLOOR_MARGIN_MM = 10 * MM_PER_FOOT;
/** The smallest floor, so an empty project still has a sensible place to build. */
export const FLOOR_MIN_MM = { x: 40 * MM_PER_FOOT, z: 30 * MM_PER_FOOT };

export interface FloorBounds {
  /** x/z extents in mm, snapped to whole feet. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const floorCache = new WeakMap<Project, FloorBounds>();

/**
 * The bounded floor: the build's footprint plus a 10 ft margin, at least 40 × 30 ft, snapped
 * outward to whole feet. An empty project gets 40 × 30 ft centred on the origin.
 */
export function floorBounds(project: Project): FloorBounds {
  const cached = floorCache.get(project);
  if (cached) return cached;
  const box = modelBounds(project);
  const cx = box ? (box.min.x + box.max.x) / 2 : 0;
  const cz = box ? (box.min.z + box.max.z) / 2 : 0;
  const halfX = Math.max(box ? (box.max.x - box.min.x) / 2 + FLOOR_MARGIN_MM : 0, FLOOR_MIN_MM.x / 2);
  const halfZ = Math.max(box ? (box.max.z - box.min.z) / 2 + FLOOR_MARGIN_MM : 0, FLOOR_MIN_MM.z / 2);
  const down = (v: number) => Math.floor(v / MM_PER_FOOT) * MM_PER_FOOT;
  const up = (v: number) => Math.ceil(v / MM_PER_FOOT) * MM_PER_FOOT;
  const out = { minX: down(cx - halfX), maxX: up(cx + halfX), minZ: down(cz - halfZ), maxZ: up(cz + halfZ) };
  floorCache.set(project, out);
  return out;
}

/**
 * What the camera frames: the build, or the floor when there is no build yet. Always has
 * some height so a slab-only project isn't framed as a flat sheet, and starts at the
 * ground, because what is under the floor (footings) can't be seen. With `extra`, the box
 * also takes in those plan points (mm), e.g. the compass.
 */
export function framingBounds(project: Project, extra: readonly { x: number; z: number }[] = []): Aabb {
  const box = modelBounds(project);
  if (box) {
    const out = { min: { ...box.min, y: 0 }, max: { ...box.max, y: Math.max(box.max.y, 2 * MM_PER_FOOT) } };
    for (const p of extra) {
      out.min.x = Math.min(out.min.x, p.x);
      out.max.x = Math.max(out.max.x, p.x);
      out.min.z = Math.min(out.min.z, p.z);
      out.max.z = Math.max(out.max.z, p.z);
    }
    return out;
  }
  const f = floorBounds(project);
  return { min: { x: f.minX, y: 0, z: f.minZ }, max: { x: f.maxX, y: 8 * MM_PER_FOOT, z: f.maxZ } };
}
