/**
 * View-only 3D (ADR-0003 §A): orbit, pan, and scroll or pinch zoom toward the pointer.
 * There is no zoom control, only the readout. One finger orbits (a tap points, see
 * Picking), two fingers pinch and pan; right-drag or shift-drag pans with a mouse.
 *
 * The camera is fitted (the build and the compass) from the iso direction when a project is
 * opened or first gets parts, and never moves on model edits after that.
 */
import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useCallback, useEffect, useLayoutEffect, useRef, type ComponentRef } from 'react';
import { TOUCH, type PerspectiveCamera } from 'three';
import { useMediaQuery } from '../hooks/useMediaQuery.ts';
import { useModelStore } from '../state/model-store.ts';
import { useShellStore } from '../state/shell-store.ts';
import { floorBounds, framingBounds } from './bounds.ts';
import { COMPASS_DIAMETER_MM, compassCentreMm } from './Compass.tsx';
import { distanceLimits, fitBounds, presetDirection, zoomPercent } from './camera.ts';
import { useRendererStore } from './renderer-store.ts';
import { aabbToM } from './units.ts';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const MAX_POLAR = (88 * Math.PI) / 180;

export function ViewControls3D({ enabled }: { enabled: boolean }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const project = useModelStore((s) => s.project);
  const loadId = useModelStore((s) => s.loadId);
  const hasParts = !!project && Object.keys(project.parts).length > 0;
  const setZoomPercent = useShellStore((s) => s.setZoomPercent);
  const fitDistance = useRendererStore((s) => s.fitDistance);
  const setFitDistance = useRendererStore((s) => s.setFitDistance);
  const setReadCamera = useRendererStore((s) => s.setReadCamera);

  // Fit when a project is opened (loadId) and when it first gets parts. Not on later edits.
  const fittedFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const c = controls.current;
    if (!project || !c) return;
    const key = `${loadId}:${hasParts}`;
    if (fittedFor.current === key) return;
    fittedFor.current = key;
    const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : 1.5;
    // Frame the build and the compass's far edge, so the compass is in the first view.
    const compass = compassCentreMm(floorBounds(project));
    const r = COMPASS_DIAMETER_MM / 2;
    const box = framingBounds(project, [{ x: compass.x + r, z: compass.z + r }]);
    const fit = fitBounds(aabbToM(box), presetDirection('iso'), camera.fov, aspect);
    camera.position.set(fit.position.x, fit.position.y, fit.position.z);
    c.target.set(fit.target.x, fit.target.y, fit.target.z);
    const limits = distanceLimits(fit.distance);
    c.minDistance = limits.min;
    c.maxDistance = limits.max;
    camera.far = Math.max(2000, limits.max * 4);
    camera.updateProjectionMatrix();
    c.update();
    setFitDistance(fit.distance);
    invalidate();
    // Depends on the project only through loadId and hasParts, on purpose.
  }, [loadId, hasParts, camera, setFitDistance, invalidate]);

  useLayoutEffect(() => {
    setReadCamera(() => {
      const c = controls.current;
      if (!c) return null;
      const p = camera.position;
      return { position: { x: p.x, y: p.y, z: p.z }, target: { x: c.target.x, y: c.target.y, z: c.target.z } };
    });
  }, [camera, setReadCamera]);

  const onChange = useCallback(() => {
    const c = controls.current;
    if (!c || !(fitDistance > 0)) return;
    const pct = zoomPercent(camera.position.distanceTo(c.target), fitDistance);
    if (useShellStore.getState().zoomPercent !== pct) setZoomPercent(pct);
  }, [camera, fitDistance, setZoomPercent]);

  // Back from 2D: the readout shows the 3D zoom again, not the sheet's.
  useEffect(() => {
    if (enabled) onChange();
  }, [enabled, onChange]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={enabled}
      zoomToCursor
      enableDamping={!reducedMotion}
      dampingFactor={0.12}
      maxPolarAngle={MAX_POLAR}
      touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
      onChange={onChange}
    />
  );
}
