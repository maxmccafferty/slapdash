import { describe, expect, it } from 'vitest';
import { AgentMemory, dispatchTool, projectSummary } from '../src/index.ts';
import { exec, makeBus, poolHouseBus } from './helpers.ts';

describe('project summary', () => {
  it('is deterministic', () => {
    expect(projectSummary(poolHouseBus().project)).toBe(projectSummary(poolHouseBus().project));
  });

  it('lists the slab, walls, opening and roof with formatted sizes', () => {
    const s = projectSummary(poolHouseBus().project, { versions: ['before roof'], pendingPlan: 'Add a deck.', confirmBigChanges: true });
    expect(s.startsWith('<project>\nName: Pool house · units imperial · ')).toBe(true);
    expect(s.endsWith('</project>')).toBe(true);
    expect(s).toContain('- FD1 Slab (foundation) 20\' 0" × 16\' 0" × 4" · 5 parts');
    expect(s).toContain('- W1 North wall (wall) (0", 0")→(20\' 0", 0") · 20\' 0" long · 9\' 0" high · 31 parts');
    expect(s).toMatch(/- O1 Sliding door in South wall \(opening\) 6' 0" × 6' 8 1\/2" sliding-door RO in W3/);
    expect(s).toContain('- R1 Roof (roof) gable 6/12 ridge E–W over 20\' 0" × 16\' 0"');
    expect(s).toMatch(/Bounds: 20' 7\/8" E–W × .* tall \(origin SW corner, \+x east, \+z south\)/);
    expect(s).toContain('Saved versions: before roof');
    expect(s).toContain('Pending plan: "Add a deck."');
    expect(s).toContain('Big-change check: on (plan before big changes)');
    expect(s.length).toBeLessThan(2000);
  });

  it('shows site overrides and defaults with their sources', () => {
    const bus = makeBus();
    exec(bus, 'set_site_location', { location: { label: 'Austin, TX' } });
    exec(bus, 'set_design_load', { key: 'frostDepth', value: '12in', source: 'county' });
    const s = projectSummary(bus.project, { siteDefaults: { loads: { groundSnow: { value: 0.2394, unit: 'kPa', source: 'default table' } } } });
    expect(s).toContain('Site: Austin, TX (project) · snow 5 psf (default table) · wind not set · frost 1\' 0" (yours: county)');
    expect(s).toContain('Bounds: nothing built yet');
    expect(s).toContain('Assemblies: none');
    expect(s).toContain('Big-change check: off (just build)');
  });

  it('marks table values with their source, and a location missing from the table', () => {
    const table = { 'bend, or': { label: 'Bend, OR', loads: { groundSnow: { value: 25 * 0.04788025898, unit: 'kPa' as const, source: 'ASCE 7-22 Hazard Tool' } } } };
    const bus = makeBus();
    const inTable = projectSummary(bus.project, { siteDefaults: { location: { label: 'Bend, OR' }, table } });
    expect(inTable).toContain('Site: Bend, OR (default) · snow 25 psf (ASCE 7-22 Hazard Tool) · wind not set · frost not set');
    exec(bus, 'set_site_location', { location: { label: 'Nowhere, ZZ' } });
    exec(bus, 'set_design_load', { key: 'groundSnow', value: '50 psf', source: 'county' });
    const missing = projectSummary(bus.project, { siteDefaults: { location: { label: 'Bend, OR' }, table } });
    expect(missing).toContain('Site: Nowhere, ZZ (project, not in loads table) · snow 50 psf (yours: county)');
  });

  it('caps the assembly lines', () => {
    const s = projectSummary(poolHouseBus().project, { maxAssemblies: 3 });
    expect(s.split('\n').filter((l) => /^- [A-Z]+\d/.test(l))).toHaveLength(3);
    expect(s).toContain('- …4 more; use find_parts');
  });

  it('lists code notes when given the catalog: a pool without a barrier and a window near it', () => {
    const bus = poolHouseBus();
    exec(bus, 'place_structure', { kind: 'pool', at: { x: '24ft', z: '2ft' }, width: '12ft', depth: '20ft' });
    exec(bus, 'add_opening', { wallId: 'W2', kind: 'window', centerAt: '8ft' });
    const without = projectSummary(bus.project);
    expect(without).not.toContain('Code notes');
    const s = projectSummary(bus.project, { catalog: bus.catalog });
    expect(s).toContain('Code notes (reminders, not a code check):');
    expect(s).toMatch(/- The pool \(X1\) needs a barrier at least 4ft tall .* \(IRC Appendix AG105\.2 \/ ISPSC 305\)/);
    expect(s).toMatch(/- O2's glass \(window or door unit \(generic\)\) is within 5ft of the pool .* \(IRC R308\.4\.5\)/);
    // The opening's unit is one line: its style and finish, and one unit however many parts draw it.
    expect(s).toMatch(/- O2 Window in East wall \(opening\) 3' 0" × 4' 0" window RO in W2 · from 6' 6" along the wall · casement unit, white vinyl · 1 unit \(13 parts\)/);
    // The shell alone (no pool) has no notes.
    expect(projectSummary(poolHouseBus().project, { catalog: bus.catalog })).not.toContain('Code notes');
  });

  it('dispatch appends a new code note to the result of the command that created it, once', async () => {
    const bus = poolHouseBus();
    const memory = new AgentMemory();
    const pool = await dispatchTool({ id: 't1', name: 'place_structure', input: { kind: 'pool', at: { x: '24ft', z: '2ft' }, width: '12ft', depth: '20ft' } }, { bus, memory });
    expect(pool.isError).toBe(false);
    expect(String(pool.content)).toContain('\nNew code note: Reminder (not a code check): The pool (X1) needs a barrier');
    const window = await dispatchTool({ id: 't2', name: 'add_opening', input: { wallId: 'W2', kind: 'window', centerAt: '8ft' } }, { bus, memory });
    const text = String(window.content);
    expect(text).toContain("New code note: Reminder (not a code check): O2's glass");
    expect(text).not.toContain('needs a barrier');
    const tree = await dispatchTool({ id: 't3', name: 'place_structure', input: { kind: 'tree', at: { x: '-30ft', z: '30ft' } } }, { bus, memory });
    expect(String(tree.content)).not.toContain('New code note');
  });
});
