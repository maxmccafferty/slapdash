/**
 * Acceptance (LOC-113): an undersized sliding-door header reads over its limit, and
 * resize_header (what Claude offers as the fix) brings every header back under it.
 */
import { CommandBus, formatErrors, type Project } from '@slapdash/core';
import { CATALOG } from '@slapdash/catalog';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/index.ts';
import { INDEX, poolHouse } from './helpers.ts';

const headersOf = (p: Project, opening?: string) =>
  Object.values(p.parts).filter((x) => x.role === 'header' && (!opening || x.tags.includes(`opening:${opening}`)));

function exec(bus: CommandBus, name: string, input: unknown) {
  const res = bus.execute(name, input);
  if (!res.ok) throw new Error(`${name}: ${formatErrors(res.errors)}`);
  return res;
}

describe('header fix', () => {
  it('2x4 plies over the sliding door at 50 psf fail under D+S; resize_header clears every header', () => {
    const bus = new CommandBus({ project: poolHouse(), catalog: CATALOG });
    exec(bus, 'set_design_load', { key: 'groundSnow', value: '50 psf', source: 'user' });
    for (const h of headersOf(bus.project, 'O1')) exec(bus, 'update_part', { id: h.id, sectionId: '2x4' });

    const weak = analyze(bus.project, INDEX);
    const worst = headersOf(bus.project, 'O1').map((h) => weak.parts[h.id]!);
    expect(Math.max(...worst.map((r) => r.utilization))).toBeGreaterThan(1);
    for (const r of worst) {
      // A 2-2x4 over 6ft: end shear governs in the model, then bending.
      expect(['shear', 'bending']).toContain(r.governing?.check);
      expect(r.governing?.combo, r.id).toMatch(/S/);
    }

    exec(bus, 'resize_header', { opening: 'O1' });
    const fixed = analyze(bus.project, INDEX);
    expect(headersOf(bus.project, 'O1').every((h) => h.sectionId === '2x12')).toBe(true);
    for (const h of headersOf(bus.project)) expect(fixed.parts[h.id]!.utilization, h.id).toBeLessThan(1);
  });

  it('records what a 70 psf override alone does to the 30 psf header', () => {
    const bus = new CommandBus({ project: poolHouse(), catalog: CATALOG });
    exec(bus, 'set_design_load', { key: 'groundSnow', value: '70 psf', source: 'user' });
    const r = analyze(bus.project, INDEX);
    const u = Math.max(...headersOf(bus.project, 'O1').map((h) => r.parts[h.id]!.utilization));
    // The IRC table wants a 2-2x12 at 70 psf, but the model's NDS check still passes the
    // 2-2x10 (about 49% when this was written): the table is more conservative. So the
    // over-limit acceptance above uses an explicitly undersized header instead.
    expect(u).toBeGreaterThan(0);
    expect(u).toBeLessThan(1);
    exec(bus, 'resize_header', { opening: 'O1' });
    const after = analyze(bus.project, INDEX);
    const u2 = Math.max(...headersOf(bus.project, 'O1').map((h) => after.parts[h.id]!.utilization));
    expect(u2).toBeLessThan(u);
  });
});
