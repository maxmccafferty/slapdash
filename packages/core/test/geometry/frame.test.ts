import { describe, expect, it } from 'vitest';
import { boxInFrame, placeMember, toFrame, toWorld, type PlanFrame } from '../../src/geometry/frame.ts';
import { aabbOf, partBox } from '../../src/geometry/obb.ts';

const stud = { u0: 406.4, u1: 444.5, v0: 38.1, v1: 2667, w0: 0, w1: 88.9 };

describe('plan frames', () => {
  it('a vertical stud in an east-running wall (exterior north)', () => {
    const f: PlanFrame = { origin: { x: 0, y: 101.6, z: 0 }, angleDeg: 0, wSign: 1 };
    const placed = placeMember(f, stud, 'v', 'u');
    expect(placed.rotation).toEqual({ x: 0, y: 0, z: 90 });
    expect(placed.size).toEqual({ length: 2628.9, width: 38.1, height: 88.9 });
    const bb = aabbOf(partBox(placed));
    expect(bb.min.x).toBeCloseTo(406.4);
    expect(bb.max.x).toBeCloseTo(444.5);
    expect(bb.min.y).toBeCloseTo(139.7);
    expect(bb.max.y).toBeCloseTo(2768.6);
    expect(bb.min.z).toBeCloseTo(0);
    expect(bb.max.z).toBeCloseTo(88.9);
  });

  it('a vertical stud in a north-running wall (exterior west)', () => {
    // Walking north (−z) with the exterior on the left (west): inward is +x.
    const f: PlanFrame = { origin: { x: 0, y: 0, z: 4876.8 }, angleDeg: -90, wSign: 1 };
    const bb = aabbOf(partBox(placeMember(f, stud, 'v', 'u')));
    expect(bb.min.x).toBeCloseTo(0);
    expect(bb.max.x).toBeCloseTo(88.9);
    expect(bb.min.z).toBeCloseTo(4876.8 - 444.5);
    expect(bb.max.z).toBeCloseTo(4876.8 - 406.4);
  });

  it('round-trips points and boxes, and keeps positions clean', () => {
    const f: PlanFrame = { origin: { x: 100, y: 0, z: 200 }, angleDeg: 45, wSign: -1 };
    const p = { u: 1000, v: 50, w: -30 };
    const back = toFrame(f, toWorld(f, p));
    expect(back.u).toBeCloseTo(1000);
    expect(back.v).toBeCloseTo(50);
    expect(back.w).toBeCloseTo(-30);
    const placed = placeMember(f, stud, 'v', 'u');
    for (const n of Object.values(placed.position)) expect(Number(n.toFixed(6))).toBe(n);
    const b = boxInFrame(f, placed);
    expect(b.u0).toBeCloseTo(stud.u0, 3);
    expect(b.w1).toBeCloseTo(stud.w1, 3);
    expect(b.v1).toBeCloseTo(stud.v1, 3);
  });

  it('a plate runs along the wall with its section on the flat', () => {
    const f: PlanFrame = { origin: { x: 0, y: 0, z: 0 }, angleDeg: 0, wSign: 1 };
    const placed = placeMember(f, { u0: 0, u1: 6096, v0: 0, v1: 38.1, w0: 0, w1: 88.9 }, 'u', 'v');
    expect(placed.size).toEqual({ length: 6096, width: 38.1, height: 88.9 });
    const bb = aabbOf(partBox(placed));
    expect(bb.max.y).toBeCloseTo(38.1);
    expect(bb.max.z).toBeCloseTo(88.9);
  });
});
