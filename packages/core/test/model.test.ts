import { describe, expect, it } from 'vitest';
import {
  ASSEMBLY_ID,
  JOINT_ID,
  KPA_PER_PSF,
  MS_PER_MPH,
  PART_ID,
  createProject,
  formatLoad,
  jointBehaviour,
  jointCapacity,
  jointsForPart,
  mergeCounters,
  migrateProject,
  nextAssemblyId,
  nextJointId,
  nextPartId,
  parseDesignLoad,
  partsInAssembly,
  reserveId,
  resolveDesignLoads,
  type IdCounters,
  type Joint,
} from '../src/index.ts';
import { catalog, fixtureProject } from './helpers.ts';

const empty = (): IdCounters => ({ assemblies: {}, parts: {}, joints: 0 });

describe('createProject', () => {
  it('starts with one ground level and nothing else', () => {
    const p = createProject({ name: 'Shed' });
    expect(p).toEqual({
      schemaVersion: 1,
      name: 'Shed',
      units: { display: 'imperial' },
      levels: [{ id: 'L0', name: 'Ground', elevation_mm: 0 }],
      assemblies: {},
      parts: {},
      joints: {},
      site: { designLoads: {} },
      counters: { assemblies: {}, parts: {}, joints: 0 },
    });
  });

  it('round-trips through migrateProject', () => {
    const p = fixtureProject();
    expect(migrateProject(JSON.parse(JSON.stringify(p)))).toEqual({ ok: true, project: p });
    expect(migrateProject({ ...p, schemaVersion: 2 })).toEqual({
      ok: false,
      errors: ['This project is version 2; this app understands up to 1.'],
    });
  });
});

describe('ids', () => {
  it('allocates assembly ids per kind', () => {
    let c = empty();
    const a = nextAssemblyId(c, 'wall');
    c = a.counters;
    const b = nextAssemblyId(c, 'wall');
    const r = nextAssemblyId(b.counters, 'roof');
    const fd = nextAssemblyId(b.counters, 'foundation');
    expect([a.id, b.id, r.id, fd.id]).toEqual(['W1', 'W2', 'R1', 'FD1']);
  });

  it('pads part numbers to two digits and joints to four', () => {
    let c = empty();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const n = nextPartId(c, 'W2', 'stud');
      ids.push(n.id);
      c = n.counters;
    }
    expect(ids[0]).toBe('W2-S01');
    expect(ids[9]).toBe('W2-S10');
    expect(nextPartId(c, 'W2', 'sill').id).toBe('W2-SL01');
    expect(nextJointId(c).id).toBe('J0001');
  });

  it('skips ids that are taken', () => {
    expect(nextPartId(empty(), 'W1', 'stud', (id) => id === 'W1-S01').id).toBe('W1-S02');
  });

  it('reserveId only moves counters forward', () => {
    let c = reserveId(empty(), 'part', 'W1-S05');
    expect(nextPartId(c, 'W1', 'stud').id).toBe('W1-S06');
    c = reserveId(c, 'part', 'W1-S02');
    expect(c.parts['W1-S']).toBe(5);
    expect(reserveId(empty(), 'joint', 'J0042').joints).toBe(42);
    expect(reserveId(empty(), 'assembly', 'W7').assemblies.W).toBe(7);
  });

  it('mergeCounters takes the max per key', () => {
    expect(
      mergeCounters({ assemblies: { W: 2 }, parts: { 'W1-S': 3 }, joints: 4 }, { assemblies: { W: 1, R: 1 }, parts: { 'W1-S': 5 }, joints: 2 }),
    ).toEqual({ assemblies: { W: 2, R: 1 }, parts: { 'W1-S': 5 }, joints: 4 });
  });

  it('regexes accept readable ids and reject others', () => {
    expect(ASSEMBLY_ID.test('W2')).toBe(true);
    expect(ASSEMBLY_ID.test('FD10')).toBe(true);
    expect(ASSEMBLY_ID.test('w2')).toBe(false);
    expect(PART_ID.test('W2-S07')).toBe(true);
    expect(PART_ID.test('W2-SL101')).toBe(true);
    expect(PART_ID.test('W2-S7')).toBe(false);
    expect(JOINT_ID.test('J0001')).toBe(true);
    expect(JOINT_ID.test('J12345')).toBe(true);
    expect(JOINT_ID.test('J01')).toBe(false);
  });
});

describe('queries', () => {
  it('finds parts and joints', () => {
    const p = fixtureProject();
    expect(partsInAssembly(p, 'W1').map((x) => x.id)).toEqual(['W1-S01', 'W1-S02', 'W1-P01']);
    expect(jointsForPart(p, 'W1-S01').map((j) => j.id)).toEqual(['J0001']);
  });

  it('derives behaviour and capacity from the catalog', () => {
    const nailed: Joint = {
      id: 'J0001',
      jointTypeId: 'nailed-16d',
      partIds: ['A1-S01', 'A1-S02'],
      at: { x: 0, y: 0, z: 0 },
      fastenerCount: 3,
    };
    expect(jointBehaviour(nailed, catalog)).toBe('pinned');
    expect(jointCapacity(nailed, catalog)).toEqual({ shear_N: 1800, withdrawal_N: 600 });

    const embedded: Joint = { ...nailed, jointTypeId: 'post-embedded', fastenerCount: 4 };
    expect(jointBehaviour(embedded, catalog)).toBe('fixed');
    expect(jointCapacity(embedded, catalog)).toEqual({ shear_N: 8000, withdrawal_N: 6000 });

    const overridden: Joint = { ...nailed, capacityOverride: { shear_N: 999, uplift_N: 10 } };
    expect(jointCapacity(overridden, catalog)).toEqual({ shear_N: 999, withdrawal_N: 600, uplift_N: 10 });

    expect(jointCapacity({ ...nailed, jointTypeId: 'nope' }, catalog)).toBeUndefined();
  });
});

describe('design loads', () => {
  it('project overrides win over defaults, and every value has a source', () => {
    const p = createProject({ name: 'x' });
    p.site.designLoads.groundSnow = { value: 1.9, unit: 'kPa', source: 'county building dept' };
    const r = resolveDesignLoads(p, {
      location: { label: 'Default Town, ST' },
      loads: {
        groundSnow: { value: 1.2, unit: 'kPa', source: 'bundled table' },
        windSpeed: { value: 51, unit: 'm/s', source: 'bundled table' },
      },
    });
    expect(r.loads.groundSnow).toEqual({ value: 1.9, unit: 'kPa', source: 'county building dept', overridden: true });
    expect(r.loads.windSpeed).toEqual({ value: 51, unit: 'm/s', source: 'bundled table', overridden: false });
    expect(r.loads.frostDepth).toBeUndefined();
    expect(r.location).toEqual({ label: 'Default Town, ST', source: 'default' });

    p.site.location = { label: 'Elsewhere, ST', source: 'project' };
    expect(resolveDesignLoads(p).location).toEqual({ label: 'Elsewhere, ST', source: 'project' });
  });

  it('conversion constants and display', () => {
    expect(KPA_PER_PSF).toBeCloseTo(0.0478803, 6);
    expect(MS_PER_MPH).toBe(0.44704);
    expect(formatLoad('groundSnow', 30 * KPA_PER_PSF)).toBe('30 psf');
    expect(formatLoad('windSpeed', 115 * MS_PER_MPH)).toBe('115 mph');
    expect(formatLoad('frostDepth', 914.4)).toBe(`3' 0"`);
  });

  it('parses loads with units', () => {
    const v = (k: Parameters<typeof parseDesignLoad>[0], s: string | number) => {
      const r = parseDesignLoad(k, s);
      return r.ok ? r.value : r.error;
    };
    expect(v('groundSnow', '30 psf')).toBeCloseTo(1.4364, 4);
    expect(v('groundSnow', '1.5 kPa')).toBe(1.5);
    expect(v('windSpeed', '115 mph')).toBeCloseTo(51.41, 2);
    expect(v('windSpeed', '36 km/h')).toBeCloseTo(10);
    expect(v('frostDepth', '36in')).toBeCloseTo(914.4);
    expect(v('frostDepth', 900)).toBe(900);
    expect(v('groundSnow', '30')).toContain('has no unit');
    expect(v('groundSnow', '"30"')).toBe('"30" has no unit. Give the ground snow load with a unit, e.g. 30 psf or 1.44 kPa.');
    expect(v('groundSnow', '"30 psf"')).toBeCloseTo(1.4364, 4);
    expect(v('windSpeed', '“115 mph”')).toBeCloseTo(51.41, 2);
    expect(v('frostDepth', '"36in"')).toBeCloseTo(914.4);
    expect(v('frostDepth', '36"')).toBeCloseTo(914.4);
    for (const k of ['groundSnow', 'windSpeed', 'frostDepth'] as const) {
      expect(v(k, '0')).toBe(0);
      expect(v(k, '"0.0"')).toBe(0);
    }
    expect(v('windSpeed', '30 knots')).toContain(`Couldn't read "30 knots"`);
  });
});
