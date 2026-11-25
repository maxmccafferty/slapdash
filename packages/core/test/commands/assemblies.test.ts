import { describe, expect, it } from 'vitest';
import { createProject } from '../../src/index.ts';
import { expectRoundTrip, fixtureProject, run, runErr, runOk } from '../helpers.ts';

describe('add_assembly', () => {
  it('creates an assembly with a readable id on the ground level', () => {
    const before = createProject({ name: 't' });
    const res = expectRoundTrip(before, 'add_assembly', { name: 'South wall', kind: 'wall' });
    expect(res.created).toEqual(['W1']);
    expect(res.project.assemblies.W1).toEqual({ id: 'W1', name: 'South wall', kind: 'wall', levelId: 'L0' });
    expect(res.summary).toBe('Added wall W1 "South wall".');
    const second = runOk(res.project, 'add_assembly', { name: 'Roof', kind: 'roof', buildStep: { phase: 'roofing' } });
    expect(second.created).toEqual(['R1']);
    expect(second.project.assemblies.R1!.buildStep).toEqual({ phase: 'roofing' });
  });

  it('accepts an explicit id and reserves it', () => {
    const res = runOk(createProject({ name: 't' }), 'add_assembly', { name: 'x', kind: 'wall', id: 'W5' });
    expect(res.created).toEqual(['W5']);
    expect(runOk(res.project, 'add_assembly', { name: 'y', kind: 'wall' }).created).toEqual(['W6']);
  });

  it('never reuses an id after the assembly is undone', () => {
    const before = createProject({ name: 't' });
    const res = runOk(before, 'add_assembly', { name: 'x', kind: 'wall' });
    const removed = runOk(res.project, 'remove_entities', { assemblies: ['W1'] }).project;
    expect(runOk(removed, 'add_assembly', { name: 'y', kind: 'wall' }).created).toEqual(['W2']);
  });

  it('rejects an unknown level, bad or taken ids', () => {
    const p = fixtureProject();
    const [lvl] = runErr(p, 'add_assembly', { name: 'x', kind: 'wall', levelId: 'L1' });
    expect(lvl).toMatchObject({ code: 'not_found', message: `There's no level "L1".`, hint: 'Did you mean "L0"?' });
    expect(runErr(p, 'add_assembly', { name: 'x', kind: 'wall', id: 'wall-1' })[0]).toMatchObject({
      code: 'invalid_input',
      message: expect.stringContaining(`"wall-1" isn't a valid ID`),
    });
    expect(runErr(p, 'add_assembly', { name: 'x', kind: 'wall', id: 'W1' })[0]).toMatchObject({
      code: 'conflict',
      message: 'The ID "W1" is already in use.',
    });
  });

  it('gives readable schema errors', () => {
    const p = createProject({ name: 't' });
    const errs = runErr(p, 'add_assembly', { kind: 'wal', name: '   ' });
    expect(errs.map((e) => e.message)).toEqual([
      `"name" can't be blank.`,
      expect.stringContaining('"kind" must be one of "foundation", "floor", "wall"'),
    ]);
    expect(errs[1]!.hint).toBe('Did you mean "wall"?');
    expect(runErr(p, 'add_assembly', { kind: 'wall' })[0]!.message).toBe('"name" is required.');
    expect(runErr(p, 'add_assembly', { name: 'x', kind: 'wall', colour: 'red' })[0]!.message).toBe('Unknown field "colour".');
  });
});

describe('update_assembly', () => {
  it('renames and sets the build step, reversibly', () => {
    const res = expectRoundTrip(fixtureProject(), 'update_assembly', { id: 'W1', name: 'North wall', buildStep: { phase: 'framing', seq: 2 } });
    expect(res.project.assemblies.W1).toMatchObject({ name: 'North wall', buildStep: { phase: 'framing', seq: 2 } });
  });

  it('rejects unknown ids and empty updates', () => {
    const p = fixtureProject();
    expect(runErr(p, 'update_assembly', { id: 'W9', name: 'x' })[0]).toMatchObject({ code: 'not_found', hint: 'Did you mean "W1"?' });
    expect(runErr(p, 'update_assembly', { id: 'W1' })[0]!.message).toContain('Nothing to change');
    expect(runErr(p, 'update_assembly', { id: 7 })[0]!.message).toBe('"id" should be text, but got a number (7).');
  });
});

describe('delete_assembly', () => {
  it('deletes an empty assembly', () => {
    const p = runOk(createProject({ name: 't' }), 'add_assembly', { name: 'x', kind: 'misc' }).project;
    const res = expectRoundTrip(p, 'delete_assembly', { id: 'M1' });
    expect(res.project.assemblies).toEqual({});
  });

  it('refuses to orphan parts unless withParts is given', () => {
    const p = fixtureProject();
    const [err] = runErr(p, 'delete_assembly', { id: 'W1' });
    expect(err).toMatchObject({ code: 'not_allowed', message: 'W1 still has 3 parts.', hint: 'Pass withParts: true to delete them too.' });
  });

  it('with parts, cascades to parts and joints and restores them all on undo', () => {
    const p = fixtureProject();
    const res = expectRoundTrip(p, 'delete_assembly', { id: 'W1', withParts: true });
    expect(res.project.parts).toEqual({});
    expect(res.project.joints).toEqual({});
    expect(res.summary).toBe('Deleted W1 with 3 parts and 2 joints.');
  });

  it('rejects unknown ids', () => {
    expect(run(fixtureProject(), { name: 'delete_assembly', input: { id: 'R1' } })).toMatchObject({ ok: false });
  });
});
