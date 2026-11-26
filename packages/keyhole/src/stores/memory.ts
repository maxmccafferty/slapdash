import type { UsageStore } from '../usage-store.ts';

/** Counters in a Map with expiry. For tests, and for deployments without Upstash. */
export class MemoryUsageStore implements UsageStore {
  readonly #counters = new Map<string, { count: number; expiresAt: number }>();
  readonly #spend = new Map<string, number>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const now = this.#now();
    const current = this.#counters.get(key);
    const entry = current && current.expiresAt > now ? current : { count: 0, expiresAt: now + ttlSeconds * 1000 };
    entry.count += 1;
    this.#counters.set(key, entry);
    return entry.count;
  }

  async getSpend(month: string): Promise<number> {
    return this.#spend.get(month) ?? 0;
  }

  async addSpend(month: string, micro: number): Promise<number> {
    const total = (this.#spend.get(month) ?? 0) + micro;
    this.#spend.set(month, total);
    return total;
  }
}
