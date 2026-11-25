/** The monthly budget (ADR-0002 §D9): warn at 80%, stop at the cap. Months are UTC. */
import type { BudgetStatus } from '@slapdash/agent';

export const WARN_FRACTION = 0.8;

/** `YYYY-MM` in UTC. */
export function monthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** The first day of the next UTC month, 00:00. */
export function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * The budget state for a month's spend. `fraction` is reported as is (not clamped), so a
 * cap overshot by concurrent requests shows as more than 1.
 */
export function budgetStatus(spentMicro: number, capUsd: number, now: Date): BudgetStatus {
  const capMicro = Math.round(capUsd * 1e6);
  const fraction = capMicro > 0 ? spentMicro / capMicro : 1;
  const state = spentMicro >= capMicro ? 'capped' : spentMicro >= capMicro * WARN_FRACTION ? 'warning' : 'ok';
  return {
    state,
    spentUsd: spentMicro / 1e6,
    capUsd,
    fraction,
    month: monthKey(now),
    resetsAt: nextMonthStart(now).toISOString(),
  };
}
