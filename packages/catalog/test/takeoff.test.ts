/**
 * Acceptance: the materials list and cut list for the 16 × 20 pool-house shell, on the
 * tier-1 catalog and the real price table (LOC-111).
 */
import { describe, expect, it } from 'vitest';
import { CommandBus, MM_PER_INCH, createProject, formatErrors, takeoff, type MaterialsReport } from '@slapdash/core';
import { PRICE_TABLE, TIER1_CATALOG } from '../src/index.ts';

const IN = MM_PER_INCH;

function poolHouse(): CommandBus {
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
  return bus;
}

const rowsOf = (r: MaterialsReport) => r.groups.flatMap((g) => g.rows);

describe('materials for the pool-house shell (tier-1 catalog, real prices)', () => {
  const bus = poolHouse();
  const report = takeoff(bus.project, TIER1_CATALOG, PRICE_TABLE);
  const rows = rowsOf(report);

  it('has Slab, Walls and Roof, in that order', () => {
    expect(report.groups.map((g) => g.title)).toEqual(['Slab', 'Walls', 'Roof']);
  });

  it('every built part is counted once and every stocked member is on one board', () => {
    const built = Object.values(bus.project.parts).map((p) => p.id).sort();
    expect(rows.flatMap((r) => r.partIds).sort()).toEqual(built);
    const sections = new Map(TIER1_CATALOG.sections.map((s) => [s.id, s]));
    const stocked = Object.values(bus.project.parts).filter((p) => p.sectionId && sections.get(p.sectionId)?.stock);
    expect(report.cutList.flatMap((g) => g.pieces.flatMap((row) => row.pieceIds)).sort()).toEqual(stocked.map((p) => p.id).sort());
  });

  it('the board counts agree between the two tabs', () => {
    const fromRows = new Map<string, number>();
    for (const r of rows.filter((x) => x.measure === 'boards')) {
      const key = `${r.materialId}|${r.sectionId}|${r.stock!.length_mm}`;
      fromRows.set(key, (fromRows.get(key) ?? 0) + r.quantity);
    }
    expect(fromRows).toEqual(new Map(report.cutList.map((g) => [g.id, g.boards])));
  });

  it('the full-height studs come from 104 5/8in precut studs', () => {
    const precut = rows.find((r) => r.materialId === 'spf-no2' && r.sectionId === '2x4' && r.stock?.name === 'precut stud')!;
    expect(precut.stock!.length_mm).toBeCloseTo(104.625 * IN, 6);
    expect(precut.quantity).toBe(18 + 13 + 15 + 13);
  });

  it('rounds concrete up to 1/4 yd³ and prices it per cubic yard', () => {
    const concrete = rows.find((r) => r.measure === 'cu-yd')!;
    expect(concrete.step).toBe('slab');
    expect((concrete.quantity * 4) % 1).toBe(0);
    expect(concrete.cost!.unit).toBe('cu-yd');
  });

  it('the opening unit has no price yet, with the table\'s reason', () => {
    const unit = rows.find((r) => r.materialId === 'opening-unit')!;
    expect(unit.cost).toBeNull();
    expect(unit.noPriceReason).toBe('pick a specific window or door');
    expect(unit.quantity).toBe(2);
  });

  it('hurricane ties are bought with the roof', () => {
    const ties = rows.filter((r) => r.materialId === 'hurricane-tie');
    expect(ties.map((r) => r.step)).toEqual(['roof']);
    expect(ties[0]!.quantity).toBeGreaterThan(0);
    expect(ties[0]!.cost).not.toBeNull();
  });

  it('every row has a swatch, and the totals are a dated range', () => {
    for (const r of rows) expect(r.swatch, r.id).toBeDefined();
    const t = report.totals;
    expect(t.low_cents).toBeGreaterThan(0);
    expect(t.low_cents).toBeLessThanOrEqual(t.high_cents);
    expect(t.unpriced).toBeGreaterThanOrEqual(1);
    expect(t.researchedOn).toBe(PRICE_TABLE.researchedOn);
  });

  it("the person's price replaces the range, and undo restores it", () => {
    const local = poolHouse();
    const res = local.execute('set_price', { material: 'spf-no2', size: '2x4', price: 0.5, per: 'linear-ft' });
    expect(res.ok).toBe(true);
    const after = takeoff(local.project, TIER1_CATALOG, PRICE_TABLE);
    const spf = rowsOf(after).filter((r) => r.materialId === 'spf-no2' && r.sectionId === '2x4');
    expect(spf.length).toBeGreaterThan(0);
    for (const r of spf) expect(r.cost).toMatchObject({ user: true, unitLow_usd: 0.5, unitHigh_usd: 0.5 });
    expect(after.totals.low_cents).not.toBe(report.totals.low_cents);
    local.undo();
    expect(takeoff(local.project, TIER1_CATALOG, PRICE_TABLE).totals).toEqual(report.totals);
  });

  it('set_price refuses in single plain sentences', () => {
    const local = poolHouse();
    const errors = (input: unknown) => {
      const res = local.execute('set_price', input);
      if (res.ok) throw new Error('set_price should have been refused');
      return res.errors.map((e) => e.message);
    };
    expect(errors({ material: 'oak-board', price: 1, per: 'linear-ft' })).toEqual(['There\'s no material "oak-board".']);
    expect(errors({ material: 'spf-no2', size: '2x4', price: 6, per: 'each' })).toEqual([
      'A price per board needs the board length, e.g. length: 8ft.',
    ]);
    expect(errors({ material: 'osb-7-16', price: 1, per: 'linear-ft' })).toEqual([
      "7/16in OSB sheathing can't be priced per linear foot; price it per sheet or square foot.",
    ]);
  });
});
