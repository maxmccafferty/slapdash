/**
 * Parts → instanced batches. Every part is a box, so one unit box per material and section
 * draws the whole model in a handful of draw calls.
 *
 * The project is structurally shared: an edit returns a new project that reuses every
 * unchanged `Part` object. `groupParts` keeps that sharing one level up: a batch whose
 * members are all the same objects as last time is returned as the *same* `Batch`, so
 * React skips it and only the edited batch re-renders.
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Part, Project } from '@slapdash/core';
import { isContextPart } from './bounds.ts';
import { MM_PER_M } from './units.ts';

export interface Batch {
  /** `materialId|sectionId` (or `|none`). Stable, so it can be a React key. */
  key: string;
  materialId: string;
  sectionId: string | null;
  /** Members, sorted by id, so the instance order is stable across edits. */
  parts: readonly Part[];
}

export function batchKey(part: Part): string {
  return `${part.materialId}|${part.sectionId ?? 'none'}`;
}

const byId = (a: Part, b: Part) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function sameMembers(a: readonly Part[], b: readonly Part[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Bucket the solid (non-stippled) parts by material and section. Pass the previous result
 * to reuse unchanged batches by reference. Batches are sorted by key.
 */
export function groupParts(project: Project, previous: readonly Batch[] = []): Batch[] {
  const buckets = new Map<string, Part[]>();
  for (const part of Object.values(project.parts)) {
    if (isContextPart(part)) continue;
    const key = batchKey(part);
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(part);
  }
  const prev = new Map(previous.map((b) => [b.key, b]));
  const keys = [...buckets.keys()].sort();
  return keys.map((key) => {
    const parts = buckets.get(key)!.sort(byId);
    const old = prev.get(key);
    if (old && sameMembers(old.parts, parts)) return old;
    const first = parts[0]!;
    return { key, materialId: first.materialId, sectionId: first.sectionId ?? null, parts };
  });
}

const DEG = Math.PI / 180;
const tmpEuler = new Euler();
const tmpQuat = new Quaternion();
const tmpPos = new Vector3();
const tmpScale = new Vector3();

/**
 * The instance matrix for a part on a unit box whose corner is at the origin (0..1 on each
 * axis): T(position) · R(Euler XYZ) · S(length, width, height), in metres. Euler order XYZ
 * matches the core's `rotationAxes` (intrinsic X, then Y, then Z).
 */
export function partMatrix(part: Part, target = new Matrix4(), liftM = 0): Matrix4 {
  tmpPos.set(part.position.x / MM_PER_M, part.position.y / MM_PER_M + liftM, part.position.z / MM_PER_M);
  tmpEuler.set(part.rotation.x * DEG, part.rotation.y * DEG, part.rotation.z * DEG, 'XYZ');
  tmpQuat.setFromEuler(tmpEuler);
  // A zero-size part would make a singular matrix; keep it a sliver instead.
  tmpScale.set(
    Math.max(part.size.length, 0.01) / MM_PER_M,
    Math.max(part.size.width, 0.01) / MM_PER_M,
    Math.max(part.size.height, 0.01) / MM_PER_M,
  );
  return target.compose(tmpPos, tmpQuat, tmpScale);
}

/** A stable hash of a part id in [0, 1), for per-board variation. */
export function idHash(id: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Per-board variation: a texture offset seed (0..1) and a tint in −4%..+4%. */
export function partVariation(id: string): [number, number] {
  return [idHash(id, 1), (idHash(id, 2) - 0.5) * 0.08];
}
