/**
 * Pan and zoom for the sheet, as pure maths. The view is the sheet point at the viewport's
 * centre (`cx`, `cy`, sheet mm) and the scale (CSS px per mm). 100% is the fitted scale.
 */
import type { Box2 } from './geometry.ts';

export interface ViewState {
  cx: number;
  cy: number;
  scale: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;

export function fitView(sheet: Box2, viewport: Viewport): ViewState {
  const w = Math.max(1, sheet.maxX - sheet.minX);
  const h = Math.max(1, sheet.maxY - sheet.minY);
  const scale = Math.min(viewport.width / w, viewport.height / h);
  return { cx: (sheet.minX + sheet.maxX) / 2, cy: (sheet.minY + sheet.maxY) / 2, scale: scale > 0 ? scale : 1 };
}

export function clampScale(scale: number, fitScale: number): number {
  return Math.min(fitScale * MAX_ZOOM, Math.max(fitScale * MIN_ZOOM, scale));
}

/** Zoom by `factor` about a point (CSS px from the viewport's top left), keeping the sheet point under it fixed. */
export function zoomAt(state: ViewState, factor: number, point: { x: number; y: number }, viewport: Viewport, fitScale: number): ViewState {
  const scale = clampScale(state.scale * factor, fitScale);
  const dx = point.x - viewport.width / 2;
  const dy = point.y - viewport.height / 2;
  const sx = state.cx + dx / state.scale;
  const sy = state.cy + dy / state.scale;
  return { cx: sx - dx / scale, cy: sy - dy / scale, scale };
}

/** Drag by (dx, dy) CSS px: the sheet follows the pointer. */
export function panBy(state: ViewState, dx: number, dy: number): ViewState {
  return { ...state, cx: state.cx - dx / state.scale, cy: state.cy - dy / state.scale };
}

export function viewBoxFor(state: ViewState, viewport: Viewport): Box2 {
  const w = viewport.width / state.scale;
  const h = viewport.height / state.scale;
  return { minX: state.cx - w / 2, minY: state.cy - h / 2, maxX: state.cx + w / 2, maxY: state.cy + h / 2 };
}

/** The sheet point under a viewport point (CSS px). */
export function sheetPointAt(state: ViewState, point: { x: number; y: number }, viewport: Viewport): { x: number; y: number } {
  return { x: state.cx + (point.x - viewport.width / 2) / state.scale, y: state.cy + (point.y - viewport.height / 2) / state.scale };
}

export function zoomPercentOf(state: ViewState, fit: ViewState): number {
  return Math.round((state.scale / fit.scale) * 100);
}
