import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, clampScale, fitView, panBy, sheetPointAt, viewBoxFor, zoomAt, zoomPercentOf } from '../../src/drawing/pan-zoom.ts';

const sheet = { minX: -1000, minY: -500, maxX: 3000, maxY: 1500 };
const vp = { width: 800, height: 600 };

describe('pan and zoom', () => {
  it('fits the sheet, centred', () => {
    const fit = fitView(sheet, vp);
    expect(fit).toEqual({ cx: 1000, cy: 500, scale: 0.2 });
    const vb = viewBoxFor(fit, vp);
    expect(vb.minX).toBeLessThanOrEqual(sheet.minX);
    expect(vb.maxX).toBeGreaterThanOrEqual(sheet.maxX);
    expect(vb.minY).toBeLessThanOrEqual(sheet.minY);
    expect(vb.maxY).toBeGreaterThanOrEqual(sheet.maxY);
    expect(zoomPercentOf(fit, fit)).toBe(100);
  });

  it('keeps the sheet point under the cursor fixed while zooming', () => {
    const fit = fitView(sheet, vp);
    const cursor = { x: 130, y: 470 };
    const before = sheetPointAt(fit, cursor, vp);
    const zoomed = zoomAt(fit, 2.5, cursor, vp, fit.scale);
    expect(zoomed.scale).toBeCloseTo(0.5);
    const after = sheetPointAt(zoomed, cursor, vp);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(zoomPercentOf(zoomed, fit)).toBe(250);
  });

  it('pans by pixels over the scale, following the pointer', () => {
    const s = { cx: 0, cy: 0, scale: 0.5 };
    expect(panBy(s, 100, -50)).toEqual({ cx: -200, cy: 100, scale: 0.5 });
  });

  it('clamps the zoom to 25%–800% of the fit', () => {
    expect(clampScale(100, 1)).toBe(MAX_ZOOM);
    expect(clampScale(0.001, 1)).toBe(MIN_ZOOM);
    const fit = fitView(sheet, vp);
    expect(zoomPercentOf(zoomAt(fit, 1000, { x: 0, y: 0 }, vp, fit.scale), fit)).toBe(800);
    expect(zoomPercentOf(zoomAt(fit, 0.001, { x: 0, y: 0 }, vp, fit.scale), fit)).toBe(25);
  });
});
