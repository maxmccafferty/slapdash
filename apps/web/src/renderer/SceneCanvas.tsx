/**
 * The 3D view (lazy-loaded, its own chunk): one `<Canvas>` that renders on demand (the
 * biggest battery and heat win on phones), with the user's scene, the controls, picking,
 * quality management, post effects and the offscreen snapshot host.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { ACESFilmicToneMapping } from 'three';
import { useMediaQuery } from '../hooks/useMediaQuery.ts';
import { useModelStore } from '../state/model-store.ts';
import { useShellStore } from '../state/shell-store.ts';
import { SCENE_COLORS } from '../styles/tokens.ts';
import { createCutUniforms } from './CutFaces.ts';
import { Effects } from './Effects.tsx';
import { EntranceSchedule } from './entrances.ts';
import { scaleScreenSprites } from './labels.ts';
import { Picking } from './Picking.tsx';
import { QualityManager } from './QualityManager.tsx';
import { TIER_SETTINGS } from './quality.ts';
import { useRendererStore } from './renderer-store.ts';
import { SceneContent, type ViewSpec } from './SceneContent.tsx';
import { SnapshotHost } from './snapshot/SnapshotHost.tsx';
import { useRendererDebug } from './useRendererDebug.ts';
import { useStepFilter } from '../steps/useBuildSteps.ts';
import { cutPlaneFor, isPartVisible } from './visibility.ts';
import { useStressStore } from '../analysis/stress-store.ts';
import { stressSpec } from './stress-spec.ts';
import { REDUCED_MOTION_QUERY, ViewControls3D } from './ViewControls3D.tsx';

/** Labels keep their pixel size as the camera moves. */
function LabelScaler() {
  useFrame((state) => scaleScreenSprites(state.scene, state.camera, state.size.height), -1);
  return null;
}

/** Redraw when the model or the view controls change (the canvas renders on demand). */
function Invalidator() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const a = useModelStore.subscribe(() => invalidate());
    const b = useShellStore.subscribe(() => invalidate());
    const c = useRendererStore.subscribe(() => invalidate());
    return () => {
      a();
      b();
      c();
    };
  }, [invalidate]);
  return null;
}

function UserScene() {
  const project = useModelStore((s) => s.project);
  const catalog = useModelStore((s) => s.catalog);
  const selected = useModelStore((s) => s.selectedPartId);
  const inProgress = useModelStore((s) => s.inProgress);
  const proposal = useModelStore((s) => s.proposal);
  const lastEvent = useModelStore((s) => s.lastEvent);
  const loadId = useModelStore((s) => s.loadId);
  const floor = useShellStore((s) => s.floor);
  const lookFrom = useShellStore((s) => s.lookFrom);
  const dimensions = useShellStore((s) => s.dimensions);
  const view = useShellStore((s) => s.view);
  const stressOn = useShellStore((s) => s.stress);
  const steps = useStepFilter();
  const stressResult = useStressStore((s) => s.result);
  const tier = useRendererStore((s) => s.tier);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const cut = useMemo(() => createCutUniforms(), []);
  useRendererDebug();

  // New parts fall and fade in. Any bus event (a command, or undo, redo and restore bringing
  // parts back) animates what it added; opening a project and the scene's first render don't.
  // This runs after the batches' layout effects and before the next frame draws them.
  const entrances = useMemo(() => new EntranceSchedule(), []);
  useLayoutEffect(() => {
    if (!project) return;
    entrances.update(project, { loadId, animate: lastEvent !== null && lastEvent !== 'load', reducedMotion, now: performance.now() });
  }, [entrances, project, loadId, lastEvent, reducedMotion]);

  // The pointed-at part reads strongly; parts in progress get the lighter outline.
  const outlined = useMemo(() => (selected ? [selected] : []), [selected]);
  // Stress shows in 3D only, once there is a result (the last one stays while a new one runs).
  const stress = useMemo(
    () =>
      stressOn && view === '3d' && stressResult && project
        ? stressSpec(project, stressResult, (id) => {
            const part = project.parts[id];
            return part ? isPartVisible(part, project.assemblies[part.assemblyId], { floor, lookFrom, steps }) : false;
          })
        : null,
    [stressOn, view, stressResult, project, floor, lookFrom, steps],
  );
  const spec = useMemo<ViewSpec>(
    () => ({ mode: stress ? 'stress' : 'textured', stress, floor, lookFrom, steps, dimensions, outlined, inProgress, proposal }),
    [stress, floor, lookFrom, steps, dimensions, outlined, inProgress, proposal],
  );

  const cutMm = project ? cutPlaneFor(lookFrom, project.levels) : null;
  return (
    <>
      {project && (
        <SceneContent
          project={project}
          catalog={catalog}
          spec={spec}
          cut={cut}
          tier={tier}
          entrances={entrances}
        />
      )}
      <ViewControls3D enabled={view === '3d'} />
      <Picking enabled={view === '3d'} cutY={cutMm === null ? null : cutMm / 1000} />
    </>
  );
}

export default function SceneCanvas() {
  // Antialiasing can't change after the context is made, so it follows the starting tier.
  const startTier = useMemo(() => useRendererStore.getState().tier, []);
  const tier = useRendererStore((s) => s.tier);
  return (
    <Canvas
      frameloop="demand"
      shadows
      dpr={[1, TIER_SETTINGS[startTier].dprMax]}
      gl={{ antialias: startTier !== 'low', preserveDrawingBuffer: false, powerPreference: 'high-performance', toneMapping: ACESFilmicToneMapping }}
      camera={{ fov: 35, near: 0.05, far: 2000, position: [12, 9, 15] }}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={[SCENE_COLORS.paper]} />
      <UserScene />
      <LabelScaler />
      <QualityManager />
      <Invalidator />
      <Effects tier={tier} />
      <SnapshotHost />
    </Canvas>
  );
}
