import { describe, expect, it } from 'vitest';
import type { PartResult } from '@slapdash/solver';
import { bandFor, calloutText, shouldExplain, stressBand } from '../../src/analysis/stress.ts';

const member = (utilization: number, role: PartResult['role'] = 'member'): PartResult => ({ id: 'X', role, utilization, checks: {} });

describe('stress bands', () => {
  it('equal fifths, upper edges inclusive; over is anything past 100%', () => {
    expect(bandFor(0)).toBe(0);
    expect(bandFor(0.2)).toBe(0);
    expect(bandFor(0.2001)).toBe(1);
    expect(bandFor(0.4)).toBe(1);
    expect(bandFor(0.6)).toBe(2);
    expect(bandFor(0.6001)).toBe(3);
    expect(bandFor(0.8)).toBe(3);
    expect(bandFor(0.8001)).toBe(4);
    expect(bandFor(1.0)).toBe(4);
    expect(bandFor(1.0001)).toBe('over');
    expect(bandFor(2.5)).toBe('over');
  });

  it('parts the solver does not check are unchecked', () => {
    expect(stressBand(member(0.5))).toBe(2);
    expect(stressBand(member(0.5, 'panel'))).toBe(2);
    expect(stressBand(member(0, 'mass-only'))).toBe('unchecked');
    expect(stressBand(member(0, 'ground'))).toBe('unchecked');
    expect(stressBand(member(0, 'not-connected'))).toBe('unchecked');
    expect(stressBand(undefined)).toBe('unchecked');
  });
});

describe('callout text', () => {
  it('rounds to the nearest 5%', () => {
    expect(calloutText('Header, South wall', 0.9)).toBe('Header, South wall · about 90% of its limit');
    expect(calloutText('Header, South wall', 0.87)).toBe('Header, South wall · about 85% of its limit');
    expect(calloutText('Header, South wall', 0.881)).toBe('Header, South wall · about 90% of its limit');
    expect(calloutText('Stud, North wall', 0.02)).toBe('Stud, North wall · about 0% of its limit');
  });

  it('says over its limit past 100%', () => {
    expect(calloutText('Header, South wall', 1.4)).toBe('Header, South wall · over its limit (about 140%)');
    expect(calloutText('Header, South wall', 1.0001)).toBe('Header, South wall · over its limit (about 100%)');
  });
});

describe('when Claude explains unprompted', () => {
  const ctx = (u: number, overCount = 0, unstable: string[] = []) => ({
    worst: { id: 'W3-H01', label: 'Header, South wall', utilization: u, check: 'bending', combo: 'D+S' },
    overCount,
    unstable,
  });
  it('at the top orange band, over, or unstable; not below 80%', () => {
    expect(shouldExplain(ctx(0.79))).toBe(false);
    expect(shouldExplain(ctx(0.8))).toBe(true);
    expect(shouldExplain(ctx(1.2, 1))).toBe(true);
    expect(shouldExplain(ctx(0.3, 0, ['W1 tips over.']))).toBe(true);
    expect(shouldExplain({ worst: null, overCount: 0, unstable: [] })).toBe(false);
  });
});
