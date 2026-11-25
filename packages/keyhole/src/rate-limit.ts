/** Per-user rate limit with fixed windows: one per UTC minute and one per UTC day. */
import type { KeyholeConfig } from './config.ts';
import type { UsageStore } from './usage-store.ts';

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export async function checkRateLimit(
  store: UsageStore,
  userKey: string,
  config: Pick<KeyholeConfig, 'ratePerMinute' | 'ratePerDay'>,
  now: Date,
): Promise<RateLimitResult> {
  const ms = now.getTime();
  const minute = Math.floor(ms / 60_000);
  const day = Math.floor(ms / 86_400_000);
  const secondsTo = (boundaryMs: number) => Math.max(1, Math.ceil((boundaryMs - ms) / 1000));

  // The day counter only moves for requests the minute window lets through, so a burst of
  // refused requests doesn't eat into the day.
  const perMinute = await store.incr(`rl:m:${userKey}:${minute}`, 61);
  if (perMinute > config.ratePerMinute) return { ok: false, retryAfterSeconds: secondsTo((minute + 1) * 60_000) };

  const perDay = await store.incr(`rl:d:${userKey}:${day}`, 86_401);
  if (perDay > config.ratePerDay) return { ok: false, retryAfterSeconds: secondsTo((day + 1) * 86_400_000) };

  return { ok: true };
}
