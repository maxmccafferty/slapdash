/**
 * The builders run on the tier-1 catalog: every default id exists, and the core
 * acceptance shell (packages/core/test/builders/shell.acceptance.test.ts) builds cleanly.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILDER_DEFAULTS,
  CommandBus,
  HEADER_TABLE,
  createProject,
  findAllClashes,
  formatErrors,
  indexCatalog,
} from '@slapdash/core';
import { TIER1_CATALOG } from '../src/index.ts';

const idx = indexCatalog(TIER1_CATALOG);

describe('builders on the tier-1 catalog', () => {
  it('has every BUILDER_DEFAULTS material, section and joint type', () => {
    for (const id of Object.values(BUILDER_DEFAULTS.materials)) expect(idx.materials.has(id), id).toBe(true);
    for (const id of Object.values(BUILDER_DEFAULTS.sections)) expect(idx.sections.has(id), id).toBe(true);
    for (const id of Object.values(BUILDER_DEFAULTS.jointTypes)) expect(idx.jointTypes.has(id), id).toBe(true);
  });

  it('has every header section the header table can pick', () => {
    const ids = new Set(Object.values(HEADER_TABLE).flatMap((rows) => rows.map((row) => row.sectionId)));
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) expect(idx.sections.has(id), id).toBe(true);
  });

  describe('the 16 × 20 pool-house shell', () => {
    let n = 0;
    const bus = new CommandBus({ project: createProject({ name: 'Pool house' }), catalog: TIER1_CATALOG, now: () => ++n });
    const exec = (name: string, input: unknown) => {
      const res = bus.execute(name, input);
      if (!res.ok) throw new Error(`${name}: ${formatErrors(res.errors)}`);
    };
    bus.group({ label: 'Build the pool house shell', source: 'claude', turnId: 't1' }, () => {
      exec('pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } });
      exec('build_wall', { start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '9ft', name: 'North wall' });
      exec('build_wall', { start: { x: '20ft', z: 0 }, end: { x: '20ft', z: '16ft' }, height: '9ft', name: 'East wall' });
      exec('build_wall', { start: { x: '20ft', z: '16ft' }, end: { x: 0, z: '16ft' }, height: '9ft', name: 'South wall' });
      exec('build_wall', { start: { x: 0, z: '16ft' }, end: { x: 0, z: 0 }, height: '9ft', name: 'West wall' });
      exec('add_opening', { wallId: 'W3', kind: 'sliding-door', centerAt: '10ft' });
      exec('add_opening', { wallId: 'W2', kind: 'window', centerAt: '8ft' });
      exec('build_roof', { type: 'gable', from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' }, pitch: '6 in 12', ridgeAxis: 'x' });
    });
    const p = bus.project;

    it('builds with nothing running through anything', () => {
      expect(Object.keys(p.parts).length).toBeGreaterThan(100);
      expect(findAllClashes(p)).toEqual([]);
    });

    it('each opening gets a generic window/door unit', () => {
      const units = Object.values(p.parts).filter((x) => x.materialId === 'opening-unit');
      expect(units.map((u) => u.assemblyId).sort()).toEqual(['O1', 'O2']);
    });
  });
});
