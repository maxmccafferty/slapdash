/**
 * The 2D sheet's acceptance test on the pool-house shell: the plan, four elevations,
 * footprint, wall and ridge heights, wall lengths, openings and roof pitch, laid out around
 * the plan, and the Floors and Dimensions controls.
 */
import { describe, expect, it } from 'vitest';
import { createProject } from '@slapdash/core';
import { readOpening, readWall, wallFrame } from '../../src/model/recipes.ts';
import { buildSheet, EMPTY_CAPTION } from '../../src/drawing/sheet.ts';
import { translateBox, type Box2 } from '../../src/drawing/geometry.ts';
import type { DrawingView, PolyShape, Sheet } from '../../src/drawing/types.ts';
import { VIEWS } from '../../src/drawing/views.ts';
import { INSIDE_CUT_HEIGHT_MM } from '../../src/renderer/visibility.ts';
import { sampleProject } from '../renderer/fixtures.ts';

const project = sampleProject();
const full = buildSheet(project, { floor: 'roof', dimensions: true });
const view = (sheet: Sheet, id: string): DrawingView => {
  const v = sheet.views.find((x) => x.id === id);
  if (!v) throw new Error(`no ${id} view`);
  return v;
};
const dim = (sheet: Sheet, viewId: string, id: string) => view(sheet, viewId).dims.find((d) => d.id === id);
const sheetBounds = (v: DrawingView): Box2 => translateBox(v.localBounds, v.offset);
const polys = (v: DrawingView) => v.shapes.filter((s): s is PolyShape => s.type === 'poly');
const ELEVATIONS = ['north', 'south', 'east', 'west'] as const;

describe('the pool-house sheet', () => {
  it('has the plan and four elevations, titled', () => {
    expect(full.empty).toBe(false);
    expect(full.views.map((v) => v.id).sort()).toEqual(['east', 'north', 'plan', 'south', 'west']);
    expect(view(full, 'plan').title).toBe('Plan at 4′ 0″');
    expect(ELEVATIONS.map((id) => view(full, id).title)).toEqual(['North', 'South', 'East', 'West']);
  });

  it('states the footprint under the plan', () => {
    expect(view(full, 'plan').subtitle).toBe('Footprint 20′ 0″ × 16′ 0″');
  });

  it('dimensions every wall length outside its wall', () => {
    expect(['W1', 'W2', 'W3', 'W4'].map((w) => dim(full, 'plan', `wall-length-${w}`)?.label)).toEqual(['20′ 0″', '16′ 0″', '20′ 0″', '16′ 0″']);
    // The south wall's dimension sits south of it: down the sheet (+z).
    expect(dim(full, 'plan', 'wall-length-W3')!.offset.y).toBeGreaterThan(0);
    expect(dim(full, 'plan', 'wall-length-W1')!.offset.y).toBeLessThan(0);
    expect(dim(full, 'plan', 'wall-length-W2')!.offset.x).toBeGreaterThan(0);
    expect(dim(full, 'plan', 'wall-length-W4')!.offset.x).toBeLessThan(0);
  });

  it('dimensions the wall height and the ridge height on every elevation', () => {
    for (const id of ELEVATIONS) {
      expect(dim(full, id, `wall-height-${id}`)?.label).toBe('9′ 0″');
      expect(dim(full, id, `ridge-height-${id}`)?.label).toBe('13′ 6″');
    }
  });

  it('dimensions the openings in plan and draws them on the elevations that face them', () => {
    expect(dim(full, 'plan', 'opening-O1')?.label).toBe('6′ 0″');
    expect(dim(full, 'plan', 'opening-O2')?.label).toBe('3′ 0″');
    expect(polys(view(full, 'south')).some((s) => s.id === 'ro:O1')).toBe(true);
    expect(polys(view(full, 'east')).some((s) => s.id === 'ro:O2')).toBe(true);
    expect(polys(view(full, 'north')).some((s) => s.id?.startsWith('ro:'))).toBe(false);
    expect(view(full, 'south').marks.some((m) => m.id === 'opening-size-O1')).toBe(true);
  });

  it('leaves a gap in the cut wall at each opening that spans 4′ 0″', () => {
    const plan = view(full, 'plan');
    for (const [wallId, openingId] of [
      ['W3', 'O1'],
      ['W2', 'O2'],
    ] as const) {
      const wall = readWall(project.assemblies[wallId])!;
      const f = wallFrame(wall)!;
      const o = readOpening(project.assemblies[openingId])!;
      const rel = INSIDE_CUT_HEIGHT_MM - wall.baseElevation;
      const spans = o.roBottom <= rel && rel <= o.roTop;
      // Each cut polygon's extent along the wall.
      const along = polys(plan)
        .filter((s) => s.id === `cut:${wallId}`)
        .map((s) => {
          const us = s.points.map((p) => (p.x - wall.start.x) * f.u.x + (p.y - wall.start.z) * f.u.z);
          return [Math.min(...us), Math.max(...us)] as const;
        });
      expect(along.length).toBeGreaterThan(0);
      const covers = (u: number) => along.some(([a, b]) => a - 1e-6 <= u && u <= b + 1e-6);
      expect(covers(o.at / 2)).toBe(true);
      expect(covers((o.at + o.width + wall.length) / 2)).toBe(true);
      expect(covers(o.at + o.width / 2)).toBe(!spans);
    }
  });

  it('puts the 6 in 12 pitch on the gable ends (East and West) only', () => {
    for (const id of ['east', 'west'] as const) {
      const mark = view(full, id).marks.find((m) => m.id === `pitch-${id}`);
      expect(mark?.shapes.some((s) => s.type === 'text' && s.text === '6 in 12')).toBe(true);
    }
    for (const id of ['north', 'south'] as const) expect(view(full, id).marks.some((m) => m.kind === 'pitch')).toBe(false);
  });

  it('lays out North above the plan, South below, West left and East right, with a north arrow', () => {
    const plan = sheetBounds(view(full, 'plan'));
    expect(sheetBounds(view(full, 'north')).maxY).toBeLessThan(plan.minY);
    expect(sheetBounds(view(full, 'south')).minY).toBeGreaterThan(plan.maxY);
    expect(sheetBounds(view(full, 'west')).maxX).toBeLessThan(plan.minX);
    expect(sheetBounds(view(full, 'east')).minX).toBeGreaterThan(plan.maxX);
    expect(full.northArrow).not.toBeNull();
    // Everything is on the sheet.
    for (const v of full.views) {
      const b = sheetBounds(v);
      expect(b.minX).toBeGreaterThanOrEqual(full.viewBox.minX);
      expect(b.maxY).toBeLessThanOrEqual(full.viewBox.maxY);
    }
  });

  it('draws elevations as seen from outside', () => {
    const p = (x: number) => ({ x, y: 0, z: 0 });
    // North: east (x = 20 ft) is on the left.
    expect(VIEWS.north.project(p(6096)).x).toBeLessThan(VIEWS.north.project(p(0)).x);
    // East: north (−z) is on the right.
    expect(VIEWS.east.project({ x: 0, y: 0, z: 0 }).x).toBeGreaterThan(VIEWS.east.project({ x: 0, y: 0, z: 4876.8 }).x);
    // South: east on the right; up is up.
    expect(VIEWS.south.project(p(6096)).x).toBeGreaterThan(VIEWS.south.project(p(0)).x);
    expect(VIEWS.south.project({ x: 0, y: 1000, z: 0 }).y).toBeLessThan(0);
  });

  it('shows the roof overhead in plan, dashed, with its ridge', () => {
    const plan = view(full, 'plan');
    expect(plan.shapes.some((s) => s.id === 'roof:R1' && s.type === 'poly' && s.style === 'overhead')).toBe(true);
    expect(plan.shapes.some((s) => s.id === 'ridge:R1' && s.type === 'line' && s.style === 'overhead')).toBe(true);
  });
});

describe('the view controls', () => {
  it('Dimensions Off drops the dimensions, the pitch and the opening sizes', () => {
    const sheet = buildSheet(project, { floor: 'roof', dimensions: false });
    for (const v of sheet.views) {
      expect(v.dims).toEqual([]);
      expect(v.marks).toEqual([]);
    }
    expect(polys(view(sheet, 'south')).some((s) => s.id === 'ro:O1')).toBe(true);
  });

  it('Floor 1 drops the roof, the ridge and the pitch', () => {
    const sheet = buildSheet(project, { floor: 'floor-1', dimensions: true });
    for (const v of sheet.views) {
      expect(v.shapes.some((s) => s.type !== 'text' && s.assemblyId === 'R1')).toBe(false);
      expect(v.dims.some((d) => d.kind === 'ridge-height')).toBe(false);
      expect(v.marks.some((m) => m.kind === 'pitch')).toBe(false);
    }
    expect(dim(sheet, 'south', 'wall-height-south')?.label).toBe('9′ 0″');
  });

  it('Foundation shows only the slab: no cut walls', () => {
    const sheet = buildSheet(project, { floor: 'foundation', dimensions: true });
    const plan = view(sheet, 'plan');
    expect(plan.shapes.some((s) => s.type !== 'text' && s.style === 'cut')).toBe(false);
    expect(plan.shapes.some((s) => s.id === 'plan:FD1')).toBe(true);
    expect(plan.subtitle).toBe('Footprint 20′ 0″ × 16′ 0″');
  });
});

describe('edge cases', () => {
  it('an empty project gets the grid and a caption', () => {
    const sheet = buildSheet(createProject({ name: 'Empty' }), { floor: 'roof', dimensions: true });
    expect(sheet.empty).toBe(true);
    expect(sheet.views).toEqual([]);
    expect(sheet.caption?.text).toBe(EMPTY_CAPTION);
    expect(buildSheet(null, { floor: 'roof', dimensions: true }).caption?.text).toBe(EMPTY_CAPTION);
  });

  it('is memoised per project and options', () => {
    expect(buildSheet(project, { floor: 'roof', dimensions: true })).toBe(full);
    expect(buildSheet(project, { floor: 'roof', dimensions: false })).not.toBe(full);
  });

  it('describes itself for screen readers', () => {
    expect(full.description).toBe('2D drawing: plan at 4′ 0″ with north, south, west and east elevations of Pool house.');
  });
});
