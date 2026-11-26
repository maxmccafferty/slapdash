import { indexCatalog } from '@slapdash/core';
import { TIER1_CATALOG } from '@slapdash/catalog';
import { analyze } from '@slapdash/solver';
import { describe, expect, it } from 'vitest';
import {
  AgentMemory,
  NO_ANALYSIS_MESSAGE,
  STRUCTURE_DISCLAIMER,
  dispatchTool,
  formatStructureReport,
  stressContextOf,
  stressViewText,
} from '../src/index.ts';
import { exec, poolHouseBus } from './helpers.ts';

const INDEX = indexCatalog(TIER1_CATALOG);

/** The pool house at 50 psf (the person's number) with 2x4 plies over the sliding door. */
export function weakHeaderBus() {
  const bus = poolHouseBus();
  exec(bus, 'set_design_load', { key: 'groundSnow', value: '50 psf', source: 'county' });
  for (const h of Object.values(bus.project.parts).filter((p) => p.role === 'header' && p.tags.includes('opening:O1'))) {
    exec(bus, 'update_part', { id: h.id, sectionId: '2x4' });
  }
  return bus;
}

describe('check_structure report', () => {
  const bus = weakHeaderBus();
  const result = analyze(bus.project, INDEX);

  it('leads with the disclaimer and the loads with their sources, overrides marked yours', () => {
    const text = formatStructureReport(bus.project, result);
    const lines = text.split('\n');
    expect(lines[0]).toBe(STRUCTURE_DISCLAIMER);
    expect(lines[1]).toMatch(/^Loads: ground snow 50 psf \(yours: county\) · roof snow 35 psf · wind 115 mph \(default 115 mph basic wind speed \(no location set\)\)$/);
    expect(text).toContain('Status: stands up; nothing unstable.');
  });

  it('lists the most loaded part first and the over-limit header with its % and governing check', () => {
    const text = formatStructureReport(bus.project, result);
    const worst = Object.values(result.parts).sort((a, b) => b.utilization - a.utilization)[0]!;
    expect(text).toContain(`Most loaded: ${worst.id} `);
    expect(text).toMatch(/Over the limit: [1-9]\d* parts?, \d+ joints?\./);
    expect(text).toMatch(/\n- W3-H0\d Header, South wall · 1\d\d% · (shear|bending) under D\+S\n/);
    expect(text).toMatch(/\n- J\d+ \([A-Z0-9-]+ ↔ [A-Z0-9-]+\) · \d+% · joint-/);
  });

  it('scopes to one assembly and respects the limit', () => {
    const text = formatStructureReport(bus.project, result, { assembly: 'W1', limit: 3 });
    expect(text).toContain('Scope: W1');
    expect(text).not.toMatch(/- W3-/);
    const top = text.split('Top 3 parts:\n')[1]!.split('\n').filter((l) => l.startsWith('- '));
    expect(top.length).toBeGreaterThanOrEqual(3);
  });

  it('the stress context and the <stress_view> note', () => {
    // Only the sliding door's framing visible: the header is the worst.
    const ctx = stressContextOf(bus.project, result, (id) => bus.project.parts[id]!.tags.includes('opening:O1'));
    expect(ctx.worst).toMatchObject({ label: 'Header, South wall', combo: 'D+S' });
    expect(ctx.worst!.utilization).toBeGreaterThan(1);
    expect(ctx.overCount).toBeGreaterThan(0);
    const note = stressViewText(ctx);
    expect(note).toMatch(/^<stress_view>The person just turned on the stress view\. Most loaded: Header, South wall \(W3-H0\d\) at \d+% of its limit \((shear|bending) under D\+S\)\./);
    expect(note).toContain(STRUCTURE_DISCLAIMER);
    expect(note.endsWith('</stress_view>')).toBe(true);
  });

  it('dispatch: validates, then says so without a provider', async () => {
    const memory = new AgentMemory();
    const none = await dispatchTool({ id: 't', name: 'check_structure', input: {} }, { bus, memory });
    expect(none).toMatchObject({ isError: true, content: NO_ANALYSIS_MESSAGE });
    const bad = await dispatchTool({ id: 't', name: 'check_structure', input: { assembly: 'W9' } }, { bus, memory, analysis: async () => result });
    expect(bad.isError).toBe(true);
    expect(String(bad.content)).toContain('W9');
    const good = await dispatchTool({ id: 't', name: 'check_structure', input: { limit: 2 } }, { bus, memory, analysis: async () => result });
    expect(good.isError).toBe(false);
    expect(String(good.content)).toContain('Top 2 parts:');
  });
});
