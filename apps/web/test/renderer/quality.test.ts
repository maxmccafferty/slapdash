import { describe, expect, it } from 'vitest';
import { TIER_SETTINGS, createTierGovernor, initialTier } from '../../src/renderer/quality.ts';

describe('initialTier', () => {
  it('phone → low, iPad → medium, laptop → high', () => {
    expect(initialTier({ coarsePointer: true, width: 390 })).toBe('low');
    expect(initialTier({ coarsePointer: true, width: 1024 })).toBe('medium');
    expect(initialTier({ coarsePointer: true, width: 1366 })).toBe('medium');
    expect(initialTier({ coarsePointer: false, width: 1440 })).toBe('high');
    expect(initialTier({ coarsePointer: false, width: 800 })).toBe('high');
  });

  it('turns things down from high to low', () => {
    expect(TIER_SETTINGS.low.dprMax).toBeLessThan(TIER_SETTINGS.high.dprMax);
    expect(TIER_SETTINGS.low.shadowMapSize).toBeLessThan(TIER_SETTINGS.medium.shadowMapSize);
    expect(TIER_SETTINGS.medium.shadowMapSize).toBeLessThan(TIER_SETTINGS.high.shadowMapSize);
    expect(TIER_SETTINGS.low.ao).toBe('off');
    expect(TIER_SETTINGS.low.detailMaps).toBe(false);
  });
});

/** Feed `n` frames `dt` ms apart (after a first frame at 0, which has no delta); returns the tier changes. */
function run(g: ReturnType<typeof createTierGovernor>, n: number, dt: number, start = { t: 0 }) {
  const changes: string[] = [];
  if (start.t === 0) g.frame(0);
  for (let i = 0; i < n; i++) {
    start.t += dt;
    const c = g.frame(start.t);
    if (c) changes.push(c);
  }
  return changes;
}

describe('createTierGovernor', () => {
  it('steps down when interaction is slow', () => {
    const g = createTierGovernor('high', { window: 10 });
    expect(run(g, 10, 33)).toEqual(['medium']);
    expect(g.tier).toBe('medium');
  });

  it('ignores idle gaps (on-demand rendering)', () => {
    const g = createTierGovernor('high', { window: 10 });
    const clock = { t: 0 };
    // Frames a second apart: idle, not slow.
    expect(run(g, 40, 1000, clock)).toEqual([]);
    expect(g.tier).toBe('high');
  });

  it('steps up only after several good windows', () => {
    const g = createTierGovernor('low', { window: 10, upAfter: 3 });
    const clock = { t: 0 };
    expect(run(g, 20, 16, clock)).toEqual([]);
    expect(run(g, 10, 16, clock)).toEqual(['medium']);
  });

  it('stops flip-flopping', () => {
    const g = createTierGovernor('medium', { window: 10, upAfter: 1, maxFlips: 2 });
    const clock = { t: 0 };
    const changes = [...run(g, 10, 33, clock), ...run(g, 10, 16, clock), ...run(g, 10, 33, clock), ...run(g, 10, 16, clock), ...run(g, 10, 33, clock)];
    expect(changes).toEqual(['low', 'medium', 'low']);
  });
});
