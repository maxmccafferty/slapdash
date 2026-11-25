/**
 * `pnpm eval`: runs the scenarios against the real Claude API through an in-process keyhole
 * and reports pass/fail, tokens and cost per turn, and what that means for the monthly cap.
 * Needs ANTHROPIC_API_KEY (from the repo-root .env or the environment). Costs money; run it
 * before releases and after system-prompt or tool changes, not in CI.
 *
 *   pnpm eval [--only a,b] [--repeat n] [--max-usd x] [--list] [--verbose]
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { BudgetStatus } from '@slapdash/agent';
import { SCENARIOS } from './cases/index.ts';
import { budgetStatus, inProcessKeyhole } from './harness.ts';
import { scenarioLines, summaryLines, totalsOf, usd, writeResults } from './report.ts';
import { runSuite } from './suite.ts';

const RESULTS_DIR = fileURLToPath(new URL('../results/', import.meta.url));
const DEFAULT_MAX_USD = 3;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let args;
try {
  args = parseArgs({
    options: {
      only: { type: 'string' },
      repeat: { type: 'string', default: '1' },
      'max-usd': { type: 'string' },
      list: { type: 'boolean', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
    },
    strict: true,
  }).values;
} catch (e) {
  fail(`${e instanceof Error ? e.message : String(e)}\nUsage: pnpm eval [--only a,b] [--repeat n] [--max-usd x] [--list] [--verbose]`);
}

if (args.list) {
  const width = Math.max(...SCENARIOS.map((s) => s.name.length));
  for (const s of SCENARIOS) console.log(`${s.name.padEnd(width)}  ${s.description}`);
  process.exit(0);
}

const repeat = Number(args.repeat);
if (!Number.isInteger(repeat) || repeat < 1) fail(`--repeat must be a whole number of at least 1; got "${args.repeat}".`);
const maxRaw = args['max-usd'] ?? process.env.EVAL_MAX_USD ?? String(DEFAULT_MAX_USD);
const maxUsd = Number(maxRaw);
if (!Number.isFinite(maxUsd) || maxUsd < 0) fail(`--max-usd must be a number of dollars; got "${maxRaw}".`);

let selected = SCENARIOS;
if (args.only) {
  const names = args.only.split(',').map((n) => n.trim()).filter(Boolean);
  const unknown = names.filter((n) => !SCENARIOS.some((s) => s.name === n));
  if (unknown.length > 0) fail(`Unknown scenario: ${unknown.join(', ')}. Run pnpm eval --list to see them.`);
  selected = SCENARIOS.filter((s) => names.includes(s.name));
}

if (!process.env.ANTHROPIC_API_KEY) {
  fail('Set ANTHROPIC_API_KEY (in the repo-root .env or the environment) to run the evals. They call the real API and cost money.');
}

const keyhole = inProcessKeyhole(process.env);
const describeBudget = (b: BudgetStatus) => `${usd(b.spentUsd)} of $${b.capUsd} spent this month (${b.state})`;

const budgetBefore = await budgetStatus(keyhole.handler);
console.log(`Model ${keyhole.model} · effort ${keyhole.effort} · Budget: ${describeBudget(budgetBefore)}`);
if (budgetBefore.state === 'capped') fail(`This month's Claude budget is used up; it resets ${budgetBefore.resetsAt}.`);
console.log(`Running ${selected.length} scenario${selected.length === 1 ? '' : 's'}${repeat > 1 ? ` × ${repeat}` : ''}, stopping once this run spends ${usd(maxUsd)}.`);

const startedAt = new Date().toISOString();
const { results } = await runSuite(selected, keyhole.client, {
  repeat,
  maxUsd,
  onStart: (s, run) => console.log(`\n${s.name}${repeat > 1 ? ` (run ${run})` : ''}: ${s.description}`),
  onResult: (r) => {
    if (r.status === 'skip') console.log('');
    for (const line of scenarioLines(r, { log: !args.verbose && r.status !== 'pass' })) console.log(line);
  },
  ...(args.verbose ? { onLine: (line: string) => console.log(`  ${line}`) } : {}),
});

const budgetAfter = await budgetStatus(keyhole.handler).catch(() => null);
const totals = totalsOf(results, budgetAfter ?? budgetBefore);
for (const line of summaryLines(results, totals)) console.log(line);
if (budgetAfter) console.log(`\nBudget now: ${describeBudget(budgetAfter)}`);

let gitSha: string | null;
try {
  gitSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {
  gitSha = null;
}
const path = writeResults(RESULTS_DIR, {
  startedAt,
  finishedAt: new Date().toISOString(),
  models: [...new Set(results.flatMap((r) => r.turns.flatMap((t) => t.models)))],
  configuredModel: keyhole.model,
  effort: keyhole.effort,
  gitSha,
  args: { only: args.only ?? null, repeat, maxUsd, verbose: args.verbose },
  budgetBefore,
  budgetAfter,
  scenarios: results,
  totals,
});
console.log(`Results: ${path}`);

process.exit(results.every((r) => r.status === 'pass') ? 0 : 1);
