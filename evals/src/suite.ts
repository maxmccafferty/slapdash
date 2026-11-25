/**
 * Runs scenarios one after another with the spend guard: once this run's spend reaches
 * `maxUsd`, or the keyhole reports the month's budget capped, the rest are skipped (not
 * failed). Sequential on purpose: readable output, no rate-limit trouble, and the guard can
 * stop between scenarios.
 */
import type { BudgetStatus, KeyholeClient } from '@slapdash/agent';
import { runScenario, skippedResult, type Scenario, type ScenarioResult } from './scenario.ts';

export interface SuiteOptions {
  repeat?: number;
  maxUsd: number;
  /** Called before each scenario starts. */
  onStart?: (s: Scenario, run: number) => void;
  /** Called as each scenario finishes or is skipped. */
  onResult?: (r: ScenarioResult) => void;
  /** Streams each scenario's log lines as they happen (--verbose). */
  onLine?: (line: string) => void;
}

export interface SuiteResult {
  results: ScenarioResult[];
  spentUsd: number;
  /** The last budget the keyhole reported during the run. */
  lastBudget: BudgetStatus | null;
}

export async function runSuite(scenarios: readonly Scenario[], client: KeyholeClient, opts: SuiteOptions): Promise<SuiteResult> {
  const repeat = Math.max(1, opts.repeat ?? 1);
  const results: ScenarioResult[] = [];
  let spentUsd = 0;
  let lastBudget: BudgetStatus | null = null;
  for (let run = 1; run <= repeat; run++) {
    for (const s of scenarios) {
      let skip: string | null = null;
      if (lastBudget?.state === 'capped') skip = "budget capped: this month's Claude budget is used up";
      else if (spentUsd >= opts.maxUsd) skip = `spend limit: this run spent $${spentUsd.toFixed(4)} of --max-usd $${opts.maxUsd}`;
      let r: ScenarioResult;
      if (skip) {
        r = skippedResult(s, skip);
      } else {
        opts.onStart?.(s, run);
        r = await runScenario(s, client, opts.onLine ? { onLine: opts.onLine } : {});
        for (const t of r.turns) {
          spentUsd += t.costUsd;
          if (t.budget) lastBudget = t.budget;
        }
      }
      results.push(r);
      opts.onResult?.(r);
    }
  }
  return { results, spentUsd, lastBudget };
}
