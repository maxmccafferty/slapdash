import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import type { Aabb } from '@slapdash/core';
import { aabbCorners, distanceLimits, fitBounds, orthoFrame, presetDirection, upFor, viewAspect, zoomPercent, type PresetAngle } from '../../src/renderer/camera.ts';
import { framingBounds } from '../../src/renderer/bounds.ts';
import { aabbToM } from '../../src/renderer/units.ts';
import { sampleProject } from './fixtures.ts';

const box: Aabb = aabbToM(framingBounds(sampleProject()));
const ANGLES: PresetAngle[] = ['top', 'front', 'back', 'left', 'right', 'iso'];

describe('presetDirection', () => {
  it('looks from the named side (north is −z)', () => {
    expect(presetDirection('front')).toEqual({ x: 0, y: 0, z: 1 });
    expect(presetDirection('back')).toEqual({ x: 0, y: 0, z: -1 });
    expect(presetDirection('left')).toEqual({ x: -1, y: 0, z: 0 });
    expect(presetDirection('right')).toEqual({ x: 1, y: 0, z: 0 });
    expect(presetDirection('top').y).toBe(1);
    const iso = presetDirection('iso');
    expect(iso.x).toBeGreaterThan(0); // from the east…
    expect(iso.z).toBeGreaterThan(0); // …and the south
    expect(iso.y).toBeGreaterThan(0); // above
  });

  it('keeps north up in the top view', () => {
    expect(upFor(presetDirection('top'))).toEqual({ x: 0, y: 0, z: -1 });
    expect(upFor(presetDirection('front'))).toEqual({ x: 0, y: 1, z: 0 });
  });
});

describe('fitBounds', () => {
  for (const angle of ANGLES) {
    for (const aspect of [0.5, 1, 16 / 9]) {
      it(`keeps all eight corners in the frustum (${angle}, aspect ${aspect.toFixed(2)})`, () => {
        const dir = presetDirection(angle);
        const fit = fitBounds(box, dir, 35, aspect);
        const cam = new PerspectiveCamera(35, aspect, 0.01, 1000);
        cam.position.set(fit.position.x, fit.position.y, fit.position.z);
        const up = upFor(dir);
        cam.up.set(up.x, up.y, up.z);
        cam.lookAt(fit.target.x, fit.target.y, fit.target.z);
        cam.updateMatrixWorld();
        for (const c of aabbCorners(box)) {
          const v = new Vector3(c.x, c.y, c.z).project(cam);
          expect(Math.abs(v.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(v.y)).toBeLessThanOrEqual(1);
          expect(v.z).toBeLessThan(1);
        }
      });
    }
  }
});

describe('orthoFrame', () => {
  it('contains the box and matches the aspect', () => {
    for (const angle of ANGLES) {
      const f = orthoFrame(box, presetDirection(angle), 4 / 3);
      expect((f.right - f.left) / (f.top - f.bottom)).toBeCloseTo(4 / 3, 6);
      expect(f.right).toBeGreaterThan(0);
    }
    const top = orthoFrame(box, presetDirection('top'), 1, 0);
    // Seen from above, the frame's half-width covers half the larger plan side.
    expect(top.right).toBeCloseTo(Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2, 6);
  });

  it('viewAspect is clamped to 3:4 … 4:3', () => {
    for (const angle of ANGLES) {
      const a = viewAspect(box, presetDirection(angle));
      expect(a).toBeGreaterThanOrEqual(0.75);
      expect(a).toBeLessThanOrEqual(4 / 3);
    }
  });
});

describe('zoom readout', () => {
  it('is 100% at the fitted distance, more when closer', () => {
    expect(zoomPercent(20, 20)).toBe(100);
    expect(zoomPercent(10, 20)).toBe(200);
    expect(zoomPercent(40, 20)).toBe(50);
    expect(zoomPercent(0, 20)).toBe(100);
  });

  it('distance limits bracket the fit', () => {
    const { min, max } = distanceLimits(20);
    expect(min).toBeLessThan(20);
    expect(max).toBeGreaterThan(20);
  });
});
