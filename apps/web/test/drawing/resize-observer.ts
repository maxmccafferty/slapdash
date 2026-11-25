import { afterAll, beforeAll } from 'vitest';

/**
 * jsdom has no layout: give elements a fixed size and a ResizeObserver that reports it once.
 * Call at the top of a describe block.
 */
export function stubResizeObserver(size: { width: number; height: number }): void {
  const original = HTMLElement.prototype.getBoundingClientRect;
  const originalRO = globalThis.ResizeObserver;
  beforeAll(() => {
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { x: 0, y: 0, left: 0, top: 0, right: size.width, bottom: size.height, width: size.width, height: size.height, toJSON: () => ({}) } as DOMRect;
    };
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
  afterAll(() => {
    HTMLElement.prototype.getBoundingClientRect = original;
    globalThis.ResizeObserver = originalRO;
  });
}
