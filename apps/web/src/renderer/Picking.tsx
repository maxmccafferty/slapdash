/**
 * Pointing at a part: tap (or click without dragging) selects, drag orbits, pinch zooms.
 * Gestures are tracked on the canvas element itself, so the rule is the same for mouse and
 * touch (see `isTap`). A tap on empty space clears the selection. Escape clears it too.
 */
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { Vector2, type Intersection, type Object3D } from 'three';
import { useModelStore } from '../state/model-store.ts';
import { isTap } from './picking.ts';

/** The part id under a canvas point (CSS px relative to the canvas), or null. */
export type PickFn = (x: number, y: number) => string | null;

export function Picking({ enabled, cutY }: { enabled: boolean; cutY: number | null }) {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const select = useModelStore((s) => s.select);

  useEffect(() => {
    const el = gl.domElement;
    const ndc = new Vector2();

    const pick: PickFn = (x, y) => {
      const { camera, raycaster, scene, size } = get();
      const parts = scene.getObjectByName('parts');
      if (!parts || size.width === 0) return null;
      ndc.set((x / size.width) * 2 - 1, -(y / size.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits: Intersection<Object3D>[] = raycaster.intersectObjects(parts.children, false);
      for (const hit of hits) {
        const ids = hit.object.userData.partIds as string[] | undefined;
        if (!ids || hit.instanceId === undefined) continue;
        // The Inside cut hides cuttable parts above it; don't pick what isn't drawn.
        const cuttable = (hit.object.userData.cuttable as boolean[] | undefined)?.[hit.instanceId];
        if (cutY !== null && cuttable && hit.point.y > cutY) continue;
        return ids[hit.instanceId] ?? null;
      }
      return null;
    };

    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: { downAt: number; x: number; y: number; moved: number; maxPointers: number } | null = null;

    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) {
        gesture = null;
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        const p = local(e);
        gesture = { downAt: performance.now(), x: p.x, y: p.y, moved: 0, maxPointers: 1 };
      } else if (gesture) {
        gesture.maxPointers = Math.max(gesture.maxPointers, pointers.size);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (gesture && pointers.has(e.pointerId)) {
        const p = local(e);
        gesture.moved = Math.max(gesture.moved, Math.hypot(p.x - gesture.x, p.y - gesture.y));
      }
      if (e.pointerType === 'mouse' && pointers.size === 0 && enabled) {
        const p = local(e);
        el.style.cursor = pick(p.x, p.y) ? 'pointer' : '';
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (pointers.size > 0 || !gesture) return;
      const g = gesture;
      gesture = null;
      if (!enabled) return;
      if (isTap({ downAt: g.downAt, upAt: performance.now(), moved_px: g.moved, maxPointers: g.maxPointers })) {
        select(pick(g.x, g.y));
      }
    };
    const onCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) gesture = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && useModelStore.getState().selectedPartId) select(null);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      el.style.cursor = '';
    };
  }, [gl, get, select, enabled, cutY]);

  return null;
}
