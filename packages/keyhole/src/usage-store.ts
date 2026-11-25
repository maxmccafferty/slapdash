/**
 * Where the keyhole keeps its counters: rate-limit windows and the month's spend. Nothing
 * about the project is stored. Adapters follow ADR-0001 §10: memory (tests), a JSON file
 * (local dev) and Upstash Redis over REST (deployed).
 */
import type { Env, KeyholeConfig } from './config.ts';
import { FileUsageStore } from './stores/file.ts';
import { MemoryUsageStore } from './stores/memory.ts';
import { UpstashUsageStore } from './stores/upstash.ts';

export interface UsageStore {
  /** Adds one to a counter that expires `ttlSeconds` after it was first created. Returns the new count. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** Spend for a `YYYY-MM` month, in micro-dollars. */
  getSpend(month: string): Promise<number>;
  /** Adds to a month's spend. Returns the new total in micro-dollars. */
  addSpend(month: string, micro: number): Promise<number>;
}

/**
 * Upstash when its URL and token are set; memory (with a warning) on a deployment without
 * Upstash, because serverless file systems are read-only or ephemeral; a JSON file otherwise.
 */
export function selectUsageStore(config: KeyholeConfig, env: Env, warn: (message: string) => void = console.warn): UsageStore {
  if (config.upstash) return new UpstashUsageStore(config.upstash);
  const deployed = env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview';
  if (deployed) {
    warn(
      '[keyhole] No Upstash Redis configured (KV_REST_API_URL / KV_REST_API_TOKEN): spend and rate limits are kept in memory and reset on every cold start. Add Upstash, and keep the Anthropic Console spending limit set.',
    );
    return new MemoryUsageStore();
  }
  return new FileUsageStore(config.usageFile);
}
