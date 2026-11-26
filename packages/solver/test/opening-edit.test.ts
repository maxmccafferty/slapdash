/**
 * LOC-118: the solver still runs after update_opening and remove_opening re-frame an
 * opening in place, and the re-picked header carries the wider span.
 */
import { CommandBus, formatErrors, type Project } from '@slapdash/core';
import { CATALOG } from '@slapdash/catalog';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/index.ts';
import { INDEX, poolHouse } from './helpers.ts';

const headersOf = (p: Project, opening?: string) =>
  Object.values(p.parts).filter((x) => x.role === 'header' && (!opening || x.tags.includes(`opening:${opening}`)));
const depthOf = (sectionId: string | undefined) => CATALOG.sections.find((s) => s.id === sectionId)!.dims_mm.depth;

function exec(bus: CommandBus, name: string, input: unknown) {
  const res = bus.execute(name, input);
  if (!res.ok) throw new Error(`${name}: ${formatErrors(res.errors)}`);
  return res;
}

describe('opening edits and the solver', () => {
  it('a sliding door widened to 8ft gets a header at least as deep, and every header passes', () => {
    const bus = new CommandBus({ project: poolHouse(), catalog: CATALOG });
    const before = headersOf(bus.project, 'O1');
    exec(bus, 'update_opening', { openingId: 'O1', width: '8ft' });
    const after = headersOf(bus.project, 'O1');
    expect(after.length).toBeGreaterThan(0);
    expect(depthOf(after[0]!.sectionId)).toBeGreaterThanOrEqual(depthOf(before[0]!.sectionId));
    const r = analyze(bus.project, INDEX);
    for (const h of headersOf(bus.project)) expect(r.parts[h.id]!.utilization, h.id).toBeLessThan(1);
  });

  it('analyses the shell after the window is removed', () => {
    const bus = new CommandBus({ project: poolHouse(), catalog: CATALOG });
    exec(bus, 'remove_opening', { openingId: 'O2' });
    expect(headersOf(bus.project, 'O2')).toHaveLength(0);
    const r = analyze(bus.project, INDEX);
    for (const h of headersOf(bus.project)) expect(r.parts[h.id]!.utilization, h.id).toBeLessThan(1);
  });
});
