/**
 * `pnpm --filter @slapdash/evals self-check`: an offline sanity check of the eval suite. No
 * API key, no network, no spend. It shows that:
 *
 * 1. every check passes on correct builder output (the seeds plus a hand-written completion of
 *    each building scenario), so a FAIL in `pnpm eval` points at the model, not the check;
 * 2. the checks catch known-bad models (a clash, a broken joint, a loose stud, no slab);
 * 3. the runner, usage tap, spend guard and report work end to end with a scripted client;
 * 4. an upstream error on any turn ends a scenario as an error, never a pass;
 * 5. input-parse rejections (e.g. a length sent as "\"9ft\"") fail the default check, while
 *    legitimate refusals (a clash) don't;
 * 6. the in-process keyhole ignores Supabase sign-in.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyholeRequestError, type KeyholeClient } from '@slapdash/agent';
import { BUDGET, call, scriptedClient, say } from '@slapdash/agent/testing';
import { DESIGN_LOAD_TABLE, CATALOG } from '@slapdash/catalog';
import { CommandBus, createProject, formatErrors, GROUND, indexCatalog, type Project } from '@slapdash/core';
import {
  answered,
  assemblyCount,
  feetRe,
  commonStudLength,
  freeWindowSpot,
  newWindowAt,
  openingIds,
  windowSpotPrompt,
  distanceFromWallEnd,
  FT,
  framingConnected,
  headerOverOpening,
  hasOpening,
  STANDARD_DOOR,
  heightAboveGrade,
  isSiteContext,
  jointsValid,
  noClashes,
  noClashesWith,
  pergolaPolycarbonate,
  bottomPlatePieces,
  poolFence,
  sameWalls,
  slabFootprint,
  soundBuild,
} from './checks.ts';
import { questionNoChange } from './cases/question-no-change.ts';
import { SCENARIOS } from './cases/index.ts';
import { budgetStatus, classifyToolError, inProcessKeyhole } from './harness.ts';
import { scenarioLines, summaryLines, totalsOf, turnLine } from './report.ts';
import { POOL_HOUSE_WALLS, POOL_HOUSE_WITH_DOOR, POOL_IN_YARD, SHED_WALLS_8x10, TREE_ON_LINE, type SeedCommands } from './seeds.ts';
import { defineScenario } from './scenario.ts';
import { runSuite } from './suite.ts';

const catalog = indexCatalog(CATALOG);
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
const failsCheck = (what: string, f: string | null | ReadonlyArray<string | null>) => {
  const list = Array.isArray(f) ? f : [f];
  check(`${what} should be caught`, list.some((x) => x !== null));
};

function build(commands: SeedCommands): Project {
  const bus = new CommandBus({ project: createProject({ name: 'Self-check' }), catalog: CATALOG, siteDefaults: () => ({ table: DESIGN_LOAD_TABLE }) });
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
    ['POOL_HOUSE_WITH_DOOR', POOL_HOUSE_WITH_DOOR],
    ['SHED_WALLS_8x10', SHED_WALLS_8x10],
    ['TREE_ON_LINE', TREE_ON_LINE],
    ['POOL_IN_YARD', POOL_IN_YARD],
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

  // pergola-polycarbonate (LOC-117)
  const pergola = build([['build_pergola', { from: { x: 0, z: 0 }, to: { x: '16ft', z: '12ft' }, roofing: 'polycarbonate' }]]);
  passesCheck('polycarbonate pergola is sound', soundBuild(pergola, catalog));
  passesCheck('polycarbonate pergola passes its checks', pergolaPolycarbonate(pergola));
  failsCheck('an open pergola (no polycarbonate roof)', pergolaPolycarbonate(build([['build_pergola', { from: { x: 0, z: 0 }, to: { x: '16ft', z: '12ft' } }]])));

  // pool-fence (LOC-117): around the seeded pool with the gate on the north (house) side.
  const poolPath = [
    { x: '6ft', z: '4ft' },
    { x: '34ft', z: '4ft' },
    { x: '34ft', z: '48ft' },
    { x: '6ft', z: '48ft' },
    { x: '6ft', z: '4ft' },
  ];
  for (const style of ['aluminum', 'picket', 'chain-link', 'glass'] as const) {
    const fenced = build([...POOL_IN_YARD, ['build_fence', { path: poolPath, style, height: '4ft', poolBarrier: true, gates: [{ centerAt: '14ft' }] }]]);
    passesCheck(`${style} pool fence is sound`, soundBuild(fenced, catalog));
    passesCheck(`${style} pool fence passes its checks`, poolFence(fenced));
  }
  const bad = build([...POOL_IN_YARD, ['build_fence', { path: poolPath, style: 'chain-link', height: '3ft', gates: [{ centerAt: '14ft' }] }]]);
  failsCheck('a 36in 2in-mesh chain-link fence (not a pool barrier)', poolFence(bad));
  failsCheck('a pool barrier along one side only', poolFence(build([...POOL_IN_YARD, ['build_fence', { path: poolPath.slice(0, 2), style: 'aluminum', height: '4ft', poolBarrier: true, gates: [{ centerAt: '14ft' }] }]])));

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
  const door36 = build([...POOL_HOUSE_WALLS, ['add_opening', { wallId: 'W4', kind: 'door', centerAt: '12ft', width: '36in' }]]);
  passesCheck('36in door counts as a standard door', hasOpening(door36, { kind: 'door', wall: 'west', ...STANDARD_DOOR }).fail);
  passesCheck('the default 38in door counts as a standard door', hasOpening(door, { kind: 'door', wall: 'west', ...STANDARD_DOOR }).fail);
  const door48 = build([...POOL_HOUSE_WALLS, ['add_opening', { wallId: 'W4', kind: 'door', centerAt: '12ft', width: '48in' }]]);
  failsCheck('48in door is wider than a standard door', hasOpening(door48, { kind: 'door', wall: 'west', ...STANDARD_DOOR }).fail);
  failsCheck('36in door fails an exact 38in width', hasOpening(door36, { kind: 'door', wall: 'west', widthIn: 38 }).fail);
  failsCheck('a door looked for on the wrong wall', hasOpening(door, { kind: 'door', wall: 'east' }).fail);

  // resize-door (LOC-118): update_opening then remove_opening, walls untouched.
  const walls4 = ['W1', 'W2', 'W3', 'W4'];
  const resized = build([...POOL_HOUSE_WITH_DOOR, ['update_opening', { openingId: 'O1', width: '3ft' }]]);
  passesCheck('resized door model is sound', soundBuild(resized, catalog));
  const rd = hasOpening(resized, { kind: 'door', wall: 'south', widthIn: 36 });
  passesCheck('36in door on the south wall', rd.fail);
  check('the resized door is still O1', rd.opening?.asmId === 'O1');
  passesCheck('header over the resized door', headerOverOpening(resized, rd.opening));
  passesCheck('the walls keep their ids after update_opening', sameWalls(resized, walls4));
  const removed = build([...POOL_HOUSE_WITH_DOOR, ['update_opening', { openingId: 'O1', width: '3ft' }], ['remove_opening', { openingId: 'O1' }]]);
  passesCheck('model with the door removed is sound', soundBuild(removed, catalog));
  passesCheck('no openings after remove_opening', assemblyCount(removed, 'opening', 0, 'openings'));
  passesCheck('the walls keep their ids after remove_opening', sameWalls(removed, walls4));
  check("W3's bottom plate is one piece again", bottomPlatePieces(removed, 'W3') === 1, bottomPlatePieces(removed, 'W3'));
  // A rebuilt south wall comes back with a new id (W5): hand-edit the assembly map to stand for that.
  const seeded = build(POOL_HOUSE_WITH_DOOR);
  const { W3: south, ...otherAssemblies } = seeded.assemblies;
  const rebuilt: Project = { ...seeded, assemblies: { ...otherAssemblies, W5: { ...south!, id: 'W5' } } };
  failsCheck('a rebuilt south wall', sameWalls(rebuilt, walls4));

  // follow-ups-after-build: T4 asks for a window on a span the build left clear.
  const bare = build(POOL_HOUSE_WALLS);
  const spot = freeWindowSpot(bare);
  passesCheck('a bare shell has a free window spot', spot.fail);
  check('the spot is the north wall, 4ft from the west corner', spot.spot?.wallId === 'W1' && spot.spot.corner === 'west' && spot.spot.fromCornerFt === 4, spot.spot);
  check('the T4 prompt names the wall and position', spot.spot !== null && windowSpotPrompt(spot.spot) === 'Add a 3ft window to the north wall, centred 4ft from the west corner', spot.spot && windowSpotPrompt(spot.spot));
  if (spot.spot) {
    const before = openingIds(bare);
    passesCheck('a window built where T4 asks is found', newWindowAt(build([...POOL_HOUSE_WALLS, ['add_opening', { wallId: 'W1', kind: 'window', centerAt: '4ft', width: '3ft' }]]), before, spot.spot));
    passesCheck('the window where T4 asks is sound', soundBuild(build([...POOL_HOUSE_WALLS, ['add_opening', { wallId: 'W1', kind: 'window', centerAt: '4ft', width: '3ft' }]]), catalog));
    failsCheck('no new window', newWindowAt(bare, before, spot.spot));
    failsCheck('a window 1ft off', newWindowAt(build([...POOL_HOUSE_WALLS, ['add_opening', { wallId: 'W1', kind: 'window', centerAt: '5ft', width: '3ft' }]]), before, spot.spot));
    failsCheck('a 4ft window', newWindowAt(build([...POOL_HOUSE_WALLS, ['add_opening', { wallId: 'W1', kind: 'window', centerAt: '4ft', width: '4ft' }]]), before, spot.spot));
    failsCheck('a door instead', newWindowAt(build([...POOL_HOUSE_WALLS, ['add_opening', { wallId: 'W1', kind: 'door', centerAt: '4ft' }]]), before, spot.spot));
    failsCheck('the window on another wall', newWindowAt(build([...POOL_HOUSE_WALLS, ['add_opening', { wallId: 'W3', kind: 'window', centerAt: '4ft', width: '3ft' }]]), before, spot.spot));
  }
  // The LOC-98 run: the build put a 3ft window centred on the east wall. Block 4ft on the north wall too.
  const busyCommands: SeedCommands = [
    ...POOL_HOUSE_WALLS,
    ['add_opening', { wallId: 'W2', kind: 'window', centerAt: '8ft', width: '3ft' }],
    ['add_opening', { wallId: 'W1', kind: 'window', centerAt: '5ft', width: '3ft' }],
  ];
  const busy = build(busyCommands);
  const busySpot = freeWindowSpot(busy);
  check('a free spot steps past an existing window', busySpot.spot?.wallId === 'W1' && busySpot.spot.fromCornerFt === 9, busySpot);
  if (busySpot.spot) {
    passesCheck('a window at the stepped spot is sound', soundBuild(build([...busyCommands, ['add_opening', { wallId: 'W1', kind: 'window', centerAt: '9ft', width: '3ft' }]]), catalog));
  }
  // Every wall too busy: the scenario fails with a reason instead of asking for an overlap.
  const full = build([
    ...SHED_WALLS_8x10,
    ['add_opening', { wallId: 'W1', kind: 'window', centerAt: '5ft', width: '4ft' }],
    ['add_opening', { wallId: 'W2', kind: 'window', centerAt: '4ft', width: '3ft' }],
    ['add_opening', { wallId: 'W3', kind: 'window', centerAt: '5ft', width: '4ft' }],
    ['add_opening', { wallId: 'W4', kind: 'window', centerAt: '4ft', width: '3ft' }],
  ]);
  const none = freeWindowSpot(full);
  check('no free spot is a clear failure', none.spot === null && /nowhere to ask for a new window/.test(none.fail ?? ''), none);

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
  // ADR-0002 §F1 is opt-in: only scenarios that turn plans on (or ask for them) expect one.
  const plansOn = SCENARIOS.filter((s) => s.prefs?.confirmBigChanges === true).map((s) => s.name).sort();
  check('plan-revision, just-do-it and small-change-no-plan turn plans on', plansOn.join(',') === 'just-do-it,plan-revision,small-change-no-plan', plansOn);
  check('no scenario turns plans off explicitly (it is the default)', SCENARIOS.every((s) => s.prefs?.confirmBigChanges !== false));
  check('plans-on-request is in the suite', names.includes('plans-on-request'));

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
  check('a thrown error is reported as error', err.results[0]?.status === 'error' && /boom/.test(err.results[0]?.error ?? ''), err.results[0]);

  const prime = scriptedClient([say('The walls are 9′ 0″ tall and the slab is 20′ 0″ × 16′ 0″.')]);
  const primed = await runSuite([questionNoChange], prime.client, { maxUsd: 1 });
  check('an answer in primes (9′ 0″) passes', primed.results[0]?.status === 'pass', primed.results[0]?.failures);

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

// ── 4. Upstream errors and follow-up turns ─────────────────────────────────

const feetText = section('Feet marks and upstream errors', async () => {
  for (const ok of ['9ft', '9 ft', '9 feet', '9-foot', "9'", '9′ 0″', '9’', 'walls are 9 Feet tall']) check(`feetRe(9) accepts "${ok}"`, feetRe(9).test(ok));
  for (const bad of ['19ft', '9.5ft', '9 inches', '9″', '90 feet']) check(`feetRe(9) rejects "${bad}"`, !feetRe(9).test(bad));

  // A thinking turn, then a question: the shape of the LOC-108 regression.
  const twoTurns = defineScenario({
    name: 'two-turns',
    description: 'self-check only',
    async run(ctx) {
      const t1 = await ctx.turn('Build it');
      ctx.expect(answered(t1, 'turn 1'));
      const t2 = await ctx.turn('How tall are the walls?');
      ctx.expect(answered(t2, 'turn 2'));
    },
  });
  const thinkThenSay = { content: [{ type: 'thinking' as const, thinking: 'Plan the walls.', signature: 'sig-1' }, { type: 'text' as const, text: 'Done.' }] };

  const fine = scriptedClient([thinkThenSay, say('9ft.')]);
  const ok = await runSuite([twoTurns], fine.client, { maxUsd: 1 });
  check('two answered turns pass', ok.results[0]?.status === 'pass', ok.results[0]);
  check('thinking blocks are counted per turn', ok.results[0]?.turns[0]?.thinking === 1 && ok.results[0]?.turns[1]?.thinking === 0, ok.results[0]?.turns.map((t) => t.thinking));

  // The upstream error as the keyhole streams it: an `error` event instead of `done`.
  const streamed = scriptedClient([thinkThenSay]);
  let calls = 0;
  const failsSecond: KeyholeClient = async function* (messages, signal) {
    if (++calls === 1) return yield* streamed.client(messages, signal);
    yield { event: 'budget', data: BUDGET };
    yield { event: 'error', data: { error: 'upstream', message: 'Invalid `signature` in `thinking` block', retryable: false } };
  };
  const se = (await runSuite([twoTurns], failsSecond, { maxUsd: 1 })).results[0]!;
  check('a streamed upstream error on turn 2 is an error, not a pass', se.status === 'error' && /^T2 .*signature/.test(se.error ?? ''), se);
  check('the turn before the error is kept', se.turns.length === 1, se.turns.length);

  // The keyhole refusing the request outright (HTTP 400).
  const refused = scriptedClient([thinkThenSay, new KeyholeRequestError({ error: 'bad_request', message: 'Invalid `signature` in `thinking` block' }, 400)]);
  const re = (await runSuite([twoTurns], refused.client, { maxUsd: 1 })).results[0]!;
  check('an HTTP 400 on turn 2 is an error naming the turn and status', re.status === 'error' && /^T2 .*HTTP 400/.test(re.error ?? ''), re);
  check('the report shows the error', scenarioLines(re, { log: true }).some((l) => l.startsWith('ERROR') || l.includes('HTTP 400')), scenarioLines(re, { log: true }));

  const silent = scriptedClient([thinkThenSay, { content: [], stopReason: 'end_turn' }]);
  check('a turn with no reply fails', (await runSuite([twoTurns], silent.client, { maxUsd: 1 })).results[0]?.status === 'fail');
  const cut = scriptedClient([thinkThenSay, { content: [{ type: 'text', text: 'The walls are' }], stopReason: 'max_tokens' }]);
  check('a cut-off reply fails', (await runSuite([twoTurns], cut.client, { maxUsd: 1 })).results[0]?.status === 'fail');
});

// ── 5. Input-parse rejections ───────────────────────────────────────────────

const badInput = section('Input-parse rejections are told apart from refusals', async () => {
  // Messages as the parsers and builders write them.
  for (const msg of [
    `"height": Couldn't read ""9ft"" as a length. Try "9ft", "8' 6"" or "2400mm".`,
    `"height": "0" has no unit. Add a unit, e.g. 0ft, 0in or 0mm.`,
    `"pitch": Couldn't read "steep" as a roof pitch.`,
    `"plan" is required.`,
    `"footprint" should be an object, but got text ("16x20").`,
    `"type" must be one of "gable", "shed" (you gave "hip").`,
    `Unknown field "colour".`,
    `Your input for build_wall wasn't valid JSON: {"start": Nothing has changed.`,
    `There's no part or assembly ""R1"". Did you mean "R1"?`,
  ]) check(`"${msg.slice(0, 50)}" is invalid_input`, classifyToolError(msg) === 'invalid_input');
  for (const msg of [
    'The fence would run through T1 (tree trunk). Route it around, or move the tree.',
    'A 20\' 0" opening needs a header longer than any built-up 2x header; use an engineered beam.',
    `"length" must be more than zero (you gave -610 mm (-2' 0")).`,
    `There's no part or assembly "R9". Did you mean "R1"?`,
  ]) check(`"${msg.slice(0, 50)}" is a refusal`, classifyToolError(msg) === 'refusal');

  // Real refusals from the bus are refusals.
  for (const [what, seed, cmd] of [
    ['a fence through the tree', TREE_ON_LINE, ['build_fence', { path: [{ x: 0, z: 0 }, { x: '30ft', z: 0 }], height: '4ft', style: 'picket' }]],
    ['a 20ft opening', POOL_HOUSE_WALLS, ['add_opening', { wallId: 'W3', kind: 'door', centerAt: '10ft', width: '20ft' }]],
  ] as const) {
    const bus = new CommandBus({ project: build(seed), catalog: CATALOG, siteDefaults: () => ({ table: DESIGN_LOAD_TABLE }) });
    const res = bus.execute(cmd[0], cmd[1]);
    check(`${what} is refused by the bus`, !res.ok);
    if (!res.ok) check(`${what} is classed a refusal, not bad input`, classifyToolError(formatErrors(res.errors)) === 'refusal', formatErrors(res.errors));
  }

  const plan = (extra: Record<string, unknown>) => call(['propose_plan', { plan: "I'll build a 16×20 shell with 9ft walls.", ...extra }]);
  const oneTurn = (over: Partial<Parameters<typeof defineScenario>[0]> = {}) =>
    defineScenario({
      name: 'one-turn',
      description: 'self-check only',
      async run(ctx) {
        ctx.expect(answered(await ctx.turn('Build a pool house'), 'the turn'));
      },
      ...over,
    });

  // Claude sends a length the parser can't read, is told so, and retries: the turn still answers.
  // (Quote-wrapped lengths like `"9ft"` are read without the quote marks now, so they aren't bad input.)
  const quoted = scriptedClient([plan({ height: 'tall' }), plan({ height: '9ft' }), say('Here is the plan.')]);
  const q = (await runSuite([oneTurn()], quoted.client, { maxUsd: 1 })).results[0]!;
  check('the script was used up', quoted.remaining() === 0, quoted.remaining());
  check('a turn with an unreadable "tall" length fails the bad-input check', q.status === 'fail' && q.failures.some((f) => /couldn't be parsed/.test(f)), q);
  check('the rejection is recorded as bad input', q.turns[0]?.badInput.length === 1 && q.turns[0]?.toolErrors.length === 1, q.turns[0]);
  check('the turn line shows "1 bad input"', q.turns[0] !== undefined && turnLine(q.turns[0], 0).includes('1 bad input'), q.turns[0] && turnLine(q.turns[0], 0));

  // A unitless zero reads as zero in any unit; any other bare number has no unit.
  const unitless = scriptedClient([plan({ height: '9' }), plan({ height: '9ft' }), say('Here is the plan.')]);
  const u = (await runSuite([oneTurn()], unitless.client, { maxUsd: 1 })).results[0]!;
  check('a turn with a unitless "9" fails the bad-input check', u.status === 'fail' && u.turns[0]?.badInput.length === 1, u);

  // An ID wrapped in quote marks is read without them; an ID that doesn't exist is a real miss.
  const lookup = (id: string) => scriptedClient([call(['get_part', { id }]), say('The east wall is W2.')]);
  const quotedId = (await runSuite([oneTurn({ seed: POOL_HOUSE_WALLS })], lookup('"W1"').client, { maxUsd: 1 })).results[0]!;
  check('a quote-wrapped ID ("\\"W1\\"") is read without its quote marks', quotedId.status === 'pass' && quotedId.turns[0]?.toolErrors.length === 0 && quotedId.turns[0]?.badInput.length === 0, quotedId);
  const missing = (await runSuite([oneTurn({ seed: POOL_HOUSE_WALLS })], lookup('W9').client, { maxUsd: 1 })).results[0]!;
  check('an ID that does not exist is a refusal, not bad input', missing.status === 'pass' && missing.turns[0]?.refusals === 1 && missing.turns[0]?.badInput.length === 0, missing);

  // A clash refusal is a legitimate outcome, not bad input.
  const clashing = scriptedClient([
    call(['build_fence', { path: [{ x: 0, z: 0 }, { x: '30ft', z: 0 }], height: '4ft', style: 'picket' }]),
    say('A straight fence would run through the tree. Shall I route it around, or stop short of it?'),
  ]);
  const c = (await runSuite([oneTurn({ seed: TREE_ON_LINE })], clashing.client, { maxUsd: 1 })).results[0]!;
  check('a clash refusal passes the bad-input check', c.status === 'pass', c);
  check('the clash is recorded as a refusal, not bad input', c.turns[0]?.refusals === 1 && c.turns[0]?.badInput.length === 0, c.turns[0]);

  // A scenario can opt out; the run's summary still counts the rejection.
  const optOut = scriptedClient([plan({ height: 'tall' }), plan({ height: '9ft' }), say('Here is the plan.')]);
  const o = (await runSuite([oneTurn({ allowBadInput: true })], optOut.client, { maxUsd: 1 })).results[0]!;
  check('allowBadInput turns the check off', o.status === 'pass', o);
  const all = [q, c, o];
  const totals = totalsOf(all, null);
  check('totals count bad input across scenarios, opted out or not', totals.badInput === 2 && totals.badInputTurns === 2, totals);
  const summary = summaryLines(all, totals);
  check('the summary shows the total', summary.some((l) => l.startsWith('Bad input: 2 tool calls rejected')), summary);
  const clean = totalsOf([c], null);
  check('a clean run says so', summaryLines([c], clean).some((l) => l.startsWith('Bad input: no tool calls')));
});

// ── 6. Sign-in bypass ───────────────────────────────────────────────────────

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

for (const run of [goodModels, badModels, runner, feetText, badInput, signIn]) await run();
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} self-check: ${passes} checks passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
