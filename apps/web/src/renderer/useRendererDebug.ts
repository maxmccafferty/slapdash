/**
 * Dev and e2e only (`import.meta.env.DEV` or `?e2e`): `window.__slapdash`, so tests and
 * device checks can drive the renderer: take snapshots, read the camera, select a part,
 * run commands and read frame and batch statistics.
 */
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { Matrix4, Vector3, type InstancedMesh } from 'three';
import { useModelStore } from '../state/model-store.ts';
import { frameStats, useRendererStore } from './renderer-store.ts';
import { renderSnapshot } from './snapshot/registry.ts';

export function debugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e');
}

export function useRendererDebug(): void {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (!debugEnabled()) return;
    const api = {
      renderSnapshot,
      camera: () => useRendererStore.getState().readCamera(),
      select: (id: string | null) => useModelStore.getState().select(id),
      selection: () => ({ id: useModelStore.getState().selectedPartId, label: useModelStore.getState().selectedPartLabel }),
      get bus() {
        return useModelStore.getState().bus;
      },
      frameStats: () => ({ ...frameStats, tier: useRendererStore.getState().tier }),
      /** Visible instance count per batch key (`materialId|sectionId`). */
      batches: () => {
        const out: Record<string, number> = {};
        const parts = get().scene.getObjectByName('parts');
        for (const child of parts?.children ?? []) {
          const mesh = child as InstancedMesh;
          if (mesh.isInstancedMesh) out[mesh.name.replace(/^batch:/, '')] = mesh.count;
        }
        return out;
      },
      /** Visible instance count per assembly kind. */
      kinds: () => {
        const { project } = useModelStore.getState();
        const out: Record<string, number> = {};
        const parts = get().scene.getObjectByName('parts');
        for (const child of parts?.children ?? []) {
          for (const id of (child.userData.partIds as string[] | undefined) ?? []) {
            const kind = project?.assemblies[project.parts[id]?.assemblyId ?? '']?.kind ?? 'unknown';
            out[kind] = (out[kind] ?? 0) + 1;
          }
        }
        return out;
      },
      /** Where a part's centre is on screen (CSS px relative to the canvas), for tap tests. */
      screenPointOf: (partId: string) => {
        const { camera, size } = get();
        const part = useModelStore.getState().project?.parts[partId];
        if (!part) return null;
        const parts = get().scene.getObjectByName('parts');
        for (const child of parts?.children ?? []) {
          const i = ((child.userData.partIds as string[] | undefined) ?? []).indexOf(partId);
          if (i < 0) continue;
          const mesh = child as InstancedMesh;
          const m = new Matrix4();
          mesh.getMatrixAt(i, m);
          const v = new Vector3(0.5, 0.5, 0.5).applyMatrix4(m).project(camera);
          return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
        }
        return null;
      },
    };
    (window as unknown as { __slapdash?: unknown }).__slapdash = api;
    return () => {
      delete (window as unknown as { __slapdash?: unknown }).__slapdash;
    };
  }, [get]);
}
