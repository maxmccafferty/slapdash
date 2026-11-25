import { describe, expect, it } from 'vitest';
import { MAX_LABELS, flipRows, placeLabels, sheetLayout } from '../../src/renderer/snapshot/compose.ts';
import { fitSize, planSnapshot } from '../../src/renderer/snapshot/plan.ts';
import { zSnapshotRequest } from '../../src/renderer/snapshot/types.ts';
import { sampleProject } from './fixtures.ts';

describe('sheetLayout', () => {
  it('is a 2 × 2 grid: top and front, then right and 3D', () => {
    expect(sheetLayout(768)).toEqual([
      { id: 'top', caption: 'Top', rect: { x: 0, y: 0, w: 384, h: 384 } },
      { id: 'front', caption: 'Front (south)', rect: { x: 384, y: 0, w: 384, h: 384 } },
      { id: 'right', caption: 'Right (east)', rect: { x: 0, y: 384, w: 384, h: 384 } },
      { id: 'iso', caption: '3D', rect: { x: 384, y: 384, w: 384, h: 384 } },
    ]);
  });
});

describe('placeLabels', () => {
  const measure = (text: string) => ({ w: text.length * 8 + 8, h: 20 });
  const bounds = { x: 0, y: 0, w: 400, h: 400 };

  it('centres a label above its anchor', () => {
    const [l] = placeLabels([{ text: 'W1', x: 200, y: 200 }], measure, bounds);
    expect(l!.box).toEqual({ x: 188, y: 176, w: 24, h: 20 });
  });

  it('nudges overlapping labels apart', () => {
    const placed = placeLabels(
      [
        { text: 'W1-S01', x: 200, y: 200 },
        { text: 'W1-S02', x: 204, y: 200 },
        { text: 'W1-S03', x: 202, y: 201 },
      ],
      measure,
      bounds,
    );
    expect(placed).toHaveLength(3);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!.box;
        const b = placed[j]!.box;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });

  it('keeps labels inside the image and caps them at 40', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ text: `P${i}`, x: (i * 37) % 400, y: 30 + ((i * 53) % 360) }));
    const placed = placeLabels(many, measure, bounds);
    expect(placed.length).toBeLessThanOrEqual(MAX_LABELS);
    for (const l of placed) {
      expect(l.box.x).toBeGreaterThanOrEqual(0);
      expect(l.box.y).toBeGreaterThanOrEqual(0);
      expect(l.box.x + l.box.w).toBeLessThanOrEqual(400);
      expect(l.box.y + l.box.h).toBeLessThanOrEqual(400);
    }
  });
});

describe('flipRows', () => {
  it('turns bottom-up WebGL rows into top-down image rows', () => {
    const px = new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2]); // 1 × 2: bottom row 1, top row 2
    expect([...flipRows(px, 1, 2)]).toEqual([2, 2, 2, 2, 1, 1, 1, 1]);
  });
});

describe('planSnapshot', () => {
  const project = sampleProject();
  it('the default sheet is 768 × 768 with four cameras (three ortho, one perspective)', () => {
    const plan = planSnapshot(zSnapshotRequest.parse({}), project);
    expect([plan.width, plan.height]).toEqual([768, 768]);
    expect(plan.tiles.map((t) => t.camera.kind)).toEqual(['ortho', 'ortho', 'ortho', 'perspective']);
    expect(plan.tiles.map((t) => t.north)).toEqual([true, false, false, false]);
  });

  it('a single angle has its long edge at `size`', () => {
    const plan = planSnapshot(zSnapshotRequest.parse({ angle: 'front', size: 1024 }), project);
    expect(Math.max(plan.width, plan.height)).toBe(1024);
    expect(plan.tiles).toHaveLength(1);
    expect(plan.tiles[0]!.caption).toBeNull();
  });

  it('frames a part from the iso direction', () => {
    const plan = planSnapshot(zSnapshotRequest.parse({ angle: { frame: 'W3-H01' } }), project);
    expect(plan.angle).toBe('frame W3-H01');
    expect(plan.tiles[0]!.camera.kind).toBe('perspective');
  });

  it('fitSize keeps the aspect', () => {
    expect(fitSize(768, 4 / 3)).toEqual({ width: 768, height: 576 });
    expect(fitSize(768, 3 / 4)).toEqual({ width: 576, height: 768 });
  });
});
