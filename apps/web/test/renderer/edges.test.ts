import { describe, expect, it } from 'vitest';
import { partFeatureEdges, type Part } from '@slapdash/core';
import { partCornersM, partEdgeSegments } from '../../src/renderer/edges.ts';
import { sampleProject } from './fixtures.ts';

describe('partEdgeSegments', () => {
  const project = sampleProject();

  it('gives the 12 box edges of an uncut part', () => {
    const stud = project.parts['W1-S01']!;
    expect(stud.cuts).toBeUndefined();
    expect(partEdgeSegments([stud])).toHaveLength(24);
  });

  it('follows a plumb-cut rafter: the slanted end edge, and nothing past the long point', () => {
    const part: Part = {
      ...project.parts['W1-S01']!,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      size: { length: 3000, width: 38.1, height: 139.7 },
      cuts: { end: { slope: -26.565, name: 'plumb' } },
    };
    const segs = partEdgeSegments([part]);
    expect(segs.length).toBe(partFeatureEdges(part).length * 2);
    const short = (3000 - 139.7 * Math.tan((26.565 * Math.PI) / 180)) / 1000;
    // A slanted edge from the short point (bottom) up to the long point (top).
    let slanted = false;
    for (let i = 0; i < segs.length; i += 2) {
      const [a, b] = [segs[i]!, segs[i + 1]!];
      const [lo, hi] = a[2] < b[2] ? [a, b] : [b, a];
      if (Math.abs(lo[0] - short) < 1e-6 && Math.abs(hi[0] - 3) < 1e-6 && Math.abs(lo[1] - hi[1]) < 1e-9) slanted = true;
    }
    expect(slanted).toBe(true);
    // The box's bottom corner past the short point is gone.
    const cut = partCornersM(part).find((c) => Math.abs(c[0] - 3) < 1e-9 && Math.abs(c[2]) < 1e-9)!;
    expect(segs.some((p) => Math.hypot(p[0] - cut[0], p[1] - cut[1], p[2] - cut[2]) < 1e-6)).toBe(false);
  });
});
