import { describe, expect, it } from 'vitest';
import { sunDirection } from '../../src/renderer/sun.ts';

describe('sunDirection', () => {
  it('without a location: high in the south-west in the afternoon (latitude 37°)', () => {
    const d = sunDirection(undefined, new Date(Date.UTC(2026, 5, 21)));
    expect(d.y).toBeGreaterThan(0.5); // high in June
    expect(d.x).toBeLessThan(0); // west (afternoon)
    expect(d.z).toBeGreaterThan(-0.2); // not from the north
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
  });

  it('never drops below 25° (winter shadows stay readable)', () => {
    const d = sunDirection({ label: 'Oslo', lat: 59.9, lon: 10.7, source: 'project' }, new Date(Date.UTC(2026, 11, 21)));
    expect(Math.asin(d.y) * (180 / Math.PI)).toBeGreaterThanOrEqual(24.999);
  });
});
