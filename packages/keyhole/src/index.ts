/** Server only. `apps/web/src` must never import this package (a test enforces it). */
import { anthropicTransport } from './claude.ts';
import { readConfig, type Env } from './config.ts';
import { createKeyhole, type KeyholeDeps, type KeyholeHandler } from './handler.ts';
import { supabaseIdentity } from './supabase-identify.ts';
import { selectUsageStore } from './usage-store.ts';

export { budgetStatus, monthKey, nextMonthStart, WARN_FRACTION } from './budget.ts';
export { anthropicTransport, buildClaudeParams, FALLBACK_BETA, type ClaudeParams, type ClaudeTransport } from './claude.ts';
export { DEFAULT_MODEL, readConfig, type Effort, type Env, type KeyholeConfig } from './config.ts';
export { createKeyhole, upstreamError, type KeyholeDeps, type KeyholeHandler } from './handler.ts';
export { clientIp, identifyUser, type Identify } from './identify.ts';
export { bearerToken, supabaseIdentity, type Authenticate, type SupabaseIdentity, type SupabaseIdentityOptions } from './supabase-identify.ts';
export { costMicroUsd, priceFor, PRICES, PRICES_CHECKED, type ModelPrice, type TokenUsage } from './pricing.ts';
export { checkRateLimit, type RateLimitResult } from './rate-limit.ts';
export { FileUsageStore } from './stores/file.ts';
export { MemoryUsageStore } from './stores/memory.ts';
export { UpstashUsageStore } from './stores/upstash.ts';
export { selectUsageStore, type UsageStore } from './usage-store.ts';

/**
 * The keyhole wired from the environment: config, usage store and the Anthropic SDK. With
 * Supabase configured, POST needs a signed-in user and the rate limit is per user.
 */
export function createKeyholeFromEnv(env: Env, opts: { fetch?: typeof fetch } = {}): KeyholeHandler {
  const config = readConfig(env);
  const store = selectUsageStore(config, env);
  const deps: KeyholeDeps = { config, store, ...(config.apiKey ? { transport: anthropicTransport(config.apiKey) } : {}) };
  if (config.supabase) {
    const identity = supabaseIdentity({ ...config.supabase, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
    deps.authenticate = identity.verify;
    deps.identify = identity.identify;
  }
  return createKeyhole(deps);
}
