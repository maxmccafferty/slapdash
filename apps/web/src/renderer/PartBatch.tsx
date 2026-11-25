/**
 * One instanced mesh per batch (material × section). Only parts whose object changed get
 * their matrix rewritten: the project is structurally shared, so `prev[i] !== part` is the
 * whole diff. Hidden parts are not in `parts` at all (compacted), so the instance count is
 * right and a raycast can never hit a hidden part.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { BoxGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4 } from 'three';
import type { CatalogIndex, Part } from '@slapdash/core';
import { partMatrix, partVariation, type Batch } from './batches.ts';
import type { CutUniforms } from './CutFaces.ts';
import { getPartMaterials } from './materials.ts';
import type { QualityTier } from './quality.ts';
import type { RenderableMode } from './snapshot/types.ts';

export const DROP_MS = 250;
export const DROP_HEIGHT_M = 0.3;

export interface PartBatchProps {
  batch: Batch;
  /** The batch's visible members, in batch order. */
  parts: readonly Part[];
  isCuttable: (part: Part) => boolean;
  mode: RenderableMode;
  tier: QualityTier;
  cut: CutUniforms;
  catalog: CatalogIndex | null;
  /** Parts added from now on drop in (someone is building, and motion is allowed). */
  animateNew: boolean;
}

const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(n, 1)));

/** The unit box with its corner at the origin, plus per-instance attributes. */
function makeGeometry(capacity: number): BoxGeometry {
  const g = new BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
  g.setAttribute('aVariation', new InstancedBufferAttribute(new Float32Array(capacity * 2), 2));
  g.setAttribute('aCuttable', new InstancedBufferAttribute(new Float32Array(capacity), 1));
  return g;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

export const PartBatch = memo(function PartBatch({ batch, parts, isCuttable, mode, tier, cut, catalog, animateNew }: PartBatchProps) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const capacity = nextPow2(batch.parts.length);
  const geometry = useMemo(() => makeGeometry(capacity), [capacity]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const mats = getPartMaterials({ materialId: batch.materialId, mode, tier, cut, catalog, gl, onLoad: invalidate });
  const mesh = useMemo(() => {
    const m = new InstancedMesh(geometry, mats.material, capacity);
    m.count = 0;
    m.frustumCulled = true;
    m.castShadow = mode === 'textured' && !mats.transparent;
    m.receiveShadow = mode === 'textured';
    m.renderOrder = mats.transparent ? 1 : 0;
    m.name = `batch:${batch.key}`;
    return m;
  }, [geometry, mats, capacity, mode, batch.key]);
  mesh.customDepthMaterial = mats.depthMaterial;

  // What each slot holds now, to diff against.
  const slots = useRef<{ mesh: InstancedMesh | null; parts: (Part | undefined)[]; cuttable: typeof isCuttable | null }>({
    mesh: null,
    parts: [],
    cuttable: null,
  });
  const seen = useRef<Set<string> | null>(null);
  const drops = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    // New members (not seen before in this batch) drop in when someone is building.
    const known = seen.current;
    if (known) {
      for (const p of batch.parts) if (!known.has(p.id) && animateNew) drops.current.set(p.id, -1);
    } else if (animateNew) {
      for (const p of batch.parts) drops.current.set(p.id, -1);
    }
    seen.current = new Set(batch.parts.map((p) => p.id));
  }, [batch, animateNew]);

  useLayoutEffect(() => {
    const s = slots.current;
    const force = s.mesh !== mesh || s.cuttable !== isCuttable;
    const variation = geometry.getAttribute('aVariation') as InstancedBufferAttribute;
    const cuttable = geometry.getAttribute('aCuttable') as InstancedBufferAttribute;
    const m = new Matrix4();
    let changed = force || parts.length !== mesh.count;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (!force && s.parts[i] === part) continue;
      mesh.setMatrixAt(i, partMatrix(part, m, drops.current.has(part.id) ? DROP_HEIGHT_M : 0));
      const [seed, tint] = partVariation(part.id);
      variation.setXY(i, seed, tint);
      cuttable.setX(i, isCuttable(part) ? 1 : 0);
      changed = true;
    }
    mesh.count = parts.length;
    mesh.userData.partIds = parts.map((p) => p.id);
    mesh.userData.cuttable = parts.map((p) => isCuttable(p));
    if (changed) {
      mesh.instanceMatrix.needsUpdate = true;
      variation.needsUpdate = true;
      cuttable.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      invalidate();
    }
    slots.current = { mesh, parts: [...parts], cuttable: isCuttable };
  }, [mesh, parts, isCuttable, geometry, invalidate]);

  useFrame((state) => {
    if (drops.current.size === 0) return;
    const now = state.clock.elapsedTime * 1000;
    const ids = mesh.userData.partIds as string[];
    const m = new Matrix4();
    for (const [id, start] of drops.current) {
      const begin = start < 0 ? now : start;
      if (start < 0) drops.current.set(id, now);
      const t = Math.min(1, (now - begin) / DROP_MS);
      const i = ids.indexOf(id);
      const part = slots.current.parts[i];
      if (part) mesh.setMatrixAt(i, partMatrix(part, m, DROP_HEIGHT_M * (1 - easeOut(t))));
      if (t >= 1) drops.current.delete(id);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (drops.current.size === 0) mesh.computeBoundingSphere();
    state.invalidate();
  });

  return <primitive object={mesh} />;
});
