import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { solidSurfaceTriangles, type PartCuts } from '@slapdash/core';
import { buildCutMesh, cachedCutMesh, cutGeometryCacheSize, makeCutGeometry, releaseCutGeometry } from '../../src/renderer/cutGeometry.ts';

const size = { length: 3115.5, width: 38.1, height: 139.7 };
const cuts: PartCuts = {
  start: { slope: 26.565, name: 'plumb' },
  end: { slope: -26.565, name: 'plumb' },
  notches: [{ kind: 'birdsmouth', profile: [{ x: 327.9, z: -0.9 }, { x: 350.7, z: 44.7 }, { x: 441.1, z: -0.4 }] }],
};
const shape = { key: 'test-rafter', size, cuts };

function positions(g: BufferGeometry): Float32Array {
  return g.getAttribute('position').array as Float32Array;
}

describe('cut geometry', () => {
  it('lies inside the unit box', () => {
    const p = positions(buildCutMesh(shape));
    expect(p.length).toBeGreaterThan(0);
    for (const v of p) {
      expect(v).toBeGreaterThanOrEqual(-1e-6);
      expect(v).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('is closed with outward winding (the inside cutaway paints back faces dark)', () => {
    const p = positions(buildCutMesh(shape));
    // De-normalise, so welding is in mm.
    const mm = Array.from(p, (v, i) => v * [size.length, size.width, size.height][i % 3]!);
    const key = (i: number) => `${mm[i]!.toFixed(2)},${mm[i + 1]!.toFixed(2)},${mm[i + 2]!.toFixed(2)}`;
    const edges = new Map<string, number>();
    let volume = 0;
    for (let t = 0; t < mm.length; t += 9) {
      const k = [key(t), key(t + 3), key(t + 6)];
      for (let e = 0; e < 3; e++) edges.set(`${k[e]}>${k[(e + 1) % 3]}`, (edges.get(`${k[e]}>${k[(e + 1) % 3]}`) ?? 0) + 1);
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = mm.slice(t, t + 9) as [number, number, number, number, number, number, number, number, number];
      volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
    for (const [e, n] of edges) {
      const [a, b] = e.split('>');
      expect(n, e).toBe(1);
      expect(edges.get(`${b}>${a}`), e).toBe(1);
    }
    expect(volume).toBeGreaterThan(0);
  });

  it('de-normalised by size, equals the core solid’s surface', () => {
    const p = positions(buildCutMesh(shape));
    const tris = solidSurfaceTriangles(size, cuts);
    expect(p.length).toBe(tris.length);
    const dims = [size.length, size.width, size.height];
    for (let i = 0; i < p.length; i++) expect(p[i]! * dims[i % 3]!).toBeCloseTo(tris[i]!, 2);
  });

  it('builds a shape once and shares it; each batch gets its own instance attributes', () => {
    const before = cutGeometryCacheSize();
    const a = makeCutGeometry(shape, 8);
    const b = makeCutGeometry(shape, 8);
    expect(cutGeometryCacheSize()).toBe(before + 1);
    expect(a.getAttribute('position')).toBe(b.getAttribute('position'));
    expect(a.getAttribute('position')).toBe(cachedCutMesh(shape.key)!.getAttribute('position'));
    expect(a.getAttribute('aVariation')).not.toBe(b.getAttribute('aVariation'));
    expect(a.getAttribute('aEnter').count).toBe(8);
    releaseCutGeometry(a);
    expect(cutGeometryCacheSize()).toBe(before + 1);
    releaseCutGeometry(b);
    expect(cutGeometryCacheSize()).toBe(before);
  });
});
