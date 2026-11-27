/**
 * One instanced mesh per batch (material × section, and cut shape for cut parts). A box
 * batch draws a unit box; a cut batch draws its cut solid normalised to the unit box
 * (`cutGeometry.ts`), so both use the same instance matrices, attributes and materials. Only parts whose object changed get
 * their matrix rewritten: the project is structurally shared, so `prev[i] !== part` is the
 * whole diff. Hidden parts are not in `parts` at all (compacted), so the instance count is
 * right and a raycast can never hit a hidden part.
 *
 * In stress mode each instance also gets a fill colour (`instanceColor`) and a hatch flag
 * (`aHatch`) from the band map. They are rewritten whenever the map changes, not only when
 * parts do: a new analysis recolours the same parts.
 *
 * New parts fall into place and fade in (`entrances.ts`). That runs in `useFrame`, writing
 * the entering instances' matrices and `aEnter` straight into the buffers: no React render
 * per frame. A part that hasn't started yet gets a zero-size matrix, so it can't be picked
 * while it isn't drawn; one mid-fall is picked where it is drawn.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Color, InstancedBufferAttribute, InstancedMesh, Matrix4 } from 'three';
import type { CatalogIndex, Part } from '@slapdash/core';
import { partMatrix, partVariation, type Batch } from './batches.ts';
import type { CutUniforms } from './CutFaces.ts';
import { makeCutGeometry, releaseCutGeometry, unitBoxGeometry } from './cutGeometry.ts';
import { DROP_HEIGHT_M, entranceFrame, type EntranceSchedule } from './entrances.ts';
import { getPartMaterials, holdTransparent, type PartMaterials } from './materials.ts';
import type { QualityTier } from './quality.ts';
import type { SceneMode } from './snapshot/types.ts';
import type { StressBand } from '../analysis/stress.ts';
import { SCENE_COLORS } from '../styles/tokens.ts';

export interface PartBatchProps {
  batch: Batch;
  /** The batch's visible members, in batch order. */
  parts: readonly Part[];
  isCuttable: (part: Part) => boolean;
  mode: SceneMode;
  /** Stress mode: each part's band. Parts missing from it draw as not checked. */
  stress?: ReadonlyMap<string, StressBand>;
  tier: QualityTier;
  cut: CutUniforms;
  catalog: CatalogIndex | null;
  /** The user's view: new parts fall and fade in. Snapshots pass none. */
  entrances?: EntranceSchedule | null;
}

const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(n, 1)));

/** The fill for each stress band (tokens stress-1…5; over is ink, hatched with paper). */
export const STRESS_FILL: Record<StressBand, string> = {
  0: SCENE_COLORS.stress1,
  1: SCENE_COLORS.stress2,
  2: SCENE_COLORS.stress3,
  3: SCENE_COLORS.stress4,
  4: SCENE_COLORS.stress5,
  over: SCENE_COLORS.ink,
  unchecked: SCENE_COLORS.paper,
};

const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/** Grow `mesh`'s bounds to also cover every instance raised by `lift` metres. */
function liftBounds(mesh: InstancedMesh, lift: number): void {
  if (!mesh.boundingSphere) mesh.computeBoundingSphere();
  if (!mesh.boundingBox) mesh.computeBoundingBox();
  const sphere = mesh.boundingSphere!;
  sphere.center.y += lift / 2;
  sphere.radius += lift / 2;
  mesh.boundingBox!.max.y += lift;
}

export const PartBatch = memo(function PartBatch({ batch, parts, isCuttable, mode, stress, tier, cut, catalog, entrances = null }: PartBatchProps) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const capacity = nextPow2(batch.parts.length);
  const cutShape = batch.cutShape;
  const geometry = useMemo(() => (cutShape ? makeCutGeometry(cutShape, capacity) : unitBoxGeometry(capacity)), [cutShape, capacity]);
  useEffect(() => () => (cutShape ? releaseCutGeometry(geometry) : geometry.dispose()), [geometry, cutShape]);
  const mats = getPartMaterials({ materialId: batch.materialId, look: batch.look, mode, tier, cut, catalog, gl, onLoad: invalidate });
  const mesh = useMemo(() => {
    const m = new InstancedMesh(geometry, mats.material, capacity);
    m.count = 0;
    m.frustumCulled = true;
    m.castShadow = mode === 'textured' && !mats.transparent;
    m.receiveShadow = mode === 'textured';
    m.renderOrder = mats.transparent ? 1 : 0;
    m.name = `batch:${batch.key}`;
    // The program needs instance colours from the start, so make the buffer now.
    if (mode === 'stress') m.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    return m;
  }, [geometry, mats, capacity, mode, batch.key]);
  mesh.customDepthMaterial = mats.depthMaterial;

  // What each slot holds now, to diff against.
  const slots = useRef<{ mesh: InstancedMesh | null; parts: (Part | undefined)[]; cuttable: typeof isCuttable | null }>({
    mesh: null,
    parts: [],
    cuttable: null,
  });
  /** Slot of each visible part, for the entrance frames. */
  const index = useRef(new Map<string, number>());
  /** Parts of this batch drawn mid-entrance, to settle when their entrance ends. */
  const entering = useRef(new Set<string>());
  /** The materials this batch holds transparent while parts enter. */
  const held = useRef<PartMaterials | null>(null);
  /** Whether the current bounds already include the drop (see `liftBounds`). */
  const liftedBounds = useRef(false);
  useEffect(
    () => () => {
      if (held.current) holdTransparent(held.current, false);
      held.current = null;
    },
    [mats],
  );

  useLayoutEffect(() => {
    const s = slots.current;
    const force = s.mesh !== mesh || s.cuttable !== isCuttable;
    const variation = geometry.getAttribute('aVariation') as InstancedBufferAttribute;
    const cuttable = geometry.getAttribute('aCuttable') as InstancedBufferAttribute;
    const enter = geometry.getAttribute('aEnter') as InstancedBufferAttribute;
    const m = new Matrix4();
    let changed = force || parts.length !== mesh.count;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (!force && s.parts[i] === part) continue;
      // Settled here; an entering part is moved and faded on the next frame (before it draws).
      mesh.setMatrixAt(i, partMatrix(part, m));
      const [seed, tint] = partVariation(part.id);
      variation.setXY(i, seed, tint);
      cuttable.setX(i, isCuttable(part) ? 1 : 0);
      enter.setX(i, 0);
      changed = true;
    }
    mesh.count = parts.length;
    mesh.userData.partIds = parts.map((p) => p.id);
    mesh.userData.cuttable = parts.map((p) => isCuttable(p));
    index.current = new Map(parts.map((p, i) => [p.id, i]));
    if (changed) {
      mesh.instanceMatrix.needsUpdate = true;
      variation.needsUpdate = true;
      cuttable.needsUpdate = true;
      enter.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      liftedBounds.current = false;
      invalidate();
    }
    slots.current = { mesh, parts: [...parts], cuttable: isCuttable };
  }, [mesh, parts, isCuttable, geometry, invalidate]);

  // Stress fills: rewritten when the bands change, not only when parts do.
  useLayoutEffect(() => {
    if (mode !== 'stress' || !mesh.instanceColor) return;
    const hatch = geometry.getAttribute('aHatch') as InstancedBufferAttribute;
    const c = new Color();
    for (let i = 0; i < parts.length; i++) {
      const band = stress?.get(parts[i]!.id) ?? 'unchecked';
      mesh.setColorAt(i, c.set(STRESS_FILL[band]));
      hatch.setX(i, band === 'over' ? 1 : 0);
    }
    mesh.instanceColor.needsUpdate = true;
    hatch.needsUpdate = true;
    invalidate();
  }, [mode, mesh, parts, stress, geometry, invalidate]);

  useFrame((state) => {
    if (!entrances || (entrances.size === 0 && entering.current.size === 0)) return;
    const now = performance.now();
    const active = entrances.active(now);
    const enter = geometry.getAttribute('aEnter') as InstancedBufferAttribute;
    const placed = slots.current.parts;
    const m = new Matrix4();
    let touched = false;
    for (const [id, e] of active) {
      const i = index.current.get(id);
      const part = i === undefined ? undefined : placed[i];
      if (i === undefined || !part) continue;
      const f = entranceFrame(e, now);
      mesh.setMatrixAt(i, f.started ? partMatrix(part, m, f.lift) : HIDDEN);
      enter.setX(i, 1 - f.opacity);
      entering.current.add(id);
      touched = true;
    }
    // Entrances that ended (or were dropped) since the last frame: put those parts in place.
    let busy = false;
    for (const id of entering.current) {
      if (active.has(id)) {
        busy = true;
        continue;
      }
      entering.current.delete(id);
      const i = index.current.get(id);
      const part = i === undefined ? undefined : placed[i];
      if (i !== undefined && part) {
        mesh.setMatrixAt(i, partMatrix(part, m));
        enter.setX(i, 0);
        touched = true;
      }
    }
    if (touched) {
      mesh.instanceMatrix.needsUpdate = true;
      enter.needsUpdate = true;
    }
    if (busy !== (held.current !== null)) {
      holdTransparent(mats, busy);
      held.current = busy ? mats : null;
    }
    // While parts fall, stretch the settled bounds up by the drop, so a part high in its
    // fall is neither frustum-culled nor skipped by a raycast's bounding-sphere test.
    if (busy && !liftedBounds.current) {
      liftBounds(mesh, DROP_HEIGHT_M);
      liftedBounds.current = true;
    }
    // Bounds come from the settled matrices; refresh them once everything has landed.
    if (touched && !busy) {
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      liftedBounds.current = false;
    }
    if (touched || busy) state.invalidate();
  });

  return <primitive object={mesh} />;
});
