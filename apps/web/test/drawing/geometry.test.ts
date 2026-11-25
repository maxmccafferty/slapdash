import { describe, expect, it } from 'vitest';
import type { Part } from '@slapdash/core';
import { bounds2d, clipBelow, convexHull, sectionAtY, topAt } from '../../src/drawing/geometry.ts';

const part = (over: Partial<Part>): Part =>
  ({
    id: 'X-P01',
    assemblyId: 'X',
    levelId: 'L0',
    role: 'stud',
    materialId: 'spf-no2',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    size: { length: 100, width: 50, height: 1000 },
    buildStep: { phase: 'framing', seq: 0 },
    tags: [],
    ...over,
  }) as Part;

const sortPts = (pts: { x: number; y: number }[]) =>
  pts.map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);

describe('convexHull', () => {
  it('keeps the corners of a square and drops interior and collinear points', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
      { x: 2, y: 3 },
      { x: 5, y: 0 },
    ]);
    expect(sortPts(hull)).toEqual([
      [0, 0],
      [0, 10],
      [10, 0],
      [10, 10],
    ]);
  });

  it('ignores rotation noise', () => {
    const hull = convexHull([
      { x: -1e-14, y: 300 },
      { x: 1e-14, y: 0 },
      { x: 3e-15, y: -100 },
      { x: 500, y: -100 },
      { x: 500, y: 300 },
    ]);
    expect(hull).toHaveLength(4);
  });
});

describe('sectionAtY', () => {
  it('cuts an upright stud into its rectangle', () => {
    // An axis-aligned box: 100 along x, 1000 up, 50 along z.
    const stud = part({ size: { length: 100, width: 1000, height: 50 } });
    const s = sectionAtY(stud, 500)!;
    expect(sortPts(s)).toEqual([
      [0, 0],
      [0, 50],
      [100, 0],
      [100, 50],
    ]);
  });

  it('cuts a box turned 45° about y into a diamond', () => {
    const box = part({ size: { length: 100, width: 1000, height: 100 }, rotation: { x: 0, y: 45, z: 0 } });
    const s = sectionAtY(box, 500)!;
    expect(s).toHaveLength(4);
    const b = bounds2d(s)!;
    expect(b.maxX - b.minX).toBeCloseTo(100 * Math.SQRT2, 2);
    expect(b.maxY - b.minY).toBeCloseTo(100 * Math.SQRT2, 2);
  });

  it('is null when the plane misses the box', () => {
    expect(sectionAtY(part({ size: { length: 100, width: 1000, height: 50 } }), 2000)).toBeNull();
  });
});

describe('clipBelow and topAt', () => {
  const square = [
    { x: 0, y: -10 },
    { x: 10, y: -10 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  it('clips a polygon at a sheet y', () => {
    expect(bounds2d(clipBelow(square, 0))).toEqual({ minX: 0, minY: -10, maxX: 10, maxY: 0 });
  });
  it('finds the top of a polygon at an x', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 10, y: -10 },
      { x: 20, y: 0 },
    ];
    expect(topAt(tri, 5)).toBeCloseTo(-5);
    expect(topAt(tri, 30)).toBeNull();
  });
});
