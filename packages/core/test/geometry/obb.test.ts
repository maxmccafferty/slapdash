import { describe, expect, it } from 'vitest';
import { aabbOf, boxesOverlap, eulerFromAxes, partBox, rotationAxes } from '../../src/geometry/obb.ts';

const box = (x: number, y: number, z: number, rot = { x: 0, y: 0, z: 0 }, size = { length: 100, width: 38.1, height: 88.9 }) =>
  partBox({ position: { x, y, z }, rotation: rot, size });

describe('oriented boxes', () => {
  it('rotationAxes follows intrinsic XYZ (Three.js order): z 90° turns local x to +y', () => {
    const [X, Y, Z] = rotationAxes({ x: 0, y: 0, z: 90 });
    expect(X.y).toBeCloseTo(1);
    expect(Y.x).toBeCloseTo(-1);
    expect(Z.z).toBeCloseTo(1);
  });

  it('eulerFromAxes inverts rotationAxes', () => {
    for (const r of [
      { x: 0, y: 30, z: 90 },
      { x: 10, y: -20, z: 45 },
      { x: 0, y: 90, z: 0 },
    ]) {
      const back = eulerFromAxes(rotationAxes(r));
      const a = rotationAxes(back);
      const b = rotationAxes(r);
      for (let i = 0; i < 3; i++) for (const k of ['x', 'y', 'z'] as const) expect(a[i]![k]).toBeCloseTo(b[i]![k], 9);
    }
  });

  it('two studs side by side, touching: no clash', () => {
    expect(boxesOverlap(box(0, 0, 0), box(0, 38.1, 0))).toBe(false);
  });

  it('overlapping by 2mm: clash; by 0.5mm: within tolerance', () => {
    expect(boxesOverlap(box(0, 0, 0), box(0, 36.1, 0))).toBe(true);
    expect(boxesOverlap(box(0, 0, 0), box(0, 37.6, 0))).toBe(false);
  });

  it('a 45° stud against an axis-aligned one', () => {
    const a = box(0, 0, 0, { x: 0, y: 0, z: 0 }, { length: 1000, width: 38.1, height: 88.9 });
    const crossing = box(500, -400, 0, { x: 0, y: 0, z: 45 }, { length: 1000, width: 38.1, height: 88.9 });
    const clear = box(500, 200, 0, { x: 0, y: 0, z: 45 }, { length: 1000, width: 38.1, height: 88.9 });
    expect(boxesOverlap(a, crossing)).toBe(true);
    expect(boxesOverlap(a, clear)).toBe(false);
  });

  it('aabbOf a box rotated in plan', () => {
    const b = aabbOf(box(0, 0, 0, { x: 0, y: 90, z: 0 }, { length: 100, width: 10, height: 20 }));
    // Local x → -z, local z → +x under a 90° turn about y.
    expect(b.min.z).toBeCloseTo(-100);
    expect(b.max.x).toBeCloseTo(20);
    expect(b.max.y).toBeCloseTo(10);
  });
});
