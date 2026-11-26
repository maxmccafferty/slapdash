/**
 * Acceptance: the pool-house shell (SAMPLE_SHELL_COMMANDS) with the tier-1 catalog, the
 * full set of basic cases and combinations, inside the time budget.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { analyze, DEFAULT_PERF_BUDGET_MS, type AnalysisResult } from '../src/index.ts';
import { INDEX, poolHouse } from './helpers.ts';

const BUDGET = Number(process.env.SOLVER_PERF_BUDGET_MS) || DEFAULT_PERF_BUDGET_MS;

describe('pool house', () => {
  const project = poolHouse();
  let r: AnalysisResult;
  beforeAll(() => {
    analyze(project, INDEX); // warm up the JIT, as the worker would be after its first run
    r = analyze(project, INDEX);
  });

  it('solves with no mechanism and nothing unstable', () => {
    expect(r.status).toBe('ok');
    expect(r.mechanism).toBeUndefined();
    expect(r.unstable).toEqual([]);
    expect(Object.values(r.parts).filter((p) => p.unstable)).toEqual([]);
  });

  it('covers every part and joint, with finite utilisations', () => {
    expect(Object.keys(r.parts).sort()).toEqual(Object.keys(project.parts).sort());
    expect(Object.keys(r.joints).sort()).toEqual(Object.keys(project.joints).sort());
    for (const p of Object.values(r.parts)) expect(Number.isFinite(p.utilization), p.id).toBe(true);
    for (const j of Object.values(r.joints)) expect(Number.isFinite(j.utilization), j.id).toBe(true);
    const structural = Object.values(r.parts).filter((p) => p.role === 'member' || p.role === 'truss');
    expect(structural.length).toBeGreaterThan(100);
    for (const p of structural) expect(p.governing, p.id).toBeDefined();
  });

  it("the builder's headers carry D+S at the default 30 psf ground snow", () => {
    const d = analyze(project, INDEX, { cases: ['D', 'S'] });
    expect(d.loads.groundSnow.source).toMatch(/default 30 psf/);
    const headers = Object.values(project.parts).filter((p) => p.role === 'header');
    expect(headers.length).toBeGreaterThan(0);
    for (const h of headers) {
      const res = d.parts[h.id]!;
      expect(res.utilization, h.id).toBeGreaterThan(0);
      expect(res.utilization, h.id).toBeLessThan(1);
    }
  });

  it('reports its size and stays inside the time budget', () => {
    expect(r.stats.dofs).toBe(r.stats.nodes * 6);
    expect(r.stats.elements).toBeGreaterThan(0);
    expect(r.stats.links).toBeGreaterThan(0);
    expect(r.stats.ms).toBeLessThan(BUDGET);
  });
});
