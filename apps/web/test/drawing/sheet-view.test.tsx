import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SheetView } from '../../src/drawing/SheetView.tsx';
import { useSheetViewStore } from '../../src/drawing/sheet-view-store.ts';
import { resetModelStore, useModelStore } from '../../src/state/model-store.ts';
import { useShellStore } from '../../src/state/shell-store.ts';
import { sampleBus } from '../renderer/fixtures.ts';
import { stubResizeObserver } from './resize-observer.ts';

const viewBox = () => screen.getByTestId('sheet').querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number);

describe('SheetView', () => {
  stubResizeObserver({ width: 1000, height: 800 });
  beforeEach(() => {
    useModelStore.getState().attachBus(sampleBus());
  });
  afterEach(() => {
    resetModelStore();
    useSheetViewStore.getState().reset();
  });

  it('is a labelled, focusable image fitted at 100%', () => {
    render(<SheetView />);
    const sheet = screen.getByRole('img', { name: /^2D drawing: plan at 4′ 0″/ });
    expect(sheet).toHaveAttribute('tabindex', '0');
    expect(useShellStore.getState().zoomPercent).toBe(100);
  });

  it('a pointer drag pans', () => {
    render(<SheetView />);
    const el = screen.getByTestId('sheet');
    const [x0, y0, w0] = viewBox();
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 500, clientY: 400, button: 0, pointerType: 'mouse' });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 600, clientY: 350, pointerType: 'mouse' });
    fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'mouse' });
    const [x1, y1, w1] = viewBox();
    expect(w1).toBe(w0);
    expect(x1).toBeLessThan(x0!);
    expect(y1).toBeGreaterThan(y0!);
    expect(useShellStore.getState().zoomPercent).toBe(100);
  });

  it('the wheel zooms and updates the readout', () => {
    render(<SheetView />);
    const el = screen.getByTestId('sheet');
    const [, , w0] = viewBox();
    act(() => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: 300, clientY: 300, bubbles: true, cancelable: true }));
    });
    const [, , w1] = viewBox();
    expect(w1).toBeLessThan(w0!);
    expect(useShellStore.getState().zoomPercent).toBeGreaterThan(100);
  });

  it('+ zooms in and 0 fits again', () => {
    render(<SheetView />);
    const el = screen.getByTestId('sheet');
    const fitted = viewBox();
    fireEvent.keyDown(el, { key: '+' });
    expect(useShellStore.getState().zoomPercent).toBe(125);
    fireEvent.keyDown(el, { key: 'ArrowLeft' });
    expect(viewBox()).not.toEqual(fitted);
    fireEvent.keyDown(el, { key: '0' });
    expect(viewBox()).toEqual(fitted);
    expect(useShellStore.getState().zoomPercent).toBe(100);
  });

  it('keeps the view when it is shown again', () => {
    const first = render(<SheetView />);
    fireEvent.keyDown(screen.getByTestId('sheet'), { key: '-' });
    const zoomed = viewBox();
    first.unmount();
    render(<SheetView />);
    expect(viewBox()).toEqual(zoomed);
    expect(useShellStore.getState().zoomPercent).toBe(80);
  });

  it('follows Dimensions', () => {
    render(<SheetView />);
    expect(screen.getByTestId('sheet').querySelectorAll('[data-dim]').length).toBeGreaterThan(0);
    act(() => useShellStore.getState().setDimensions(false));
    expect(screen.getByTestId('sheet').querySelectorAll('[data-dim]')).toHaveLength(0);
  });
});
