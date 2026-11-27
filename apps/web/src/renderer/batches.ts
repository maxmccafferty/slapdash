/**
 * Parts → instanced batches. Most parts are boxes, so one unit box per material and section
 * draws them in a handful of draw calls.
 *
 * Parts with cuts (`Part.cuts`: plumb-cut rafters, trimmed ties, bevelled sheathing) go in
 * their own batches, keyed `material|section|cut:<shapeKey>`, one per distinct (size, cuts).
 * A cut batch draws the cut solid's surface mesh normalised to the unit box (vertex = local
 * mm ÷ size, `cutGeometry.ts`), so the instance matrix is still `partMatrix` (T·R·S(size))
 * and nothing downstream changes: grain UVs, stress colours, entrances, shadows, picking.
 * Every common rafter of a roof has the same size and cuts, so they share one batch.
 *
 * The project is structurally shared: an edit returns a new project that reuses every
 * unchanged `Part` object. `groupParts` keeps that sharing one level up: a batch whose
 * members are all the same objects as last time is returned as the *same* `Batch`, so
 * React skips it and only the edited batch re-renders.
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { hasCuts, type Part, type PartCuts, type PartSize, type Project } from '@slapdash/core';
import { isContextPart } from './bounds.ts';
import { MM_PER_M } from './units.ts';

/** The shape every member of a cut batch shares. */
export interface CutShape {
  key: string;
  size: PartSize;
  cuts: PartCuts;
}

export interface Batch {
  /** `materialId|sectionId` (or `|none`), plus `|cut:<shapeKey>` for cut parts. Stable, so it can be a React key. */
  key: string;
  materialId: string;
  sectionId: string | null;
  /** Cut batches: the shared size and cuts (drawn with a unit-normalised cut mesh). Null for boxes. */
  cutShape: CutShape | null;
  /** Members, sorted by id, so the instance order is stable across edits. */
  parts: readonly Part[];
}

/** Canonical JSON: object keys sorted, numbers rounded to 1e-6, so equal cuts give equal text. */
function canonical(v: unknown): string {
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${k}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

function hash32(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const shapeKeys = new WeakMap<Part, string | null>();

/** A stable key for a cut part's shape: its size (to 0.01 mm) and its cuts. Null for an uncut part. */
export function cutShapeKey(part: Part): string | null {
  if (shapeKeys.has(part)) return shapeKeys.get(part)!;
  let key: string | null = null;
  if (hasCuts(part)) {
    const r = (n: number) => Math.round(n * 100) / 100;
    const text = `${r(part.size.length)}x${r(part.size.width)}x${r(part.size.height)}|${canonical(part.cuts)}`;
    key = `${hash32(text)}${hash32(`#${text}`)}`;
  }
  shapeKeys.set(part, key);
  return key;
}

export function batchKey(part: Part): string {
  const base = `${part.materialId}|${part.sectionId ?? 'none'}`;
  const shape = cutShapeKey(part);
  return shape ? `${base}|cut:${shape}` : base;
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
    const shape = cutShapeKey(first);
    const cutShape = shape && first.cuts ? { key: shape, size: first.size, cuts: first.cuts } : null;
    return { key, materialId: first.materialId, sectionId: first.sectionId ?? null, cutShape, parts };
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
