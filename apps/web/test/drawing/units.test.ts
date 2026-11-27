/** Window and door units on the 2D sheet, drawn from their parts (LOC-124). */
import { describe, expect, it } from 'vitest';
import { CommandBus, createProject, formatErrors } from '@slapdash/core';
import { CATALOG } from '@slapdash/catalog';
import { readOpening, readWall, wallFrame } from '../../src/model/recipes.ts';
import { buildSheet } from '../../src/drawing/sheet.ts';
import type { ArcShape, DrawingView, Sheet } from '../../src/drawing/types.ts';
import { sampleProject } from '../renderer/fixtures.ts';

const view = (sheet: Sheet, id: string): DrawingView => sheet.views.find((x) => x.id === id)!;
const ids = (v: DrawingView) => v.shapes.map((s) => ('id' in s ? s.id : undefined)).filter((x): x is string => x !== undefined);

describe('units on the sheet', () => {
  const project = sampleProject();
  const sheet = buildSheet(project, { floor: 'roof', dimensions: false });

  it('the elevation outlines the frame and draws the sash pieces', () => {
    const east = view(sheet, 'east');
    const frame = Object.values(project.parts).filter((p) => p.assemblyId === 'O2' && p.role === 'frame').map((p) => `unit:${p.id}`);
    const sash = Object.values(project.parts).filter((p) => p.assemblyId === 'O2' && p.role === 'sash').map((p) => `unit:${p.id}`);
    expect(frame.length).toBeGreaterThanOrEqual(4);
    expect(sash.length).toBeGreaterThanOrEqual(4);
    for (const id of frame) expect(east.shapes.find((s) => 'id' in s && s.id === id)).toMatchObject({ type: 'poly', style: 'outline' });
    for (const id of sash) expect(east.shapes.find((s) => 'id' in s && s.id === id)).toMatchObject({ type: 'poly', style: 'symbol' });
    // No glass edges, and the rough opening is still there.
    const glass = Object.values(project.parts).filter((p) => p.assemblyId === 'O2' && p.role === 'glass');
    for (const g of glass) expect(ids(east)).not.toContain(`unit:${g.id}`);
    expect(ids(east)).toContain('ro:O2');
  });

  it('the sliding door has a slide arrow in elevation and plan', () => {
    expect(ids(view(sheet, 'south')).some((id) => id.startsWith('slide:O1:'))).toBe(true);
    expect(ids(view(sheet, 'plan')).some((id) => id.startsWith('slide:O1:'))).toBe(true);
    expect(ids(view(sheet, 'plan')).filter((id) => id.startsWith('sash:O1:'))).toHaveLength(2);
  });

  it('a door swings from its hinge side, with a chevron in elevation', () => {
    const bus = new CommandBus({ project: createProject({ name: 'Door' }), catalog: CATALOG });
    for (const [name, input] of [
      ['pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }],
      ['build_wall', { start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '9ft', name: 'North wall' }],
      ['add_opening', { wallId: 'W1', kind: 'door', centerAt: '8ft', product: 'door-entry' }],
    ] as const) {
      const res = bus.execute(name, input);
      if (!res.ok) throw new Error(formatErrors(res.errors));
    }
    const p = bus.project;
    const s = buildSheet(p, { floor: 'roof', dimensions: false });
    const arc = view(s, 'plan').shapes.find((x): x is ArcShape => x.type === 'arc' && x.id === 'swing:O1:0:start');
    expect(arc).toBeDefined();
    // The hinge is at the start side of the opening: nearer the wall's start than its end.
    const o = readOpening(p.assemblies.O1)!;
    const wall = readWall(p.assemblies.W1)!;
    const f = wallFrame(wall)!;
    const u = (pt: { x: number; y: number }) => (pt.x - wall.start.x) * f.u.x + (pt.y - wall.start.z) * f.u.z;
    expect(u(arc!.center)).toBeLessThan(o.at + o.width / 2);
    expect(u(arc!.to)).toBeGreaterThan(o.at + o.width / 2);
    expect(ids(view(s, 'north')).filter((id) => id.startsWith('swing:O1:0:'))).toHaveLength(2);
  });
});
