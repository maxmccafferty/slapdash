import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { resetChatStore } from '../src/state/chat-store.ts';
import { resetShellStore } from '../src/state/shell-store.ts';

/**
 * A controllable matchMedia: `setViewportWidth(390)` switches every `(max-width: …px)`
 * query and fires change events, like resizing the window.
 */
let viewportWidth = 1440;
const lists = new Set<{ query: string; listeners: Set<() => void> }>();

function matches(query: string): boolean {
  const max = /max-width:\s*([\d.]+)px/.exec(query);
  if (max) return viewportWidth <= Number(max[1]);
  const min = /min-width:\s*([\d.]+)px/.exec(query);
  if (min) return viewportWidth >= Number(min[1]);
  return false;
}

export function setViewportWidth(width: number): void {
  viewportWidth = width;
  for (const list of lists) for (const listener of list.listeners) listener();
}

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string): MediaQueryList => {
    const entry = { query, listeners: new Set<() => void>() };
    lists.add(entry);
    return {
      get matches() {
        return matches(query);
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => entry.listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => entry.listeners.delete(listener),
      addListener: (listener: () => void) => entry.listeners.add(listener),
      removeListener: (listener: () => void) => entry.listeners.delete(listener),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  },
});

beforeEach(() => {
  viewportWidth = 1440;
  resetShellStore();
  resetChatStore();
});

afterEach(() => {
  cleanup();
  lists.clear();
});
