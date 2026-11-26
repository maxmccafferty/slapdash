/**
 * End-to-end span check: one member on two pinned supports with the case's tributary
 * load; bisect the span until the governing utilisation is 1.0 and compare with the
 * fixture (see its header for where the numbers come from).
 */
import { KPA_PER_PSF } from '@slapdash/core';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/index.ts';
import { AWC_SPANS, type SpanCase } from './fixtures/awc-spans.ts';
import { INDEX, beamOnSupports } from './helpers.ts';

const IN = 25.4;

function run(c: SpanCase, spanMm: number) {
  const project = beamOnSupports({
    length: spanMm,
    section: c.section,
    materialId: c.materialId,
    role: c.role,
    assembly: { kind: c.role === 'joist' ? 'floor' : 'roof', params: { spacing: c.spacing } },
    // AWC rafter spans with L/240 assume a ceiling attached to the rafters.
    tags: c.deflection === 240 ? ['ceiling-attached'] : [],
  });
  const live = c.live_psf * KPA_PER_PSF;
  return analyze(project, INDEX, {
    cases: ['D', c.liveKind],
    loads: {
      selfWeight: false,
      superimposedDead_kPa: c.dead_psf * KPA_PER_PSF,
      ...(c.liveKind === 'L' ? { floorLive_kPa: live } : c.liveKind === 'S' ? { roofSnow_kPa: live } : { roofLive_kPa: live }),
    },
  }).parts['B1-J01']!;
}

describe('span checks against the AWC method', () => {
  it.each(AWC_SPANS.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    let lo = 1000;
    let hi = 8000;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (run(c, mid).utilization > 1) hi = mid;
      else lo = mid;
    }
    const span = (lo + hi) / 2;
    const at = run(c, span);
    const kind = at.governing!.check === 'deflection' ? 'deflection' : 'bending';
    expect(Math.abs(span / IN - c.span_in) / c.span_in).toBeLessThan(0.03);
    expect(kind).toBe(c.governs);
  });
});
