import { render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DrawingSheet } from '../../src/drawing/DrawingSheet.tsx';
import { buildSheet } from '../../src/drawing/sheet.ts';
import { drawingSheetSvg, sheetToSvg } from '../../src/drawing/svg.ts';
import { SheetView } from '../../src/drawing/SheetView.tsx';
import { useSheetViewStore } from '../../src/drawing/sheet-view-store.ts';
import { resetModelStore, useModelStore } from '../../src/state/model-store.ts';
import { sampleBus, sampleProject } from '../renderer/fixtures.ts';
import { stubResizeObserver } from './resize-observer.ts';

/** The SVG without its root viewBox (pan and zoom) and class, serialised the same way for both. */
function contentOf(svg: Element): string {
  const copy = svg.cloneNode(true) as Element;
  copy.removeAttribute('viewBox');
  copy.removeAttribute('class');
  copy.removeAttribute('xmlns');
  return new XMLSerializer().serializeToString(copy);
}

const LABELS = ['20′ 0″', '16′ 0″', '9′ 0″', '13′ 4 7/8″', '6′ 0″', '3′ 0″', '6 in 12', 'North', 'South', 'East', 'West', 'Plan at 4′ 0″'];

describe('the exported SVG', () => {
  let svg = '';
  beforeAll(async () => {
    svg = await drawingSheetSvg(sampleProject());
  });

  it('is a standalone, well-formed SVG file', () => {
    expect(svg.startsWith('<?xml')).toBe(true);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    const root = doc.documentElement;
    expect(root.tagName).toBe('svg');
    expect(root.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(root.getAttribute('viewBox')).toMatch(/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/);
    expect(root.querySelector('title')?.textContent).toMatch(/^2D drawing/);
  });

  it('uses no CSS variables and no non-scaling strokes', () => {
    expect(svg).not.toContain('var(--');
    expect(svg).not.toContain('vector-effect');
  });

  it('carries every acceptance label', () => {
    for (const label of LABELS) expect(svg, label).toContain(label);
  });
});

describe('the same drawing on screen and as SVG', () => {
  stubResizeObserver({ width: 1032, height: 820 });
  afterEach(() => {
    resetModelStore();
    useSheetViewStore.getState().reset();
  });

  it('renders the same SVG content in the app and in the export', async () => {
    useModelStore.getState().attachBus(sampleBus());
    const { getByTestId } = render(<SheetView />);
    const onScreen = getByTestId('sheet').querySelector('svg')!;
    const sheet = buildSheet(useModelStore.getState().project, { floor: 'roof', dimensions: true });
    const exported = new DOMParser().parseFromString(await sheetToSvg(sheet, { nonScalingStroke: true }), 'image/svg+xml').documentElement;
    expect(onScreen.innerHTML.length).toBeGreaterThan(1000);
    expect(onScreen.getAttribute('viewBox')).not.toBe(exported.getAttribute('viewBox'));
    // Only the root viewBox (pan and zoom) differs.
    expect(contentOf(onScreen)).toBe(contentOf(exported));
  });

  it('a component render of the sheet matches the static markup', async () => {
    const sheet = buildSheet(sampleProject(), { floor: 'roof', dimensions: true });
    const { container } = render(<DrawingSheet sheet={sheet} />);
    const exported = new DOMParser().parseFromString(await sheetToSvg(sheet), 'image/svg+xml').documentElement;
    expect(contentOf(container.querySelector('svg')!)).toBe(contentOf(exported));
  });
});
