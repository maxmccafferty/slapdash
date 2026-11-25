import { describe, expect, it } from 'vitest';
import type { UsageStore } from '../src/index.ts';

export interface StoreHarness {
  store: UsageStore;
  /** Moves the store's clock forward. */
  advance(ms: number): void;
}

/** The contract every UsageStore adapter meets. */
export function usageStoreContract(name: string, make: () => Promise<StoreHarness> | StoreHarness): void {
  describe(`${name} usage store contract`, () => {
    it('counts', async () => {
      const { store } = await make();
      expect(await store.incr('a', 60)).toBe(1);
      expect(await store.incr('a', 60)).toBe(2);
      expect(await store.incr('b', 60)).toBe(1);
    });

    it('expires counters after their ttl', async () => {
      const h = await make();
      await h.store.incr('a', 60);
      await h.store.incr('a', 60);
      h.advance(59_000);
      expect(await h.store.incr('a', 60)).toBe(3);
      h.advance(2_000);
      expect(await h.store.incr('a', 60)).toBe(1);
    });

    it('adds spend per month, months independent', async () => {
      const { store } = await make();
      expect(await store.getSpend('2026-11')).toBe(0);
      expect(await store.addSpend('2026-11', 1_500)).toBe(1_500);
      expect(await store.addSpend('2026-11', 2_500)).toBe(4_000);
      expect(await store.getSpend('2026-11')).toBe(4_000);
      expect(await store.getSpend('2026-12')).toBe(0);
      await store.addSpend('2026-12', 7);
      expect(await store.getSpend('2026-11')).toBe(4_000);
      expect(await store.getSpend('2026-12')).toBe(7);
    });

    it('handles concurrent increments without losing any', async () => {
      const { store } = await make();
      const counts = await Promise.all(Array.from({ length: 20 }, () => store.incr('c', 60)));
      expect(counts.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      await Promise.all(Array.from({ length: 10 }, () => store.addSpend('2026-11', 3)));
      expect(await store.getSpend('2026-11')).toBe(30);
    });
  });
}
