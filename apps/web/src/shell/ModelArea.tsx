import { lazy, Suspense, useEffect, useState } from 'react';
import type { Project } from '@slapdash/core';
import { SheetView } from '../drawing/SheetView.tsx';
import { frameStats, useRendererStore } from '../renderer/renderer-store.ts';
import { useModelStore } from '../state/model-store.ts';
import { useShellStore } from '../state/shell-store.ts';
import { useStressAnalysis } from '../analysis/useStressAnalysis.ts';
import styles from './ModelArea.module.css';

const LazySceneCanvas = lazy(() => import('../renderer/SceneCanvas.tsx'));

/** False in jsdom and in browsers without WebGL 2: those get the flat CSS floor. */
export function supportsWebGL2(): boolean {
  if (typeof window === 'undefined' || typeof window.WebGL2RenderingContext === 'undefined') return false;
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the canvas shows, for screen readers: "3D model: Pool house, 4 walls, roof. …" */
export function modelDescription(project: Project | null, selectedLabel: string | null): string {
  if (!project) return '3D model.';
  const kinds = Object.values(project.assemblies).reduce<Record<string, number>>((acc, a) => {
    acc[a.kind] = (acc[a.kind] ?? 0) + 1;
    return acc;
  }, {});
  const bits: string[] = [];
  if (kinds.foundation) bits.push(kinds.foundation === 1 ? 'foundation' : plural(kinds.foundation, 'foundation'));
  if (kinds.floor) bits.push(plural(kinds.floor, 'floor'));
  if (kinds.wall) bits.push(plural(kinds.wall, 'wall'));
  if (kinds.opening) bits.push(plural(kinds.opening, 'opening'));
  if (kinds.roof) bits.push(kinds.roof === 1 ? 'roof' : plural(kinds.roof, 'roof'));
  const what = bits.length > 0 ? `${project.name}, ${bits.join(', ')}` : `${project.name}, nothing built yet`;
  const point = selectedLabel ? `Selected: ${selectedLabel}.` : 'Tap a part to point at it.';
  return `3D model: ${what}. ${point}`;
}

/** `?perf`: frames per second and the quality tier, for device testing. */
function PerfReadout() {
  const tier = useRendererStore((s) => s.tier);
  const [text, setText] = useState('');
  useEffect(() => {
    let last = frameStats.frames;
    const id = setInterval(() => {
      const frames = frameStats.frames - last;
      last = frameStats.frames;
      setText(`${frames} fps · ${frameStats.fps ? Math.round(frameStats.fps) : '–'} busy`);
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <p className={styles.perf} data-testid="perf-readout">
      {tier} · {text}
    </p>
  );
}

/** The flat dot-grid floor. Labelled when it stands in for the model; decorative while loading. */
function CssFloor({ label }: { label?: string }) {
  return label ? <div className={styles.floor} role="img" aria-label={label} /> : <div className={styles.floor} aria-hidden="true" />;
}

/**
 * The model: the 3D view where WebGL 2 is available (lazy-loaded, its own chunk), with the
 * flat CSS floor as the loading fallback and the no-WebGL view. In 2D the drawing sheet
 * shows instead; the canvas is hidden but stays mounted, so snapshots keep working. The
 * sheet is plain SVG, so 2D works without WebGL too.
 */
export function ModelArea({ zoomPercent, readout = true }: { zoomPercent: number; readout?: boolean }) {
  const [webgl] = useState(supportsWebGL2);
  const project = useModelStore((s) => s.project);
  const selectedLabel = useModelStore((s) => s.selectedPartLabel);
  const view = useShellStore((s) => s.view);
  const perf = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf');
  // The stress view's analysis runs here, once, whichever shell is showing.
  useStressAnalysis();

  return (
    <div className={styles.area}>
      {webgl ? (
        <div
          className={[styles.canvas, view === '2d' && styles.hidden].filter(Boolean).join(' ')}
          role="img"
          aria-label={modelDescription(project, selectedLabel)}
          data-testid="scene"
        >
          <Suspense fallback={<CssFloor />}>
            <LazySceneCanvas />
          </Suspense>
        </div>
      ) : (
        view === '3d' && <CssFloor label="Build floor. 3D isn't available in this browser." />
      )}
      {view === '2d' && <SheetView />}
      {readout && (
        <p className={styles.readout} data-testid="zoom-readout">
          <span>scroll to zoom</span>
          <span>{zoomPercent}%</span>
        </p>
      )}
      {perf && <PerfReadout />}
    </div>
  );
}
