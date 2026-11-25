/**
 * Console report and results file for `pnpm eval`: a line per turn, PASS/FAIL/SKIP per
 * scenario, a summary table, cost and token totals, and the monthly-cap projection.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BudgetStatus } from '@slapdash/agent';
import { addTokens, zeroTokens, type TokenTotals, type TurnRecord } from './harness.ts';
import type { ScenarioResult } from './scenario.ts';

export const usd = (n: number): string => `$${n.toFixed(4)}`;

export function kTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function turnLine(t: TurnRecord, i: number): string {
  const bits = [
    t.plan ? 'plan' : null,
    t.options ? `${t.options.length} options` : null,
    `${t.toolCalls.length} tools`,
    t.refusals > 0 ? `${t.refusals} refused` : null,
    `${kTokens(t.tokens.input)} in / ${kTokens(t.tokens.output)} out / ${kTokens(t.tokens.cacheRead)} cache-read`,
    usd(t.costUsd),
    t.capped ? `capped: ${t.capped}` : null,
  ].filter(Boolean);
  return `  T${i + 1} "${clip(t.prompt, 40)}"  ${bits.join(' · ')}`;
}

export const scenarioCost = (r: ScenarioResult): number => r.turns.reduce((a, t) => a + t.costUsd, 0);
export const scenarioTokens = (r: ScenarioResult): TokenTotals => r.turns.reduce((a, t) => addTokens(a, t.tokens), zeroTokens());

/** The lines printed when a scenario finishes. `log` adds its buffered tool log (failures, unless it was already streamed). */
export function scenarioLines(r: ScenarioResult, opts: { log?: boolean } = {}): string[] {
  const out: string[] = [];
  if (r.status === 'skip') return [`SKIP ${r.name} (${r.skipReason ?? 'skipped'})`];
  out.push(...r.turns.map(turnLine));
  const head = `${r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'ERROR'} ${r.name} (${usd(scenarioCost(r))}, ${r.turns.length} turns, ${Math.round(r.durationMs / 1000)}s)`;
  out.push(head);
  if (r.error) out.push(`    - ${r.error}`);
  for (const f of r.failures) out.push(`    - ${f}`);
  if (opts.log) out.push(...r.log.map((l) => `  ${l}`));
  return out;
}

export interface Totals {
  scenarios: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  turns: number;
  costUsd: number;
  tokens: TokenTotals;
  avgTurnUsd: number | null;
  avgTypicalTurnUsd: number | null;
  avgFullBuildUsd: number | null;
  capUsd: number | null;
  typicalTurnsPerCap: number | null;
  fullBuildsPerCap: number | null;
}

const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

export function totalsOf(results: readonly ScenarioResult[], budget: BudgetStatus | null): Totals {
  const ran = results.filter((r) => r.status !== 'skip');
  const turns = ran.flatMap((r) => r.turns);
  const costUsd = turns.reduce((a, t) => a + t.costUsd, 0);
  const avgTypicalTurnUsd = mean(ran.filter((r) => r.typical).flatMap((r) => r.turns.map((t) => t.costUsd)));
  const avgFullBuildUsd = mean(ran.filter((r) => r.fullBuild && r.status === 'pass').map(scenarioCost));
  const capUsd = budget?.capUsd ?? null;
  return {
    scenarios: results.length,
    passed: results.filter((r) => r.status === 'pass').length,
    failed: results.filter((r) => r.status === 'fail').length,
    errored: results.filter((r) => r.status === 'error').length,
    skipped: results.filter((r) => r.status === 'skip').length,
    turns: turns.length,
    costUsd,
    tokens: turns.reduce((a, t) => addTokens(a, t.tokens), zeroTokens()),
    avgTurnUsd: mean(turns.map((t) => t.costUsd)),
    avgTypicalTurnUsd,
    avgFullBuildUsd,
    capUsd,
    typicalTurnsPerCap: capUsd !== null && avgTypicalTurnUsd ? Math.floor(capUsd / avgTypicalTurnUsd) : null,
    fullBuildsPerCap: capUsd !== null && avgFullBuildUsd ? Math.floor(capUsd / avgFullBuildUsd) : null,
  };
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const lpad = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

/** The summary table, totals and cap check. With --repeat, one row per scenario with its pass rate. */
export function summaryLines(results: readonly ScenarioResult[], totals: Totals): string[] {
  const byName = new Map<string, ScenarioResult[]>();
  for (const r of results) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  const width = Math.max(8, ...[...byName.keys()].map((n) => n.length));
  const out = ['', 'Summary', `  ${pad('scenario', width)}  ${pad('status', 8)}  ${lpad('turns', 5)}  ${lpad('in', 7)}  ${lpad('out', 6)}  ${lpad('cost', 9)}`];
  for (const [name, runs] of byName) {
    const ran = runs.filter((r) => r.status !== 'skip');
    const passed = runs.filter((r) => r.status === 'pass').length;
    const status = runs.length === 1 ? runs[0]!.status.toUpperCase() : `${passed}/${runs.length}`;
    const tokens = ran.map(scenarioTokens).reduce(addTokens, zeroTokens());
    const turns = ran.reduce((a, r) => a + r.turns.length, 0);
    const cost = ran.reduce((a, r) => a + scenarioCost(r), 0);
    out.push(
      `  ${pad(name, width)}  ${pad(status, 8)}  ${lpad(String(turns), 5)}  ${lpad(kTokens(tokens.input), 7)}  ${lpad(kTokens(tokens.output), 6)}  ${lpad(usd(cost), 9)}`,
    );
  }
  const t = totals.tokens;
  out.push('');
  out.push(
    `${totals.passed}/${totals.scenarios} passed${totals.failed ? ` · ${totals.failed} failed` : ''}${totals.errored ? ` · ${totals.errored} errored` : ''}${totals.skipped ? ` · ${totals.skipped} skipped` : ''} · total ${usd(totals.costUsd)} · tokens ${kTokens(t.input)} in / ${kTokens(t.output)} out / ${kTokens(t.cacheWrite)} cache-write / ${kTokens(t.cacheRead)} cache-read`,
  );
  out.push('', 'Cap check');
  out.push(`  average turn: ${totals.avgTurnUsd === null ? 'n/a' : usd(totals.avgTurnUsd)} over ${totals.turns} turns`);
  out.push(`  typical turn (small edits and questions): ${totals.avgTypicalTurnUsd === null ? 'n/a (no typical scenario ran)' : usd(totals.avgTypicalTurnUsd)}`);
  out.push(`  full build (passing full-build scenarios): ${totals.avgFullBuildUsd === null ? 'n/a (none passed)' : usd(totals.avgFullBuildUsd)}`);
  if (totals.capUsd !== null) {
    const turns = totals.typicalTurnsPerCap === null ? '?' : `≈ ${totals.typicalTurnsPerCap}`;
    const builds = totals.fullBuildsPerCap === null ? '?' : `≈ ${totals.fullBuildsPerCap}`;
    out.push(`  At $${totals.capUsd}/month that is ${turns} typical turns or ${builds} full builds.`);
  }
  return out;
}

export interface ResultsFile {
  startedAt: string;
  finishedAt: string;
  models: string[];
  configuredModel: string;
  effort: string;
  gitSha: string | null;
  args: Record<string, unknown>;
  budgetBefore: BudgetStatus | null;
  budgetAfter: BudgetStatus | null;
  scenarios: ScenarioResult[];
  totals: Totals;
}

/** `evals/results/<YYYY-MM-DDTHH-mm-ss>.json`. Returns the path. */
export function writeResults(dir: string, data: ResultsFile): string {
  mkdirSync(dir, { recursive: true });
  const stamp = data.startedAt.replace(/\.\d+Z$/, '').replace(/:/g, '-');
  const path = join(dir, `${stamp}.json`);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
}
