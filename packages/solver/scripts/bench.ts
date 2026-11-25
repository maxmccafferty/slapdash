/**
 * Times `analyze` on the pool-house shell (built through the core CommandBus with the
 * tier-1 catalog, the same commands as apps/web/src/model/sample-shell.ts).
 *
 *   pnpm --filter @slapdash/solver bench [runs]
 */
import { CATALOG } from '@slapdash/catalog';
import { CommandBus, createProject, formatErrors, indexCatalog } from '@slapdash/core';
import { analyze } from '../src/index.ts';
import { POOL_HOUSE_COMMANDS } from '../test/helpers.ts';

const runs = Number(process.argv[2]) || 10;
const bus = new CommandBus({ project: createProject({ name: 'Pool house' }), catalog: CATALOG });
for (const [cmd, input] of POOL_HOUSE_COMMANDS) {
  const res = bus.execute(cmd, input);
  if (!res.ok) throw new Error(`${cmd}: ${formatErrors(res.errors)}`);
}
const project = bus.project;
const catalog = indexCatalog(CATALOG);

const first = analyze(project, catalog);
const times: number[] = [];
for (let i = 0; i < runs; i++) times.push(analyze(project, catalog).stats.ms);
times.sort((a, b) => a - b);
const pick = (q: number) => times[Math.min(times.length - 1, Math.ceil(q * times.length) - 1)]!;
const { nodes, dofs, elements, links, profile } = first.stats;
console.log(`pool house: ${Object.keys(project.parts).length} parts, ${Object.keys(project.joints).length} joints`);
console.log(`model: ${nodes} nodes, ${dofs} DOFs, ${elements} elements, ${links} links, profile ${profile} entries`);
console.log(`first run (cold): ${first.stats.ms.toFixed(0)} ms`);
console.log(`${runs} runs: median ${pick(0.5).toFixed(0)} ms, p95 ${pick(0.95).toFixed(0)} ms, min ${times[0]!.toFixed(0)} ms`);
