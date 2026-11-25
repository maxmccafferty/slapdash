/**
 * The 2D drawing sheet on screen: drag to move, scroll or pinch to zoom toward the pointer,
 * no zoom control (the readout shows the percentage). Keys: arrows pan, + and − zoom, 0 fits.
 * Fitted when a project is opened or first gets parts; never moved by model edits.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { debugEnabled, exposeDebug } from '../debug.ts';
import { useModelStore } from '../state/model-store.ts';
import { useShellStore } from '../state/shell-store.ts';
import { DrawingSheet } from './DrawingSheet.tsx';
import { fitView, panBy, viewBoxFor, zoomAt, zoomPercentOf, type ViewState, type Viewport } from './pan-zoom.ts';
import { buildSheet } from './sheet.ts';
import { useSheetViewStore } from './sheet-view-store.ts';
import { sheetToSvg } from './svg.ts';
import styles from './SheetView.module.css';

const KEY_PAN_PX = 48;
const KEY_ZOOM = 1.25;
/** Wheel: zoom factor per pixel of scroll; trackpad pinch (ctrl + wheel) sends small deltas. */
const WHEEL_K = 0.0015;
const PINCH_K = 0.01;

export function SheetView() {
  const project = useModelStore((s) => s.project);
  const loadId = useModelStore((s) => s.loadId);
  const floor = useShellStore((s) => s.floor);
  const dimensions = useShellStore((s) => s.dimensions);
  const sheet = useMemo(() => buildSheet(project, { floor, dimensions }), [project, floor, dimensions]);
  const hasParts = !!project && Object.keys(project.parts).length > 0;

  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Viewport | null>(null);
  const state = useSheetViewStore((s) => s.state);
  const fit = useSheetViewStore((s) => s.fit);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize((s) => (s && s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit on first show, when a project is opened and when it first gets parts; otherwise keep the view
  // and only update the 100% reference for the viewport.
  useLayoutEffect(() => {
    if (!size) return;
    const store = useSheetViewStore.getState();
    const key = `${loadId}:${hasParts}`;
    const fitted = fitView(sheet.viewBox, size);
    if (!store.state || store.fittedFor !== key) {
      store.setFit(fitted, key);
      store.set(fitted);
    } else if (!store.fit || store.fit.scale !== fitted.scale) {
      store.setFit(fitted);
    }
    // The sheet changes with Floors and Dimensions; that alone doesn't refit.
  }, [size, loadId, hasParts]);

  // The readout.
  useEffect(() => {
    if (state && fit) {
      const pct = zoomPercentOf(state, fit);
      if (useShellStore.getState().zoomPercent !== pct) useShellStore.getState().setZoomPercent(pct);
    }
  }, [state, fit]);

  const update = useCallback((f: (s: ViewState, fit: ViewState, size: Viewport) => ViewState) => {
    const { state: s, fit: fs, set } = useSheetViewStore.getState();
    const el = ref.current;
    if (!s || !fs || !el) return;
    const r = el.getBoundingClientRect();
    set(f(s, fs, { width: r.width, height: r.height }));
  }, []);

  // Wheel: non-passive, so the page doesn't scroll or zoom.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * r.height : e.deltaY;
      const factor = Math.exp(-dy * (e.ctrlKey ? PINCH_K : WHEEL_K));
      update((s, fs, vp) => zoomAt(s, factor, { x: e.clientX - r.left, y: e.clientY - r.top }, vp, fs.scale));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [update]);

  // One pointer drags; two pinch (zoom about their midpoint) and pan with it.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const map = pointers.current;
    const prev = map.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    if (map.size === 1) {
      map.set(e.pointerId, next);
      update((s) => panBy(s, next.x - prev.x, next.y - prev.y));
      return;
    }
    const [a, b] = [...map.entries()].slice(0, 2);
    if (!a || !b) return;
    const other = a[0] === e.pointerId ? b[1] : a[1];
    if (a[0] !== e.pointerId && b[0] !== e.pointerId) return;
    map.set(e.pointerId, next);
    const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
    const d1 = Math.hypot(next.x - other.x, next.y - other.y);
    const m0 = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
    const m1 = { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 };
    const r = ref.current!.getBoundingClientRect();
    update((s, fs, vp) => {
      const panned = panBy(s, m1.x - m0.x, m1.y - m0.y);
      return d0 > 0 ? zoomAt(panned, d1 / d0, { x: m1.x - r.left, y: m1.y - r.top }, vp, fs.scale) : panned;
    });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const centre = (vp: Viewport) => ({ x: vp.width / 2, y: vp.height / 2 });
    switch (e.key) {
      case 'ArrowLeft':
        update((s) => panBy(s, KEY_PAN_PX, 0));
        break;
      case 'ArrowRight':
        update((s) => panBy(s, -KEY_PAN_PX, 0));
        break;
      case 'ArrowUp':
        update((s) => panBy(s, 0, KEY_PAN_PX));
        break;
      case 'ArrowDown':
        update((s) => panBy(s, 0, -KEY_PAN_PX));
        break;
      case '+':
      case '=':
        update((s, fs, vp) => zoomAt(s, KEY_ZOOM, centre(vp), vp, fs.scale));
        break;
      case '-':
      case '_':
        update((s, fs, vp) => zoomAt(s, 1 / KEY_ZOOM, centre(vp), vp, fs.scale));
        break;
      case '0':
        update((_s, _fs, vp) => fitView(sheet.viewBox, vp));
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // Dev and e2e: read the sheet and the view, and export the SVG.
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  useEffect(() => {
    if (!debugEnabled()) return;
    return exposeDebug({
      sheet: () => sheetRef.current,
      sheetView: () => useSheetViewStore.getState().state,
      sheetSvg: () => sheetToSvg(sheetRef.current),
    });
  }, []);

  const viewBox = state && size ? viewBoxFor(state, size) : undefined;
  return (
    <div
      ref={ref}
      className={styles.sheet}
      role="img"
      aria-label={sheet.description}
      tabIndex={0}
      data-testid="sheet"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <DrawingSheet sheet={sheet} viewBox={viewBox} nonScalingStroke className={styles.svg} />
    </div>
  );
}
