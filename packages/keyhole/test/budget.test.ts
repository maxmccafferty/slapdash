import { describe, expect, it } from 'vitest';
import { budgetStatus, monthKey, nextMonthStart } from '../src/index.ts';

const NOW = new Date('2026-11-25T15:30:00Z');
const usd = (d: number) => Math.round(d * 1e6);

describe('budget states (acceptance, default $10 cap)', () => {
  it.each([
    [0, 'ok'],
    [7.99, 'ok'],
    [7.999999, 'ok'],
    [8, 'warning'],
    [9.999999, 'warning'],
    [10, 'capped'],
    [12, 'capped'],
  ] as const)('$%s → %s', (spent, state) => {
    expect(budgetStatus(usd(spent), 10, NOW).state).toBe(state);
  });

  it('reports spend, cap and an unclamped fraction', () => {
    expect(budgetStatus(usd(8.5), 10, NOW)).toEqual({
      state: 'warning',
      spentUsd: 8.5,
      capUsd: 10,
      fraction: 0.85,
      month: '2026-11',
      resetsAt: '2026-12-01T00:00:00.000Z',
    });
    // Concurrent requests can overshoot the cap; the fraction says by how much.
    expect(budgetStatus(usd(12), 10, NOW).fraction).toBe(1.2);
  });

  it('follows a custom cap', () => {
    expect(budgetStatus(usd(3.99), 5, NOW).state).toBe('ok');
    expect(budgetStatus(usd(4), 5, NOW).state).toBe('warning');
    expect(budgetStatus(usd(5), 5, NOW).state).toBe('capped');
  });

  it('treats a zero cap as capped', () => {
    expect(budgetStatus(0, 0, NOW).state).toBe('capped');
  });
});

describe('months (UTC)', () => {
  it('keys by UTC month and resets at the first of the next month', () => {
    expect(monthKey(NOW)).toBe('2026-11');
    expect(nextMonthStart(NOW).toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('rolls December over to January', () => {
    const dec = new Date('2026-12-31T23:59:59.999Z');
    expect(monthKey(dec)).toBe('2026-12');
    expect(nextMonthStart(dec).toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(monthKey(new Date('2027-01-01T00:00:00Z'))).toBe('2027-01');
  });
});
