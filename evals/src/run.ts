/**
 * `pnpm eval`: runs every case against the real Claude API through an in-process keyhole and
 * reports pass/fail and the cost of each turn. Needs ANTHROPIC_API_KEY (from the repo-root
 * .env or the environment). Costs money; run it before releases, not in CI.
 */
import { poolHouse, type CaseResult } from './cases/pool-house.ts';
import { inProcessKeyhole } from './harness.ts';

const CASES = [poolHouse];

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Set ANTHROPIC_API_KEY (in the repo-root .env or the environment) to run the evals. They call the real API and cost money.');
  process.exit(1);
}

const client = inProcessKeyhole(process.env);
const log = (line: string) => console.log(line);
let failed = 0;
let total = 0;

for (const run of CASES) {
  console.log(`\n${run.name}`);
  let result: CaseResult;
  try {
    result = await run(client, log);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${run.name}: ${e instanceof Error ? e.message : String(e)}`);
    continue;
  }
  const cost = result.costs.reduce((a, b) => a + b, 0);
  total += cost;
  console.log(`  cost per turn: ${result.costs.map((c) => `$${c.toFixed(4)}`).join(', ')} (total $${cost.toFixed(4)})`);
  if (result.failures.length === 0) {
    console.log(`  PASS ${result.name}`);
  } else {
    failed++;
    console.log(`  FAIL ${result.name}`);
    for (const f of result.failures) console.log(`    - ${f}`);
  }
}

console.log(`\n${CASES.length - failed}/${CASES.length} passed · total cost $${total.toFixed(4)}`);
process.exit(failed > 0 ? 1 : 0);
