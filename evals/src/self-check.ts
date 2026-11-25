/**
 * `pnpm --filter @slapdash/evals self-check`: an offline sanity check of the eval suite. No
 * API key, no network, no spend. It shows that:
 *
 * 1. every check passes on correct builder output (the seeds plus a hand-written completion of
 *    each building scenario), so a FAIL in `pnpm eval` points at the model, not the check;
 * 2. the checks catch known-bad models (a clash, a broken joint, a loose stud, no slab);
 * 3. the runner, usage tap, spend guard and report work end to end with a scripted client;
 * 4. the in-process keyhole ignores Supabase sign-in.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptedClient, say } from '@slapdash/agent/testing';
import { DESIGN_LOAD_TABLE, TIER1_CATALOG } from '@slapdash/catalog';
import { CommandBus, createProject, formatErrors, GROUND, indexCatalog, type Project } from '@slapdash/core';
import {
  assemblyCount,
  commonStudLength,
  distanceFromWallEnd,
  FT,
  framingConnected,
  headerOverOpening,
  hasOpening,
  heightAboveGrade,
  isSiteContext,
  jointsValid,
  noClashes,
  noClashesWith,
  slabFootprint,
  soundBuild,
} from './checks.ts';
import { questionNoChange } from './cases/question-no-change.ts';
import { SCENARIOS } from './cases/index.ts';
import { budgetStatus, inProcessKeyhole } from './harness.ts';
import { scenarioLines, summaryLines, totalsOf } from './report.ts';
import { POOL_HOUSE_WALLS, SHED_WALLS_8x10, TREE_ON_LINE, type SeedCommands } from './seeds.ts';
import { runSuite } from './suite.ts';

const catalog = indexCatalog(TIER1_CATALOG);
let failures = 0;
let passes = 0;

function check(what: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passes++;
    return;
  }
  failures++;
  console.log(`  ✗ ${what}${detail === undefined ? '' : `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

/** Expect a check (or list of checks) to pass. */
const passesCheck = (what: string, f: string | null | ReadonlyArray<string | null>) => {
  const list = (Array.isArray(f) ? f : [f]).filter((x): x is string => x !== null);
  check(what, list.length === 0, list.join('; '));
};

/** Expect a check to fail. */
const failsCheck = (what: string, f: string | null | readonly string[]) => {
  const list = Array.isArray(f) ? f : [f];
  check(`${what} should be caught`, list.some((x) => x !== null));
};

function build(commands: SeedCommands): Project {
  const bus = new CommandBus({ project: createProject({ name: 'Self-check' }), catalog: TIER1_CATALOG, siteDefaults: () => ({ table: DESIGN_LOAD_TABLE }) });
  for (const [name, input] of commands) {
    const res = bus.execute(name, input);
    if (!res.ok) throw new Error(`${name}: ${formatErrors(res.errors)}`);
  }
  return bus.project;
}

function section(title: string, fn: () => void | Promise<void>) {
  return async () => {
    const before = failures;
    console.log(title);
    try {
      await fn();
    } catch (e) {
      failures++;
      console.log(`  ✗ threw: ${e instanceof Error ? e.stack : String(e)}`);
    }
    console.log(failures === before ? '  ok' : `  ${failures - before} problem(s)`);
  };
}

// ── 1. Known-good models ────────────────────────────────────────────────────

const goodModels = section('Checks pass on correct builder output', () => {
  for (const [name, seed] of [
    ['POOL_HOUSE_WALLS', POOL_HOUSE_WALLS],
    ['SHED_WALLS_8x10', SHED_WALLS_8x10],
    ['TREE_ON_LINE', TREE_ON_LINE],
  ] as const) {
    passesCheck(`seed ${name} is sound`, soundBuild(build(seed), catalog));
  }

  // pool-house / pool-house-sliding-door / gable-roof
  const shell = build([
    ...POOL_HOUSE_WALLS,
    ['add_opening', { wallId: 'W3', kind: 'sliding-door', centerAt: '10ft' }],
    ['build_roof', { type: 'gable', from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' }, pitch: '6 in 12' }],
  ]);
  passesCheck('shell is sound', soundBuild(shell, catalog));
  passesCheck('shell slab 16×20', slabFootprint(shell, 16, 20));
  passesCheck('shell slab 20×16 (either way round)', slabFootprint(shell, 20, 16));
  passesCheck('shell has 4 walls', assemblyCount(shell, 'wall', 4));
  passesCheck('9ft walls have 103 1/2in studs', commonStudLength(shell, 103.5));
  const slider = hasOpening(shell, { kind: 'sliding-door', wall: 'south', minWidthIn: 72 });
  passesCheck('sliding door on the south wall', slider.fail);
  passesCheck('header over the sliding door', headerOverOpening(shell, slider.opening));
  check('the gable ridge runs along x', (shell.assemblies.R1?.builder?.params as { ridgeAxis?: string } | undefined)?.ridgeAxis === 'x');

  // fence
  const fence = build([['build_fence', { path: [{ x: 0, z: 0 }, { x: '40ft', z: 0 }], height: '6ft' }]]);
  passesCheck('fence is sound', soundBuild(fence, catalog));
  passesCheck('fence is 6ft tall', heightAboveGrade(fence, 'M1', 6));

  // shed-roof
  const shed = build([...SHED_WALLS_8x10, ['build_roof', { type: 'shed', from: { x: 0, z: 0 }, to: { x: '10ft', z: '8ft' }, pitch: '3 in 12', lowSide: 'north' }]]);
  passesCheck('shed roof is sound', soundBuild(shed, catalog));
  passesCheck('8ft walls have 91 1/2in studs', commonStudLength(build([...SHED_WALLS_8x10.slice(0, 2)]), 91.5));

  // plan-revision
  const floor = build([['frame_floor', { from: { x: 0, z: 0 }, to: { x: '14ft', z: '10ft' }, support: 'piers' }]]);
  passesCheck('floor on piers is sound', soundBuild(floor, catalog));

  // undo / small-change-no-plan
  const window = build([...POOL_HOUSE_WALLS, ['add_opening', { wallId: 'W2', kind: 'window', centerAt: '8ft', width: '3ft' }]]);
  passesCheck('window model is sound', soundBuild(window, catalog));
  passesCheck('3ft window on the east wall', hasOpening(window, { kind: 'window', wall: 'east', widthIn: 36 }).fail);
  const door = build([...POOL_HOUSE_WALLS, ['add_opening', { wallId: 'W4', kind: 'door', centerAt: '12ft' }]]);
  passesCheck('door model is sound', soundBuild(door, catalog));
  const d = hasOpening(door, { kind: 'door', wall: 'west', widthIn: 38 });
  passesCheck('38in door on the west wall', d.fail);
  passesCheck('header over the door', headerOverOpening(door, d.opening));
  // W4 runs south → north, 16ft long: centre 12ft from its start is 4ft from the north corner.
  check('door centre is 4ft from the north corner', d.opening !== null && Math.abs(distanceFromWallEnd(door, d.opening, 'north') - 4 * FT) < 1);
  failsCheck('a door looked for on the wrong wall', hasOpening(door, { kind: 'door', wall: 'east' }).fail);

  // just-do-it
  const shed12 = build([
    ['pour_slab', { from: { x: 0, z: 0 }, to: { x: '12ft', z: '10ft' } }],
    ['build_wall', { start: { x: 0, z: 0 }, end: { x: '12ft', z: 0 }, height: '8ft' }],
    ['build_wall', { start: { x: '12ft', z: 0 }, end: { x: '12ft', z: '10ft' }, height: '8ft' }],
    ['build_wall', { start: { x: '12ft', z: '10ft' }, end: { x: 0, z: '10ft' }, height: '8ft' }],
    ['build_wall', { start: { x: 0, z: '10ft' }, end: { x: 0, z: 0 }, height: '8ft' }],
  ]);
  passesCheck('10×12 shed shell is sound', soundBuild(shed12, catalog));
  passesCheck('10×12 slab', slabFootprint(shed12, 10, 12));

  // clash-avoidance: a fence routed around the trunk
  const around = build([
    ...TREE_ON_LINE,
    ['build_fence', { path: [{ x: 0, z: 0 }, { x: '13ft', z: 0 }, { x: '13ft', z: '3ft' }, { x: '17ft', z: '3ft' }, { x: '17ft', z: 0 }, { x: '30ft', z: 0 }], height: '4ft', style: 'picket' }],
  ]);
  passesCheck('fence routed around the tree has valid joints', jointsValid(around, catalog));
  passesCheck('fence routed around the tree has nothing loose', framingConnected(around));
  passesCheck('fence routed around the tree misses the trunk', noClashesWith(around, isSiteContext, 'the tree'));
  // Known builder defect: build_fence overlaps its own boards/rails at path corners. Noted, not failed.
  const corners = noClashes(around);
  if (corners) console.log(`  note: build_fence overlaps itself at path corners (builder issue, not an eval problem): ${corners}`);
  let straightRefused = false;
  try {
    build([...TREE_ON_LINE, ['build_fence', { path: [{ x: 0, z: 0 }, { x: '30ft', z: 0 }], height: '4ft', style: 'picket' }]]);
  } catch {
    straightRefused = true;
  }
  check('a straight fence through the tree is refused (the scenario needs that)', straightRefused);

  // refuse-impossible-span
  let wideRefused = false;
  try {
    build([...POOL_HOUSE_WALLS, ['add_opening', { wallId: 'W3', kind: 'door', centerAt: '10ft', width: '20ft' }]]);
  } catch (e) {
    wideRefused = /header|beam/i.test(String(e));
  }
  check('a 20ft opening is refused for its header (the scenario needs that)', wideRefused);
});

// ── 2. Known-bad models ─────────────────────────────────────────────────────

const badModels = section('Checks catch known-bad models', () => {
  const good = build(POOL_HOUSE_WALLS);
  const stud = Object.values(good.parts).find((p) => p.role === 'stud' && p.tags.includes('common'))!;

  const clash: Project = { ...good, parts: { ...good.parts, 'W1-S999': { ...stud, id: 'W1-S999' } } };
  failsCheck('an overlapping stud', noClashes(clash));
  const tree = build(TREE_ON_LINE);
  const trunk = Object.values(tree.parts).find((p) => p.tags.includes('kind:tree'))!;
  const post = { ...trunk, id: 'M1-PT01', assemblyId: 'M1', role: 'post' as const, tags: ['fence-post'] };
  const throughTree: Project = { ...tree, parts: { ...tree.parts, [post.id]: post } };
  failsCheck('a post through the tree', noClashesWith(throughTree, isSiteContext, 'the tree'));

  const anyJoint = Object.values(good.joints)[0]!;
  const missing: Project = { ...good, joints: { ...good.joints, J9999: { ...anyJoint, id: 'J9999', partIds: ['W9-S01', GROUND] } } };
  failsCheck('a joint to a missing part', jointsValid(missing, catalog));
  const groundFirst: Project = { ...good, joints: { ...good.joints, J9998: { ...anyJoint, id: 'J9998', partIds: [GROUND, stud.id] } } };
  failsCheck('GROUND as the first part', jointsValid(groundFirst, catalog));
  const badType: Project = { ...good, joints: { ...good.joints, J9997: { ...anyJoint, id: 'J9997', jointTypeId: 'glued-with-hope' } } };
  failsCheck('an unknown joint type', jointsValid(badType, catalog));

  const loose: Project = { ...good, joints: Object.fromEntries(Object.entries(good.joints).filter(([, j]) => !j.partIds.includes(stud.id))) };
  failsCheck('a stud with no joints', framingConnected(loose));

  const empty = createProject({ name: 'Empty' });
  failsCheck('no slab', slabFootprint(empty, 16, 20));
  failsCheck('the wrong slab size', slabFootprint(good, 16, 24));
  failsCheck('the wrong stud length', commonStudLength(good, 91.5));
  failsCheck('no opening', hasOpening(good, { kind: 'door', wall: 'west' }).fail);
});

// ── 3. Runner, usage tap, spend guard, report ───────────────────────────────

const runner = section('Runner, usage tap, spend guard and report work offline', async () => {
  const names = SCENARIOS.map((s) => s.name);
  check('at least 10 scenarios', names.length >= 10, names.length);
  check('scenario names are unique', new Set(names).size === names.length);

  const good = scriptedClient([say('The walls are 9ft tall and the slab is 20ft × 16ft.')]);
  const pass = await runSuite([questionNoChange], good.client, { maxUsd: 1 });
  const r = pass.results[0]!;
  check('a correct answer passes', r.status === 'pass', { status: r.status, failures: r.failures, error: r.error });
  check('one turn is recorded', r.turns.length === 1);
  const t = r.turns[0];
  check('tokens are tapped from the stream', t?.tokens.input === 10 && t?.tokens.output === 20, t?.tokens);
  check('cost is recorded', t?.costUsd === 0.01, t?.costUsd);
  check('budget is recorded', t?.budget?.capUsd === 10);

  const wrong = scriptedClient([say("I'm not sure.")]);
  const fail = await runSuite([questionNoChange], wrong.client, { maxUsd: 1 });
  check('a wrong answer fails', fail.results[0]?.status === 'fail', fail.results[0]?.failures);

  const broken = scriptedClient([new Error('boom')]);
  const err = await runSuite([questionNoChange], broken.client, { maxUsd: 1 });
  check('a thrown error is reported as error', err.results[0]?.status === 'error' && err.results[0]?.error === 'boom', err.results[0]);

  const guard = scriptedClient([say('9ft walls.'), say('9ft walls.')]);
  const guarded = await runSuite([questionNoChange, questionNoChange], guard.client, { maxUsd: 0.005 });
  check(
    'the spend guard skips the rest once --max-usd is reached',
    guarded.results.map((x) => x.status).join(',') === 'pass,skip' && /spend limit/.test(guarded.results[1]?.skipReason ?? ''),
    guarded.results.map((x) => [x.status, x.skipReason]),
  );

  const repeated = scriptedClient([say('9ft.'), say('9ft.')]);
  const rep = await runSuite([questionNoChange], repeated.client, { maxUsd: 1, repeat: 2 });
  check('--repeat runs each scenario n times', rep.results.length === 2);

  const all = [...pass.results, ...fail.results, ...err.results, ...guarded.results, ...rep.results];
  const totals = totalsOf(all, r.turns[0]?.budget ?? null);
  const lines = [...all.flatMap((x) => scenarioLines(x, { log: x.status !== 'pass' })), ...summaryLines(all, totals)];
  check('the report formats', lines.some((l) => l.startsWith('PASS question-no-change')) && lines.some((l) => l.startsWith('SKIP')) && lines.some((l) => l.includes('typical turns')));
  check('the cap projection uses typical turns', totals.typicalTurnsPerCap !== null && totals.typicalTurnsPerCap > 0, totals);
});

// ── 4. Sign-in bypass ───────────────────────────────────────────────────────

const signIn = section('The in-process keyhole skips Supabase sign-in', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'slapdash-evals-'));
  const keyhole = inProcessKeyhole({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
    VITE_SUPABASE_URL: 'https://example.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
    SLAPDASH_USAGE_FILE: join(dir, 'usage.json'),
  });
  const res = await keyhole.handler(
    new Request('http://localhost/api/claude', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) }),
  );
  const body = (await res.json()) as { error?: string };
  // No API key here, so the keyhole stops at "not configured" — after the sign-in check it would otherwise fail.
  check('POST is not asked to sign in', res.status === 503 && body.error === 'not_configured', { status: res.status, body });
  const budget = await budgetStatus(keyhole.handler);
  check('the budget can be read', typeof budget.capUsd === 'number' && budget.capUsd > 0, budget);
});

for (const run of [goodModels, badModels, runner, signIn]) await run();
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} self-check: ${passes} checks passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
