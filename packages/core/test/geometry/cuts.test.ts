import { describe, expect, it } from 'vitest';
import {
  boxesOverlap,
  buildSolid,
  describeCuts,
  partBox,
  partFeatureEdges,
  partSolidAabb,
  partSolidCorners,
  partsOverlap,
  pitchAngleDeg,
  solidSurfaceTriangles,
  validateCuts,
  type PartCuts,
  type PartSize,
} from '../../src/index.ts';

const RAD = Math.PI / 180;
const size: PartSize = { length: 3000, width: 38.1, height: 139.7 };
const theta = pitchAngleDeg(6 / 12);

/** Every edge of the triangle soup (welded at 1e-4 mm) is used by exactly two triangles, in opposite directions. */
function expectClosedOutward(tris: Float64Array) {
  const key = (i: number) => `${tris[i]!.toFixed(4)},${tris[i + 1]!.toFixed(4)},${tris[i + 2]!.toFixed(4)}`;
  const directed = new Map<string, number>();
  let vol = 0;
  for (let t = 0; t < tris.length; t += 9) {
    const v = [key(t), key(t + 3), key(t + 6)];
    for (let k = 0; k < 3; k++) {
      const e = `${v[k]}>${v[(k + 1) % 3]}`;
      directed.set(e, (directed.get(e) ?? 0) + 1);
    }
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.from(tris.subarray(t, t + 9));
    vol += (ax! * (by! * cz! - bz! * cy!) - ay! * (bx! * cz! - bz! * cx!) + az! * (bx! * cy! - by! * cx!)) / 6;
  }
  for (const [e, n] of directed) {
    expect(n, e).toBe(1);
    const [a, b] = e.split('>');
    expect(directed.get(`${b}>${a}`), `twin of ${e}`).toBe(1);
  }
  expect(vol).toBeGreaterThan(0);
  return vol;
}

describe('cut solids', () => {
  it('an uncut solid is the box', () => {
    const s = buildSolid(size, undefined);
    expect(s.vertices).toHaveLength(8);
    expect(s.volume).toBeCloseTo(size.length * size.width * size.height, 3);
    expect(expectClosedOutward(s.triangles)).toBeCloseTo(s.volume, 3);
  });

  it('a plumb end leaves the short point at L − d·tanθ and the prism volume', () => {
    const cuts: PartCuts = { end: { slope: -theta, name: 'plumb' } };
    const s = buildSolid(size, cuts);
    const short = size.length - size.height * Math.tan(theta * RAD);
    const bottomXs = s.vertices.filter((v) => Math.abs(v.z) < 1e-6).map((v) => v.x);
    expect(Math.max(...bottomXs)).toBeCloseTo(short, 6);
    expect(s.volume).toBeCloseTo((size.length - (size.height * Math.tan(theta * RAD)) / 2) * size.width * size.height, 2);
    expectClosedOutward(s.triangles);
  });

  it('a birdsmouth removes ½·seat·heel·width and stays closed', () => {
    const cuts: PartCuts = {
      start: { slope: theta, name: 'plumb' },
      notches: [{ kind: 'birdsmouth', profile: [{ x: 500, z: -1 }, { x: 500, z: 40 }, { x: 600, z: -1 }] }],
    };
    const s = buildSolid(size, cuts);
    const startLoss = (size.height * size.height * Math.tan(theta * RAD)) / 2;
    // The notch triangle clipped to z ≥ 0: base 100·(41/41)… the triangle (500,0)-(500,40)-(597.56,0).
    const seat = 100 * (40 / 41);
    const expected = (size.length * size.height - startLoss - (seat * 40) / 2) * size.width;
    expect(s.volume).toBeCloseTo(expected, 1);
    expect(expectClosedOutward(s.triangles)).toBeCloseTo(s.volume, 1);
    expect(s.pieces.length).toBeGreaterThan(1);
  });

  it('a compound (slope + miter) start cut is still closed', () => {
    const s = buildSolid(size, { start: { slope: 20, miter: 30 } });
    expectClosedOutward(s.triangles);
    expect(s.pieces).toHaveLength(1);
  });

  it('two notches and a tie trim are closed too', () => {
    const cuts: PartCuts = {
      notches: [
        { kind: 'birdsmouth', profile: [{ x: 300, z: -1 }, { x: 300, z: 40 }, { x: 400, z: -1 }] },
        { kind: 'trim', profile: [{ x: -1, z: 100 }, { x: 60, z: 141 }, { x: -1, z: 141 }] },
      ],
    };
    expectClosedOutward(solidSurfaceTriangles(size, cuts));
  });
});

describe('validateCuts', () => {
  it('accepts a plumb-cut rafter', () => {
    expect(validateCuts(size, { start: { slope: theta }, end: { slope: -theta } })).toBeNull();
  });
  it('refuses angles at 80° or more', () => {
    expect(validateCuts(size, { end: { slope: 80 } })).toContain('less than 80°');
  });
  it('refuses an end cut that consumes the part', () => {
    expect(validateCuts({ length: 100, width: 38.1, height: 139.7 }, { start: { slope: 45 }, end: { slope: -45 } })).toContain('short point');
  });
  it('refuses a notch outside the box', () => {
    expect(validateCuts(size, { notches: [{ kind: 'notch', profile: [{ x: 4000, z: 0 }, { x: 4100, z: 0 }, { x: 4050, z: 50 }] }] })).toContain('outside the part');
  });
  it('refuses a non-convex notch', () => {
    const profile = [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 50, z: 10 },
      { x: 100, z: 50 },
      { x: 0, z: 50 },
    ];
    expect(validateCuts(size, { notches: [{ kind: 'notch', profile }] })).toContain('convex');
  });
});

describe('describeCuts', () => {
  it('labels plumb ends and a birdsmouth', () => {
    const d = describeCuts({
      size,
      cuts: {
        start: { slope: theta, name: 'plumb' },
        end: { slope: -theta, name: 'plumb' },
        notches: [{ kind: 'birdsmouth', profile: [{ x: 500, z: -1 }, { x: 500, z: 50 }, { x: 600, z: -1 }] }],
      },
    });
    expect(d.ends.start).toEqual({ name: 'plumb', angle_deg: 26.57 });
    expect(d.longPoint).toBe(true);
    expect(d.notches[0]!.heel_mm).toBeCloseTo(50, 6);
    expect(d.notches[0]!.depth_mm).toBeCloseTo(50, 6);
    expect(d.notches[0]!.face).toBe('bottom');
    expect(d.label).toMatch(/^plumb 26\.6° both ends · birdsmouth \(seat .+″, heel 1 15\/16″\)$/);
  });
  it('is empty for an uncut part', () => {
    expect(describeCuts({ size })).toEqual({ ends: {}, notches: [], longPoint: false, label: '' });
  });
});

describe('partsOverlap', () => {
  const at = (x: number, y: number, z: number, rot = { x: 0, y: 0, z: 0 }, s: PartSize = { length: 100, width: 100, height: 100 }) => ({
    position: { x, y, z },
    rotation: rot,
    size: s,
  });

  it('agrees with boxesOverlap for uncut parts', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 300; i++) {
      const a = at(rnd() * 150, rnd() * 150, rnd() * 150, { x: rnd() * 90, y: rnd() * 90, z: rnd() * 90 });
      const b = at(rnd() * 150, rnd() * 150, rnd() * 150, { x: rnd() * 90, y: rnd() * 90, z: rnd() * 90 });
      const cutA = { ...a, cuts: { start: { slope: 0.000001 } } };
      expect(partsOverlap(a, b, 1)).toBe(boxesOverlap(partBox(a), partBox(b), 1));
      // The same box through the convex-piece path (a negligible cut) agrees too.
      expect(partsOverlap(cutA, b, 1)).toBe(boxesOverlap(partBox(a), partBox(b), 1));
    }
  });

  it('touching faces do not clash; 2 mm penetration does', () => {
    const a = { ...at(0, 0, 0), cuts: { end: { slope: -30 } } };
    expect(partsOverlap(a, at(0, 0, 100), 1)).toBe(false);
    expect(partsOverlap(a, at(0, 0, 98), 1)).toBe(true);
  });

  it('a box sitting in a birdsmouth seat does not clash; the uncut box would', () => {
    // Rafter along x with a rectangular notch 100 long, 40 deep, from the bottom.
    const rafter = at(0, 0, 0, undefined, { length: 1000, width: 38, height: 140 });
    const notched = { ...rafter, cuts: { notches: [{ kind: 'birdsmouth' as const, profile: [{ x: 400, z: -1 }, { x: 500, z: -1 }, { x: 500, z: 40 }, { x: 400, z: 40 }] }] } };
    const plate = at(400, -50, -100, undefined, { length: 100, width: 200, height: 140 }); // top at z = 40
    expect(partsOverlap(rafter, plate, 1)).toBe(true);
    expect(partsOverlap(notched, plate, 1)).toBe(false);
  });
});

describe('world helpers', () => {
  it('corners and AABB of a cut part drop the cut-away corner', () => {
    const part = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, size, cuts: { end: { slope: -theta } } };
    const aabb = partSolidAabb(part);
    expect(aabb.max.x).toBeCloseTo(size.length, 6);
    const corners = partSolidCorners(part);
    expect(corners.some((c) => Math.abs(c.x - size.length) < 1e-6 && Math.abs(c.z) < 1e-6)).toBe(false);
    const edges = partFeatureEdges(part);
    expect(edges).toHaveLength(12);
    const short = size.length - size.height * Math.tan(theta * RAD);
    expect(edges.some(([a, b]) => Math.abs(a.x - b.x - (a.x > b.x ? 1 : -1) * (size.length - short)) < 1e-6 && Math.abs(a.y - b.y) < 1e-9)).toBe(true);
  });
});
