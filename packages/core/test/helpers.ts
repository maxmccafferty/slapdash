import { expect } from 'vitest';
import { CommandBus, SAMPLE_CATALOG, checkJoint, commandRegistry, createProject, findAllClashes, indexCatalog, type Project } from '../src/index.ts';
import type { AppliedCommand, ApplyResult, CommandContext } from '../src/commands/types.ts';
import type { CommandError } from '../src/commands/errors.ts';
import { zodIssuesToErrors } from '../src/commands/errors.ts';

export const catalog = indexCatalog(SAMPLE_CATALOG);

/** A fixed clock that ticks 1 ms per call. */
export function fixedClock(start = 1_700_000_000_000) {
  let t = start;
  return () => t++;
}

export const ctx: CommandContext = { catalog, now: fixedClock() };

export function makeBus(project: Project = createProject({ name: 'Test' }), opts: { historyLimit?: number } = {}) {
  return new CommandBus({ project, catalog: SAMPLE_CATALOG, now: fixedClock(), ...opts });
}

export type RunResult = ({ ok: true } & ApplyResult) | { ok: false; errors: CommandError[] };

/** Run any command (exposed or internal) directly against a project, bypassing the bus. */
export function run(project: Project, cmd: AppliedCommand, extra: Partial<CommandContext> = {}): RunResult {
  const def = commandRegistry.get(cmd.name);
  if (!def) throw new Error(`no command ${cmd.name}`);
  const parsed = def.schema.safeParse(cmd.input);
  if (!parsed.success) return { ok: false, errors: zodIssuesToErrors(parsed.error.issues, cmd.input) };
  const c = { ...ctx, ...extra };
  const errors = def.check(project, parsed.data, c);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, ...def.apply(project, parsed.data, c) };
}

export function runOk(project: Project, name: string, input: unknown, extra: Partial<CommandContext> = {}): ApplyResult {
  const res = run(project, { name, input }, extra);
  if (!res.ok) throw new Error(`${name} failed: ${res.errors.map((e) => e.message).join(' | ')}`);
  return res;
}

export function runErr(project: Project, name: string, input: unknown): CommandError[] {
  const res = run(project, { name, input });
  if (res.ok) throw new Error(`${name} unexpectedly succeeded`);
  return res.errors;
}

/** Apply a list of inverse commands (in reverse order, as the bus does). */
export function applyInverse(project: Project, inverse: readonly AppliedCommand[], extra: Partial<CommandContext> = {}): Project {
  let p = project;
  for (const cmd of [...inverse].reverse()) p = runOk(p, cmd.name, cmd.input, extra).project;
  return p;
}

/**
 * The project minus its ID counters. Inverses deliberately don't roll counters back
 * (so an ID is never reused), so "exact pre-state" comparisons ignore them.
 */
export function model(project: Project): Omit<Project, 'counters'> {
  const { counters: _counters, ...rest } = project;
  return rest;
}

/**
 * Check the inverse/redo contract for one command: inverse restores the pre-state
 * exactly (apart from counters), and redo on the pre-state reproduces the post-state exactly.
 */
export function expectRoundTrip(before: Project, name: string, input: unknown, extra: Partial<CommandContext> = {}): ApplyResult {
  const res = runOk(before, name, input, extra);
  expect(model(applyInverse(res.project, res.inverse, extra))).toEqual(model(before));
  const undone = applyInverse(res.project, res.inverse, extra);
  const redone = runOk(undone, res.redo.name, res.redo.input, extra);
  expect(redone.project).toEqual(res.project);
  return res;
}

/** A small framed wall: W1 with two studs and a plate, a joint between S01 and P01, and S01 on the ground. */
export function fixtureProject(): Project {
  let p = createProject({ name: 'Fixture' });
  p = runOk(p, 'add_assembly', { name: 'South wall', kind: 'wall' }).project;
  p = runOk(p, 'add_part', {
    assemblyId: 'W1',
    role: 'stud',
    materialId: 'spf-no2',
    sectionId: '2x4',
    position: { x: 0, y: 38.1, z: 0 },
    length: '92 5/8in',
  }).project;
  p = runOk(p, 'add_part', {
    assemblyId: 'W1',
    role: 'stud',
    materialId: 'spf-no2',
    sectionId: '2x4',
    position: { x: '16in', y: 38.1, z: 0 },
    length: '92 5/8in',
  }).project;
  p = runOk(p, 'add_part', {
    assemblyId: 'W1',
    role: 'plate',
    materialId: 'spf-no2',
    sectionId: '2x4',
    position: { x: 0, y: 0, z: 0 },
    length: '8ft',
  }).project;
  p = runOk(p, 'connect', { jointTypeId: 'nailed-16d', partIds: ['W1-S01', 'W1-P01'], at: { x: 0, y: 38.1, z: 0 } }).project;
  p = runOk(p, 'connect', { jointTypeId: 'post-base', partIds: ['W1-S02', 'GROUND'], at: { x: '16in', y: 0, z: 0 } }).project;
  return p;
}

/**
 * No part runs through another (site context excepted, and posts set into their own
 * concrete pier on purpose), and every joint passes the bus's joint checks.
 */
export function expectSound(p: Project, cat = catalog) {
  const joints = Object.values(p.joints);
  const embedded = new Set(joints.filter((j) => j.jointTypeId === 'post-embedded').map((j) => [...j.partIds].sort().join('|')));
  const skip = (a: { id: string; tags: string[] }, b: { id: string; tags: string[] }) =>
    a.tags.includes('site-context') || b.tags.includes('site-context') || embedded.has([a.id, b.id].sort().join('|'));
  expect(findAllClashes(p, { skip })).toEqual([]);
  for (const j of joints) {
    const { [j.id]: _self, ...others } = p.joints;
    expect(checkJoint({ ...p, joints: others }, j, cat), j.id).toEqual([]);
  }
}
