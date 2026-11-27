/**
 * Instanced geometry for part batches: the unit box (corner at the origin, 0..1 on each
 * axis), or a cut part's exact solid normalised to that same unit box.
 *
 * A cut mesh's vertices are the solid's local mm divided by the part's size, so the batch
 * keeps the box's instance matrix T·R·S(size) and everything that relies on it: the shader's
 * grain UVs (`position * sizeMm`), entrance matrices, shadows and picking (a raycast hits the
 * real cut shape). Normals are computed on the normalised mesh; three's instanced normal
 * transform divides by the squared column lengths, which is the inverse transpose of R·S, so
 * lighting comes out right. The mesh is closed with outward winding, which the inside
 * cutaway's dark back faces rely on.
 *
 * A shape's mesh is built once and cached (refcounted by shape key), so two batches never
 * build the same mesh twice; each batch gets its own geometry over those shared attributes,
 * because the instance attributes (variation, cuttable, hatch, entrance) are per batch.
 */
import { Box3, BoxGeometry, BufferAttribute, BufferGeometry, InstancedBufferAttribute, Vector3 } from 'three';
import { solidSurfaceTriangles } from '@slapdash/core';
import type { CutShape } from './batches.ts';

function addInstanceAttributes<G extends BufferGeometry>(g: G, capacity: number): G {
  g.setAttribute('aVariation', new InstancedBufferAttribute(new Float32Array(capacity * 2), 2));
  g.setAttribute('aCuttable', new InstancedBufferAttribute(new Float32Array(capacity), 1));
  g.setAttribute('aHatch', new InstancedBufferAttribute(new Float32Array(capacity), 1));
  g.setAttribute('aEnter', new InstancedBufferAttribute(new Float32Array(capacity), 1));
  return g;
}

/** The unit box with its corner at the origin, plus per-instance attributes. */
export function unitBoxGeometry(capacity: number): BoxGeometry {
  return addInstanceAttributes(new BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5), capacity);
}

/** The cut solid's surface, normalised to the unit box (non-indexed, flat normals), with no instance attributes. */
export function buildCutMesh(shape: Pick<CutShape, 'size' | 'cuts'>): BufferGeometry {
  const tris = solidSurfaceTriangles(shape.size, shape.cuts);
  const { length, width, height } = shape.size;
  const pos = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    pos[i] = tris[i]! / length;
    pos[i + 1] = tris[i + 1]! / width;
    pos[i + 2] = tris[i + 2]! / height;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  // Planar UVs like the box's, so any material reading `uv` gets something sensible.
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let v = 0; v < pos.length / 3; v++) {
    uv[v * 2] = pos[v * 3]!;
    uv[v * 2 + 1] = pos[v * 3 + 2]!;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

interface CacheEntry {
  mesh: BufferGeometry;
  users: number;
}

/** Shape key → the shared, normalised mesh attributes. */
const cache = new Map<string, CacheEntry>();
/** Each batch geometry → the shape it was made from. */
const owners = new WeakMap<BufferGeometry, string>();

/**
 * A batch geometry for this cut shape: the shape's cached mesh attributes (built once per
 * shape, shared by every batch of it) plus this batch's own instance attributes. Pair with
 * {@link releaseCutGeometry}.
 */
export function makeCutGeometry(shape: CutShape, capacity: number): BufferGeometry {
  let entry = cache.get(shape.key);
  if (!entry) {
    entry = { mesh: buildCutMesh(shape), users: 0 };
    cache.set(shape.key, entry);
  }
  entry.users++;
  const g = new BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) g.setAttribute(name, entry.mesh.getAttribute(name));
  g.boundingBox = new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
  g.computeBoundingSphere();
  owners.set(g, shape.key);
  return addInstanceAttributes(g, capacity);
}

/** Dispose a geometry from {@link makeCutGeometry}; the shape's cached mesh goes with its last user. */
export function releaseCutGeometry(geometry: BufferGeometry): void {
  geometry.dispose();
  const key = owners.get(geometry);
  if (key === undefined) return;
  owners.delete(geometry);
  const entry = cache.get(key);
  if (entry && --entry.users <= 0) cache.delete(key);
}

/** Live cached shapes (for tests). */
export function cutGeometryCacheSize(): number {
  return cache.size;
}

/** The cached mesh for a shape key, if any (for tests). */
export function cachedCutMesh(key: string): BufferGeometry | undefined {
  return cache.get(key)?.mesh;
}
