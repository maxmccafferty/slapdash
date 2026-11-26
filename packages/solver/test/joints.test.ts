import type { Joint } from '@slapdash/core';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/index.ts';
import { UPLIFT_PUBLISHED_CD, checkJoint, jointCapacity, resolveJointForce } from '../src/checks/joints.ts';
import { INDEX, handProject, SECTION } from './helpers.ts';

const type = (id: string) => INDEX.jointTypes.get(id)!;
const joint = (over: Partial<Joint> = {}): Joint => ({
  id: 'J0001',
  jointTypeId: 'nailed-16d',
  partIds: ['A', 'B'],
  at: { x: 0, y: 0, z: 0 },
  fastenerCount: 3,
  ...over,
});

/**
 * One 2x12 rafter, level, 24 in o.c. in a roof with no sheathing: its heel sits on a
 * plate (anchored to the ground, its centreline under the heel) through `heel`, its top end on the ground. Roof
 * suction lifts it.
 */
function rafterOnPlate(heel: { jointTypeId: string; fastenerCount: number }, length: number, windSpeed?: number) {
  const [b, h] = SECTION['2x12'];
  const p = handProject(
    [
      {
        id: 'R1-R01',
        role: 'rafter',
        materialId: 'spf-no2',
        sectionId: '2x12',
        assemblyId: 'R1',
        position: { x: 0, y: 38.1 + h, z: 0 },
        rotation: { x: 90, y: 0, z: 0 },
        size: { length, width: b, height: h },
      },
      { id: 'W1-P01', role: 'plate', materialId: 'spf-no2', sectionId: '2x4', assemblyId: 'W1', position: { x: 88.9, y: 0, z: -400 }, rotation: { x: 0, y: -90, z: 0 }, size: { length: 800, width: 38.1, height: 88.9 }, tags: ['top-cap'] },
    ],
    [
      { id: 'J0001', ...heel, partIds: ['R1-R01', 'W1-P01'], at: { x: 44.45, y: 38.1, z: b / 2 } },
      { id: 'J0002', jointTypeId: 'nailed-16d', partIds: ['R1-R01', 'GROUND'], at: { x: length, y: 38.1 + h / 2, z: b / 2 }, fastenerCount: 3 },
      { id: 'J0003', jointTypeId: 'anchor-bolt', partIds: ['W1-P01', 'GROUND'], at: { x: 44.45, y: 19.05, z: -300 } },
      { id: 'J0004', jointTypeId: 'anchor-bolt', partIds: ['W1-P01', 'GROUND'], at: { x: 44.45, y: 19.05, z: 300 } },
    ],
    { R1: { kind: 'roof', params: { spacing: '24in' } }, W1: { kind: 'wall' } },
  );
  if (windSpeed) p.site.designLoads.windSpeed = { value: windSpeed, unit: 'm/s', source: 'test' };
  return analyze(p, INDEX, { cases: ['D', 'W+x'] });
}

describe('joint capacity', () => {
  it('per-fastener capacities multiply by the fastener count and scale with CD for nails', () => {
    const cap = jointCapacity(joint({ fastenerCount: 3 }), type('nailed-16d'), 1.6);
    expect(cap.shear).toBeCloseTo(534 * 3 * 1.6, 6);
    expect(cap.withdrawal).toBeCloseTo(231 * 3 * 1.6, 6);
    expect(cap.uplift).toBeUndefined();
  });

  it('per-joint capacities ignore the count; uplift (published at 160%) scales by CD/1.6', () => {
    const cap = jointCapacity(joint({ jointTypeId: 'hurricane-tie', fastenerCount: 4 }), type('hurricane-tie'), 1.15);
    expect(cap.shear).toBe(489);
    expect(cap.uplift).toBeCloseTo((2736 * 1.15) / UPLIFT_PUBLISHED_CD, 6);
    expect(cap.withdrawal).toBeUndefined();
  });

  it('capacityOverride wins field by field', () => {
    const cap = jointCapacity(joint({ fastenerCount: 2, capacityOverride: { withdrawal_N: 100, uplift_N: 1600 } }), type('nailed-16d'), 1.0);
    expect(cap.shear).toBeCloseTo(534 * 2, 6);
    expect(cap.withdrawal).toBeCloseTo(200, 6);
    expect(cap.uplift).toBeCloseTo(2000, 6);
  });

  it('resolves a force into withdrawal, shear and uplift', () => {
    // On the first part, pulled down (−y) by a joint whose normal points down: withdrawal and uplift.
    const f = resolveJointForce([30, -400, 0], [0, -1, 0]);
    expect(f.withdrawal).toBeCloseTo(400, 9);
    expect(f.uplift).toBeCloseTo(400, 9);
    expect(f.shear).toBeCloseTo(30, 9);
    // Bearing (pushed up onto it) is neither.
    expect(resolveJointForce([0, 400, 0], [0, -1, 0]).withdrawal).toBe(0);
    expect(checkJoint({ shear: 10, withdrawal: 50, uplift: 0 }, { shear: 100 }).check).toBe('joint-shear');
  });
});

describe('uplift at the heel (ADR-0002 §E5: the toenailed rafter goes red)', () => {
  it('toenails alone: the joint fails in withdrawal while the rafter is fine', () => {
    const r = rafterOnPlate({ jointTypeId: 'nailed-16d', fastenerCount: 3 }, 7000);
    expect(r.joints.J0001!.utilization).toBeGreaterThan(1);
    expect(r.joints.J0001!.governing!.check).toBe('joint-withdrawal');
    expect(r.parts['R1-R01']!.utilization).toBeLessThan(1);
  });

  it('an H2.5A hurricane tie past its rating: the joint fails in uplift while the rafter is fine', () => {
    const r = rafterOnPlate({ jointTypeId: 'hurricane-tie', fastenerCount: 1 }, 6500, 80);
    expect(r.joints.J0001!.utilization).toBeGreaterThan(1);
    expect(r.joints.J0001!.governing!.check).toBe('joint-uplift');
    expect(r.parts['R1-R01']!.utilization).toBeLessThan(1);
  });

  it('a withdrawal demand with no catalog value is noted, not checked', () => {
    const r = rafterOnPlate({ jointTypeId: 'bolted-through', fastenerCount: 2 }, 7000);
    expect(r.joints.J0001!.notes.join(' ')).toMatch(/withdrawal isn't checked/);
    expect(r.joints.J0001!.capacity_N.withdrawal).toBeUndefined();
  });
});
