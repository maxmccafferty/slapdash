/**
 * The takeoff on the sample catalog with a small hand-made price table: build-step
 * grouping, counting rules, the cut list agreeing with the materials list, and pricing
 * (table, the person's own prices, missing prices). The tier-1 acceptance on the real
 * price table is in `packages/catalog/test/takeoff.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  GROUND,
  MM_PER_FOOT,
  MM_PER_INCH,
  SAMPLE_CATALOG,
  buildStepGroups,
  createProject,
  formatErrors,
  sheetVariant,
  stepOfJoint,
  takeoff,
  type Catalog,
  type CommandBus,
  type MaterialsReport,
  type PriceTable,
} from '../../src/index.ts';
import { makeBus } from '../helpers.ts';

const IN = MM_PER_INCH;

/** The sample catalog with price keys on the sheets and concrete. */
const CATALOG: Catalog = structuredClone(SAMPLE_CATALOG);
for (const m of CATALOG.materials) {
  if (m.id === 'osb-7-16') m.priceKey = 'sheet.osb-7-16';
  if (m.id === 'plywood-cdx') m.priceKey = 'sheet.plywood-cdx';
  if (m.id === 'concrete-3000') m.priceKey = 'concrete.concrete-3000';
}

const entry = (key: string, variant: string | undefined, unit: 'linear-ft' | 'sheet' | 'cu-yd', low: number, high: number) => ({
  key,
  ...(variant ? { variant } : {}),
  description: `${key} ${variant ?? ''}`,
  source: 'test',
  unit,
  low_usd: low,
  high_usd: high,
});

const TABLE: PriceTable = {
  schemaVersion: 1,
  currency: 'USD',
  researchedOn: '2026-11-25',
  region: 'test',
  note: 'Planning estimates, not quotes.',
  entries: [
    entry('lumber.spf-no2', '2x4', 'linear-ft', 0.4, 0.8),
    entry('lumber.spf-no2', '2x6', 'linear-ft', 0.8, 1.2),
    entry('lumber.spf-no2', '2x8', 'linear-ft', 1.1, 1.5),
    entry('lumber.pt-spf-no2', '2x4', 'linear-ft', 0.5, 0.6),
    entry('sheet.osb-7-16', undefined, 'sheet', 10, 16),
    entry('sheet.plywood-cdx', '23/32in', 'sheet', 39, 40),
    entry('concrete.concrete-3000', undefined, 'cu-yd', 100, 170),
  ],
};

function exec(bus: CommandBus, name: string, input: unknown) {
  const res = bus.execute(name, input);
  if (!res.ok) throw new Error(`${name}: ${formatErrors(res.errors)}`);
  return res;
}

function poolHouse(opts: { context?: boolean } = {}): CommandBus {
  const bus = makeBus(createProject({ name: 'Pool house' }));
  bus.group({ label: 'Build the pool house shell', source: 'claude', turnId: 't1' }, () => {
    exec(bus, 'pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } });
    exec(bus, 'build_wall', { start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '9ft', name: 'North wall' });
    exec(bus, 'build_wall', { start: { x: '20ft', z: 0 }, end: { x: '20ft', z: '16ft' }, height: '9ft', name: 'East wall' });
    exec(bus, 'build_wall', { start: { x: '20ft', z: '16ft' }, end: { x: 0, z: '16ft' }, height: '9ft', name: 'South wall' });
    exec(bus, 'build_wall', { start: { x: 0, z: '16ft' }, end: { x: 0, z: 0 }, height: '9ft', name: 'West wall' });
    exec(bus, 'add_opening', { wallId: 'W3', kind: 'sliding-door', centerAt: '10ft' });
    exec(bus, 'add_opening', { wallId: 'W2', kind: 'window', centerAt: '8ft' });
    exec(bus, 'build_roof', { type: 'gable', from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' }, pitch: '6 in 12', ridgeAxis: 'x' });
    if (opts.context) exec(bus, 'place_structure', { kind: 'house', at: { x: '30ft', z: 0 }, width: '30ft', depth: '20ft' });
  });
  return bus;
}

const rowsOf = (r: MaterialsReport) => r.groups.flatMap((g) => g.rows);

describe('takeoff on the pool-house shell', () => {
  const bus = poolHouse({ context: true });
  const p = bus.project;
  const report = takeoff(p, CATALOG, TABLE);
  const rows = rowsOf(report);

  it('groups by build step, in build order, leaving site context out', () => {
    expect(report.groups.map((g) => g.title)).toEqual(['Slab', 'Walls', 'Roof']);
    expect(buildStepGroups(p, CATALOG).map((g) => g.step)).toEqual(['slab', 'walls', 'roof']);
    expect(report.isEmpty).toBe(false);
  });

  it('counts every built part once', () => {
    const built = Object.values(p.parts).filter((x) => x.materialId !== 'site-context').map((x) => x.id).sort();
    const counted = rows.flatMap((r) => r.partIds).sort();
    expect(counted).toEqual(built);
  });

  it('puts every sectioned part with stock on exactly one board in the cut list', () => {
    const stocked = Object.values(p.parts).filter((x) => x.sectionId && CATALOG.sections.find((s) => s.id === x.sectionId)?.stock);
    const placed = report.cutList.flatMap((g) => g.pieces.flatMap((row) => row.pieceIds));
    expect([...placed].sort()).toEqual(stocked.map((x) => x.id).sort());
  });

  it('the boards in the materials list are the boards in the cut list', () => {
    const fromRows = new Map<string, number>();
    for (const r of rows.filter((x) => x.measure === 'boards')) {
      const key = `${r.materialId}|${r.sectionId}|${r.stock!.length_mm}`;
      fromRows.set(key, (fromRows.get(key) ?? 0) + r.quantity);
    }
    const fromCut = new Map(report.cutList.map((g) => [g.id, g.boards]));
    expect(fromRows).toEqual(fromCut);
    // Whole-board pieces are one a board; packed boards hold at least one each.
    for (const g of report.cutList) expect(g.pieces.reduce((s, row) => s + row.count, 0)).toBeGreaterThanOrEqual(g.boards);
  });

  it('cuts the full-height studs from 104 5/8in precut studs, one stud each', () => {
    const precut = rows.find((r) => r.sectionId === '2x4' && r.materialId === 'spf-no2' && r.stock?.name === 'precut stud');
    expect(precut?.stock?.length_mm).toBeCloseTo(104.625 * IN, 6);
    // W1 14 + 2 + 2, W2 8 + 2 + 2 + 1, W3 8 + 2 + 4 + 1, W4 11 + 2 (shell acceptance test).
    expect(precut?.quantity).toBe(18 + 13 + 15 + 13);
    const group = report.cutList.find((g) => g.id === `spf-no2|2x4|${104.625 * IN}`)!;
    expect(group.pieces).toHaveLength(1);
    expect(group.pieces[0]!.length_mm).toBeCloseTo(103.5 * IN, 6);
    expect(group.pieces[0]!.count).toBe(group.boards);
  });

  it('rounds concrete up to the next 1/4 yd³', () => {
    const concrete = rows.find((r) => r.measure === 'cu-yd')!;
    const raw = Object.values(p.parts)
      .filter((x) => x.materialId === 'concrete-3000')
      .reduce((s, x) => s + (x.size.length * x.size.width * x.size.height) / (3 * MM_PER_FOOT) ** 3, 0);
    expect(concrete.quantity * 4).toBe(Math.round(concrete.quantity * 4));
    expect(concrete.quantity).toBeGreaterThanOrEqual(raw);
    expect(concrete.quantity - raw).toBeLessThan(0.25);
    expect(concrete.cost!.low_cents).toBe(Math.round(concrete.quantity * 100 * 100));
  });

  it('counts one 4×8 sheet per sheathing piece, sized by thickness', () => {
    const osb = rows.filter((r) => r.materialId === 'osb-7-16');
    expect(osb.map((r) => r.variant)).toEqual(['7/16in', '7/16in']);
    const pieces = Object.values(p.parts).filter((x) => x.materialId === 'osb-7-16').length;
    expect(osb.reduce((s, r) => s + r.quantity, 0)).toBe(pieces);
  });

  it('prices boards at their full length, and sums money in cents', () => {
    const precut = rows.find((r) => r.stock?.name === 'precut stud')!;
    expect(precut.cost).toMatchObject({ unit: 'linear-ft', unitLow_usd: 0.4, unitHigh_usd: 0.8, user: false });
    expect(precut.cost!.low_cents).toBe(Math.round(precut.quantity * (104.625 / 12) * 0.4 * 100));
    for (const g of report.groups) {
      expect(g.low_cents).toBe(g.rows.reduce((s, r) => s + (r.cost?.low_cents ?? 0), 0));
    }
    expect(report.totals.low_cents).toBe(report.groups.reduce((s, g) => s + g.low_cents, 0));
    expect(report.totals.low_cents).toBeGreaterThan(0);
    expect(report.totals.low_cents).toBeLessThanOrEqual(report.totals.high_cents);
    expect(report.totals.researchedOn).toBe('2026-11-25');
    expect(report.totals.note).toBe('Planning estimates, not quotes.');
  });

  it('says why a row has no price', () => {
    const header = rows.find((r) => r.sectionId === '2x10')!;
    expect(header.cost).toBeNull();
    expect(header.noPriceReason).toBe('the price table has no 2x10 size');
    expect(report.totals.unpriced).toBe(rows.filter((r) => r.cost === null).length);
    expect(report.totals.unpriced).toBeGreaterThan(0);
  });

  it('a hurricane tie goes with the roof: the later of its two parts', () => {
    const tie = Object.values(p.joints).find((j) => j.jointTypeId === 'hurricane-tie')!;
    const order = report.groups.map((g) => g.step);
    expect(stepOfJoint(p, tie, order, CATALOG)).toBe('roof');
    const anchor = Object.values(p.joints).find((j) => j.partIds.includes(GROUND));
    if (anchor) expect(stepOfJoint(p, anchor, order, CATALOG)).not.toBeNull();
  });

  it('counts fasteners from the joints, per fastener', () => {
    const nails = rows.filter((r) => r.name === '16d common nail');
    const total = Object.values(p.joints)
      .filter((j) => j.jointTypeId === 'nailed-16d')
      .reduce((s, j) => s + j.fastenerCount, 0);
    expect(nails.reduce((s, r) => s + r.quantity, 0)).toBe(total);
    expect(nails.every((r) => r.noPriceReason === "it isn't in the catalog")).toBe(true);
  });
});

describe('takeoff with the person\'s own prices', () => {
  it('a per-foot price replaces the range for that size, and undo restores the table', () => {
    const bus = poolHouse();
    const before = takeoff(bus.project, CATALOG, TABLE);
    exec(bus, 'set_price', { material: 'spf-no2', size: '2x4', price: 0.5, per: 'linear-ft' });
    const after = takeoff(bus.project, CATALOG, TABLE);
    const twoByFour = rowsOf(after).filter((r) => r.materialId === 'spf-no2' && r.sectionId === '2x4');
    expect(twoByFour.length).toBeGreaterThan(0);
    for (const r of twoByFour) {
      expect(r.cost!.user).toBe(true);
      expect(r.cost!.low_cents).toBe(r.cost!.high_cents);
      expect(r.cost!.unitLow_usd).toBe(0.5);
    }
    expect(rowsOf(after).find((r) => r.sectionId === '2x6')!.cost!.user).toBe(false);
    expect(after.totals.hasUserPrices).toBe(true);
    expect(after.totals.low_cents).not.toBe(before.totals.low_cents);
    bus.undo();
    expect(takeoff(bus.project, CATALOG, TABLE).totals).toEqual(before.totals);
  });

  it('a per-board price becomes a per-foot price for other lengths', () => {
    const bus = poolHouse();
    exec(bus, 'set_price', { material: 'spf-no2', price: 4, per: 'each', length: '8ft' });
    const rows = rowsOf(takeoff(bus.project, CATALOG, TABLE));
    const precut = rows.find((r) => r.stock?.name === 'precut stud')!;
    expect(precut.cost!.unitLow_usd).toBeCloseTo(0.5, 9);
    expect(precut.cost!.low_cents).toBe(Math.round(precut.quantity * (104.625 / 12) * 0.5 * 100));
    // The 2x10 header has no table price, but the price for every size covers it.
    expect(rows.find((r) => r.sectionId === '2x10')!.cost!.user).toBe(true);
  });

  it('a per-square-foot sheet price is 32 ft² a sheet', () => {
    const bus = poolHouse();
    exec(bus, 'set_price', { material: 'osb-7-16', price: 0.5, per: 'sq-ft' });
    const osb = rowsOf(takeoff(bus.project, CATALOG, TABLE)).find((r) => r.materialId === 'osb-7-16')!;
    expect(osb.cost!.unitLow_usd).toBeCloseTo(16, 9);
  });
});

describe('takeoff edges', () => {
  it('an empty project has no rows and no cost', () => {
    const report = takeoff(createProject({ name: 'Empty' }), CATALOG, TABLE);
    expect(report).toMatchObject({ groups: [], cutList: [], isEmpty: true, totals: { low_cents: 0, high_cents: 0, unpriced: 0 } });
  });

  it('a member without stock is bought by the linear foot', () => {
    const bus = makeBus();
    exec(bus, 'add_assembly', { name: 'Frame', kind: 'structure' });
    exec(bus, 'add_part', { assemblyId: 'X1', role: 'beam', materialId: 'steel-a36', sectionId: 'hss-2x2', position: { x: 0, y: 0, z: 0 }, length: '10ft' });
    const [row] = rowsOf(takeoff(bus.project, CATALOG, TABLE));
    expect(row).toMatchObject({ measure: 'linear-ft', sectionId: 'hss-2x2', step: 'structures' });
    expect(row!.quantity).toBeCloseTo(10, 9);
    expect(row!.noPriceReason).toBe("it isn't in the price table");
  });

  it('writes sheet thicknesses the way the price table does', () => {
    expect(sheetVariant((7 / 16) * IN)).toBe('7/16in');
    expect(sheetVariant((23 / 32) * IN)).toBe('23/32in');
    expect(sheetVariant(0.5 * IN)).toBe('1/2in');
    expect(sheetVariant(2 * IN)).toBe('2in');
    expect(sheetVariant(1.125 * IN)).toBe('1 1/8in');
  });
});
