import { describe, expect, it } from 'vitest';
import { expectRoundTrip, fixtureProject, runErr, runOk } from '../helpers.ts';

describe('connect', () => {
  it('joins two parts with the joint type\'s default fastener count', () => {
    const res = expectRoundTrip(fixtureProject(), 'connect', {
      jointTypeId: 'nailed-16d',
      partIds: ['W1-S02', 'W1-P01'],
      at: { x: '16in', y: 38.1, z: 0 },
    });
    expect(res.created).toEqual(['J0003']);
    expect(res.project.joints.J0003).toEqual({
      id: 'J0003',
      jointTypeId: 'nailed-16d',
      partIds: ['W1-S02', 'W1-P01'],
      at: { x: 406.4, y: 38.1, z: 0 },
      fastenerCount: 2,
    });
    expect(res.summary).toBe('Joined W1-S02 to W1-P01 with 16d nails (J0003).');
  });

  it('connects to GROUND with an override, note and explicit id', () => {
    const res = expectRoundTrip(fixtureProject(), 'connect', {
      jointTypeId: 'post-embedded',
      partIds: ['W1-S01', 'GROUND'],
      at: { x: 0, y: 0, z: 0 },
      fastenerCount: 1,
      capacityOverride: { shear_N: 5000 },
      note: 'per spec sheet',
      id: 'J0100',
    });
    expect(res.project.joints.J0100).toMatchObject({ capacityOverride: { shear_N: 5000 }, note: 'per spec sheet' });
    expect(runOk(res.project, 'connect', { jointTypeId: 'nailed-16d', partIds: ['W1-S02', 'W1-P01'], at: { x: 0, y: 0, z: 0 } }).created).toEqual(['J0101']);
  });

  describe('semantic errors', () => {
    const p = fixtureProject();
    const at = { x: 0, y: 0, z: 0 };
    it('unknown joint type, with a suggestion', () => {
      expect(runErr(p, 'connect', { jointTypeId: 'nailed-16', partIds: ['W1-S02', 'W1-P01'], at })[0]).toMatchObject({
        code: 'not_found',
        hint: 'Did you mean "nailed-16d"?',
      });
    });
    it('unknown parts', () => {
      expect(runErr(p, 'connect', { jointTypeId: 'nailed-16d', partIds: ['W1-S09', 'W1-P01'], at })[0]).toMatchObject({
        code: 'not_found',
        path: 'partIds[0]',
      });
      expect(runErr(p, 'connect', { jointTypeId: 'nailed-16d', partIds: ['A', 'B'], at })[0]!.message).toBe(
        `These parts don't exist: "A", "B".`,
      );
    });
    it('the same part twice, or GROUND first', () => {
      expect(runErr(p, 'connect', { jointTypeId: 'nailed-16d', partIds: ['W1-S01', 'W1-S01'], at })[0]!.message).toBe(
        'A joint needs two different parts; both are "W1-S01".',
      );
      expect(runErr(p, 'connect', { jointTypeId: 'post-base', partIds: ['GROUND', 'W1-S01'], at })[0]!.message).toContain(
        '"GROUND" can only be the second part',
      );
    });
    it('a material that can\'t take the joint type', () => {
      expect(runErr(p, 'connect', { jointTypeId: 'welded-fillet', partIds: ['W1-S02', 'W1-P01'], at })[0]).toMatchObject({
        code: 'not_allowed',
        message: `SPF No.2 lumber (W1-S02) can't take a fillet weld joint.`,
        hint: expect.stringMatching(/^It accepts: 16d nails, Joist hanger, Post base, Post embedded in concrete, 8d nails, Hurricane tie, Anchor bolts, /),
      });
    });
    it('a duplicate joint of the same type between the same pair', () => {
      expect(runErr(p, 'connect', { jointTypeId: 'nailed-16d', partIds: ['W1-P01', 'W1-S01'], at })[0]).toMatchObject({
        code: 'conflict',
        message: 'W1-P01 and W1-S01 are already joined by J0001 (16d nails).',
      });
    });
    it('a taken id', () => {
      expect(runErr(p, 'connect', { jointTypeId: 'nailed-16d', partIds: ['W1-S02', 'W1-P01'], at, id: 'J0001' })[0]!.code).toBe('conflict');
    });
  });

  it('schema errors', () => {
    const p = fixtureProject();
    const errs = runErr(p, 'connect', { jointTypeId: 'nailed-16d', partIds: ['W1-S02'], at: { x: 0, y: 0, z: 0 }, fastenerCount: 0 });
    expect(errs.map((e) => e.message)).toEqual(['"partIds" needs at least 2 items.', '"fastenerCount" must be at least 1 (you gave 0).']);
    expect(runErr(p, 'connect', { jointTypeId: 'nailed-16d', partIds: ['W1-S02', 'W1-P01'], at: { x: 0, y: 0, z: 0 }, fastenerCount: 2.5 })[0]!.message).toBe(
      '"fastenerCount" should be a whole number, but got a number (2.5).',
    );
  });
});

describe('update_joint', () => {
  it('changes fastener count, location, override and note', () => {
    const res = expectRoundTrip(fixtureProject(), 'update_joint', {
      id: 'J0001',
      fastenerCount: 3,
      at: { x: 1, y: 2, z: 3 },
      capacityOverride: { withdrawal_N: 10 },
      note: 'toenailed',
    });
    expect(res.project.joints.J0001).toMatchObject({ fastenerCount: 3, at: { x: 1, y: 2, z: 3 }, capacityOverride: { withdrawal_N: 10 }, note: 'toenailed' });
    expect(res.summary).toBe('Updated J0001 (16d nails, 3 fasteners).');
  });

  it('changes type and clears override and note', () => {
    let p = fixtureProject();
    p = runOk(p, 'update_joint', { id: 'J0002', capacityOverride: { shear_N: 1 }, note: 'x' }).project;
    const res = expectRoundTrip(p, 'update_joint', { id: 'J0002', jointTypeId: 'post-embedded', capacityOverride: null, note: null });
    expect(res.project.joints.J0002).toEqual({
      id: 'J0002',
      jointTypeId: 'post-embedded',
      partIds: ['W1-S02', 'GROUND'],
      at: { x: 406.4, y: 0, z: 0 },
      fastenerCount: 1,
    });
  });

  it('semantic errors', () => {
    let p = fixtureProject();
    expect(runErr(p, 'update_joint', { id: 'J0009', fastenerCount: 2 })[0]!.code).toBe('not_found');
    expect(runErr(p, 'update_joint', { id: 'J0001' })[0]!.message).toContain('Nothing to change');
    expect(runErr(p, 'update_joint', { id: 'J0001', jointTypeId: 'welded-fillet' })[0]!.code).toBe('not_allowed');
    expect(runErr(p, 'update_joint', { id: 'J0001', jointTypeId: 'nope' })[0]!.code).toBe('not_found');
    p = runOk(p, 'connect', { jointTypeId: 'joist-hanger', partIds: ['W1-S01', 'W1-P01'], at: { x: 0, y: 0, z: 0 } }).project;
    expect(runErr(p, 'update_joint', { id: 'J0003', jointTypeId: 'nailed-16d' })[0]!.code).toBe('conflict');
    // Changing a joint to its own type is not a duplicate of itself.
    expect(runOk(p, 'update_joint', { id: 'J0001', jointTypeId: 'nailed-16d' }).project.joints.J0001!.jointTypeId).toBe('nailed-16d');
  });

  it('schema errors', () => {
    expect(runErr(fixtureProject(), 'update_joint', { id: 'J0001', capacityOverride: { shear_N: -5 } })[0]!.message).toBe(
      '"capacityOverride.shear_N" must be at least 0 (you gave -5).',
    );
  });
});

describe('disconnect', () => {
  it('removes joints and leaves the parts', () => {
    const before = fixtureProject();
    const res = expectRoundTrip(before, 'disconnect', { ids: ['J0001', 'J0002'] });
    expect(res.project.joints).toEqual({});
    expect(res.project.parts).toBe(before.parts);
    expect(res.summary).toBe('Removed 2 joints.');
    expect(expectRoundTrip(before, 'disconnect', { ids: ['J0001'] }).summary).toBe('Removed joint J0001.');
  });

  it('semantic and schema errors', () => {
    const p = fixtureProject();
    expect(runErr(p, 'disconnect', { ids: ['J0001', 'J0007', 'J0008'] })[0]!.message).toBe(`These joints don't exist: "J0007", "J0008".`);
    expect(runErr(p, 'disconnect', {})[0]!.message).toBe('"ids" is required.');
  });
});
