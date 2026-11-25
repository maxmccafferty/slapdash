import type { UsageStore } from '../usage-store.ts';

/** Spend keys live a little longer than a month so the last day's total can still be read. */
export const SPEND_TTL_SECONDS = 40 * 24 * 60 * 60;

type Command = (string | number)[];

/**
 * Upstash Redis over its REST API (`/pipeline`), with plain `fetch` and no dependency.
 * Works with the Vercel Marketplace variables (`KV_REST_API_URL` / `KV_REST_API_TOKEN`).
 */
export class UpstashUsageStore implements UsageStore {
  readonly #url: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(options: { url: string; token: string }, fetchImpl: typeof fetch = globalThis.fetch) {
    this.#url = options.url.replace(/\/+$/, '');
    this.#token = options.token;
    this.#fetch = fetchImpl;
  }

  async #pipeline(commands: Command[]): Promise<unknown[]> {
    const response = await this.#fetch(`${this.#url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.#token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
    });
    if (!response.ok) throw new Error(`Upstash request failed with HTTP ${response.status}.`);
    const results = (await response.json()) as { result?: unknown; error?: string }[];
    return results.map((r) => {
      if (r.error) throw new Error(`Upstash error: ${r.error}`);
      return r.result;
    });
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const [count] = await this.#pipeline([
      ['INCR', key],
      ['EXPIRE', key, ttlSeconds, 'NX'],
    ]);
    return Number(count);
  }

  async getSpend(month: string): Promise<number> {
    const [value] = await this.#pipeline([['GET', `spend:${month}`]]);
    return value == null ? 0 : Number(value);
  }

  async addSpend(month: string, micro: number): Promise<number> {
    const key = `spend:${month}`;
    const [total] = await this.#pipeline([
      ['INCRBY', key, micro],
      ['EXPIRE', key, SPEND_TTL_SECONDS],
    ]);
    return Number(total);
  }
}
