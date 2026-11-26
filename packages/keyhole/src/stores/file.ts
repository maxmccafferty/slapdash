import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { UsageStore } from '../usage-store.ts';

interface FileShape {
  counters: Record<string, { count: number; expiresAt: number }>;
  spend: Record<string, number>;
}

/**
 * Counters in a JSON file (default `.data/usage.json`, gitignored), so restarting the dev
 * server doesn't reset the month. Writes are atomic (temp file, then rename) and serialised
 * within the process; expired counters are pruned on every write.
 */
export class FileUsageStore implements UsageStore {
  readonly #path: string;
  readonly #now: () => number;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(path: string, now: () => number = Date.now) {
    this.#path = path;
    this.#now = now;
  }

  async #read(): Promise<FileShape> {
    try {
      const parsed = JSON.parse(await readFile(this.#path, 'utf8')) as Partial<FileShape>;
      return { counters: parsed.counters ?? {}, spend: parsed.spend ?? {} };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { counters: {}, spend: {} };
      throw e;
    }
  }

  async #write(data: FileShape): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const tmp = `${this.#path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
    await rename(tmp, this.#path);
  }

  /** Runs read-modify-write steps one at a time. */
  #update<T>(fn: (data: FileShape, now: number) => T): Promise<T> {
    const run = this.#chain.then(async () => {
      const data = await this.#read();
      const now = this.#now();
      for (const [key, c] of Object.entries(data.counters)) if (c.expiresAt <= now) delete data.counters[key];
      const result = fn(data, now);
      await this.#write(data);
      return result;
    });
    this.#chain = run.catch(() => undefined);
    return run;
  }

  incr(key: string, ttlSeconds: number): Promise<number> {
    return this.#update((data, now) => {
      const entry = data.counters[key] ?? { count: 0, expiresAt: now + ttlSeconds * 1000 };
      entry.count += 1;
      data.counters[key] = entry;
      return entry.count;
    });
  }

  async getSpend(month: string): Promise<number> {
    await this.#chain;
    return (await this.#read()).spend[month] ?? 0;
  }

  addSpend(month: string, micro: number): Promise<number> {
    return this.#update((data) => {
      data.spend[month] = (data.spend[month] ?? 0) + micro;
      return data.spend[month];
    });
  }
}
