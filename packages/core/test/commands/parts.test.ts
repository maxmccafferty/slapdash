import { describe, expect, it } from 'vitest';
import { expectRoundTrip, fixtureProject, runErr, runOk } from '../helpers.ts';

const stud = (extra: Record<string, unknown> = {}) => ({
  assemblyId: 'W1',
  role: 'stud',
  materialId: 'spf-no2',
  sectionId: '2x4',
  position: { x: '32in', y: 38.1, z: 0 },
  length: '92 5/8in',
  ...extra,
});

describe('add_part', () => {
  it('adds a sectioned member; width and height come from the section', () => {
    const res = expectRoundTrip(fixtureProject(), 'add_part', stud());
    expect(res.created).toEqual(['W1-S03']);
    expect(res.project.parts['W1-S03']).toEqual({
      id: 'W1-S03',
      assemblyId: 'W1',
      levelId: 'L0',
      role: 'stud',
      materialId: 'spf-no2',
      sectionId: '2x4',
      position: { x: 812.8, y: 38.1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      size: { length: expect.closeTo(2352.675, 6), width: 38.1, height: 88.9 },
      buildStep: { phase: 'framing' },
      tags: [],
    });
    expect(res.summary).toBe(`Added stud W1-S03 (SPF No.2 lumber 2x4, 2353 mm (7' 8 5/8") long).`);
  });

  it('adds a part with explicit width and height and no section', () => {
    const res = expectRoundTrip(fixtureProject(), 'add_part', {
      assemblyId: 'W1',
      role: 'sheathing',
      materialId: 'plywood-cdx',
      position: { x: 0, y: 0, z: -12.7 },
      rotation: { y: 90 },
      length: '8ft',
      width: '4ft',
      height: '1/2in',
      name: 'Sheet A',
      tags: ['exterior'],
      buildStep: { phase: 'sheathing', seq: 1 },
    });
    const part = res.project.parts['W1-SH01']!;
    expect(part.size.width).toBeCloseTo(1219.2);
    expect(part.size.height).toBeCloseTo(12.7);
    expect(part.rotation).toEqual({ x: 0, y: 90, z: 0 });
    expect(part).toMatchObject({ name: 'Sheet A', tags: ['exterior'], buildStep: { phase: 'sheathing', seq: 1 } });
    expect(part.sectionId).toBeUndefined();
  });

  it('accepts an explicit id and continues numbering after it', () => {
    const res = runOk(fixtureProject(), 'add_part', stud({ id: 'W1-S10' }));
    expect(res.created).toEqual(['W1-S10']);
    expect(runOk(res.project, 'add_part', stud()).created).toEqual(['W1-S11']);
  });

  it('accepts width/height that match the section', () => {
    expect(runOk(fixtureProject(), 'add_part', stud({ width: 38.1, height: '3 1/2in' })).created).toEqual(['W1-S03']);
  });

  describe('semantic errors', () => {
    const p = fixtureProject();
    it('unknown assembly', () => {
      expect(runErr(p, 'add_part', stud({ assemblyId: 'W2' }))[0]).toMatchObject({
        code: 'not_found',
        message: `There's no assembly "W2".`,
        hint: 'Did you mean "W1"?',
      });
    });
    it('unknown material, with a suggestion', () => {
      expect(runErr(p, 'add_part', stud({ materialId: 'spf-n02' }))[0]).toMatchObject({
        code: 'not_found',
        message: `There's no material "spf-n02".`,
        hint: 'Did you mean "spf-no2"?',
      });
    });
    it('unknown section', () => {
      expect(runErr(p, 'add_part', stud({ sectionId: '2x5' }))[0]).toMatchObject({ code: 'not_found', path: 'sectionId' });
    });
    it('section that does not come in the material', () => {
      expect(runErr(p, 'add_part', stud({ materialId: 'steel-a36' }))[0]!.message).toBe(
        'A 2x4 section comes in lumber, but A36 structural steel is steel.',
      );
    });
    it('width/height required without a section', () => {
      expect(runErr(p, 'add_part', stud({ sectionId: undefined, width: 100 }))[0]).toMatchObject({
        message: 'Give "height", or a "sectionId" such as "2x4".',
        path: 'height',
      });
    });
    it('width that contradicts the section', () => {
      expect(runErr(p, 'add_part', stud({ width: '2in' }))[0]).toMatchObject({
        message: `A 2x4 is 38 mm (0' 1 1/2") in width, but you gave 51 mm (0' 2").`,
        hint: 'Leave "width" out when using a section.',
      });
    });
    it('non-positive dimensions', () => {
      expect(runErr(p, 'add_part', stud({ length: '-2ft' }))[0]!.message).toBe(
        `"length" must be more than zero (you gave -610 mm (-2' 0")).`,
      );
      expect(runErr(p, 'add_part', stud({ length: 0 }))[0]!.message).toContain('must be more than zero');
    });
    it('too deep below ground', () => {
      expect(runErr(p, 'add_part', stud({ position: { x: 0, y: '-25ft', z: 0 } }))[0]).toMatchObject({
        path: 'position.y',
        message: expect.stringContaining('deeper than 20 ft below ground'),
      });
    });
    it('explicit id problems', () => {
      expect(runErr(p, 'add_part', stud({ id: 'W1-S01' }))[0]!.code).toBe('conflict');
      expect(runErr(p, 'add_part', stud({ id: 'stud-1' }))[0]!.code).toBe('invalid_input');
      expect(runErr(p, 'add_part', stud({ id: 'W2-S01' }))[0]!.message).toBe(
        'Part ID "W2-S01" must start with its assembly, "W1-".',
      );
    });
  });

  it('gives readable schema errors', () => {
    const p = fixtureProject();
    const errs = runErr(p, 'add_part', { assemblyId: 'W1', role: 'stud', sectionId: '2x4', position: { x: 0, y: 0 }, length: '8' });
    expect(errs.map((e) => e.message)).toEqual([
      '"materialId" is required.',
      '"position.z" is required.',
      `"length": "8" has no unit. Add a unit, e.g. 8ft, 8in or 8mm.`,
    ]);
    expect(runErr(p, 'add_part', stud({ length: true }))[0]!.message).toBe(
      '"length" should be a length: a number in millimetres or a string with a unit, e.g. 8ft 6in.',
    );
  });
});

describe('move_parts', () => {
  it('moves several parts by an offset', () => {
    const res = expectRoundTrip(fixtureProject(), 'move_parts', { ids: ['W1-S01', 'W1-S02'], by: { x: '1ft', y: 0, z: 0 } });
    expect(res.project.parts['W1-S01']!.position.x).toBeCloseTo(304.8);
    expect(res.project.parts['W1-S02']!.position.x).toBeCloseTo(406.4 + 304.8);
    expect(res.summary).toBe('Moved 2 parts.');
  });

  it('moves one part to a point and rotates it', () => {
    const res = expectRoundTrip(fixtureProject(), 'move_parts', { ids: ['W1-S01'], to: { x: 100, y: 200, z: 300 }, rotation: { y: 45 } });
    expect(res.project.parts['W1-S01']).toMatchObject({ position: { x: 100, y: 200, z: 300 }, rotation: { x: 0, y: 45, z: 0 } });
  });

  it('rotates only', () => {
    const res = expectRoundTrip(fixtureProject(), 'move_parts', { ids: ['W1-P01'], rotation: { z: 90 } });
    expect(res.summary).toBe('Rotated W1-P01.');
  });

  it('semantic errors', () => {
    const p = fixtureProject();
    expect(runErr(p, 'move_parts', { ids: ['W1-S01', 'W1-S09', 'X1-S01'], by: { x: 0, y: 0, z: 0 } })[0]!.message).toBe(
      `These parts don't exist: "W1-S09", "X1-S01".`,
    );
    expect(runErr(p, 'move_parts', { ids: ['W1-S01', 'W1-S02'], to: { x: 0, y: 0, z: 0 } })[0]).toMatchObject({
      message: '"to" moves a single part, but you listed 2.',
      hint: 'Use "by" to shift several parts together.',
    });
    expect(runErr(p, 'move_parts', { ids: ['W1-S01'], to: { x: 0, y: 0, z: 0 }, by: { x: 0, y: 0, z: 0 } })[0]!.message).toBe(
      'Give either "to" or "by", not both.',
    );
    expect(runErr(p, 'move_parts', { ids: ['W1-S01'] })[0]!.message).toContain('Nothing to change');
    expect(runErr(p, 'move_parts', { ids: ['W1-S01'], by: { x: 0, y: '-30ft', z: 0 } })[0]!.message).toContain(
      'deeper than 20 ft below ground',
    );
  });

  it('schema errors', () => {
    expect(runErr(fixtureProject(), 'move_parts', { ids: [], by: { x: 0, y: 0, z: 0 } })[0]!.message).toBe(
      '"ids" needs at least 1 item.',
    );
  });
});

describe('resize_part', () => {
  it('changes the length of a sectioned member', () => {
    const res = expectRoundTrip(fixtureProject(), 'resize_part', { id: 'W1-P01', length: '10ft' });
    expect(res.project.parts['W1-P01']!.size.length).toBeCloseTo(3048);
    expect(res.summary).toBe(`Resized W1-P01 to 3048 mm (10' 0") long.`);
  });

  it('changes width and height of a part without a section', () => {
    let p = fixtureProject();
    p = runOk(p, 'add_part', {
      assemblyId: 'W1', role: 'sheathing', materialId: 'plywood-cdx', position: { x: 0, y: 0, z: 0 },
      length: '8ft', width: '4ft', height: '1/2in',
    }).project;
    const res = expectRoundTrip(p, 'resize_part', { id: 'W1-SH01', width: '2ft', height: '3/4in' });
    expect(res.project.parts['W1-SH01']!.size.height).toBeCloseTo(19.05);
  });

  it('semantic errors', () => {
    const p = fixtureProject();
    expect(runErr(p, 'resize_part', { id: 'W1-S01', width: '2in' })[0]).toMatchObject({
      code: 'not_allowed',
      message: 'W1-S01 is a 2x4, so its width and height come from the section.',
      hint: 'Change its section with update_part instead.',
    });
    expect(runErr(p, 'resize_part', { id: 'W1-S99', length: 1 })[0]!.code).toBe('not_found');
    expect(runErr(p, 'resize_part', { id: 'W1-S01' })[0]!.message).toContain('Nothing to change');
  });

  it('schema errors', () => {
    expect(runErr(fixtureProject(), 'resize_part', { id: 'W1-S01', length: '0ft' })[0]!.message).toContain(
      '"length" must be more than zero',
    );
  });
});

describe('update_part', () => {
  it('changes the section and re-derives width and height', () => {
    const res = expectRoundTrip(fixtureProject(), 'update_part', { id: 'W1-S01', sectionId: '2x6' });
    expect(res.project.parts['W1-S01']!.size).toMatchObject({ width: 38.1, height: 139.7 });
  });

  it('keeps the id when role and assembly change', () => {
    let p = fixtureProject();
    p = runOk(p, 'add_assembly', { name: 'North wall', kind: 'wall' }).project;
    const res = expectRoundTrip(p, 'update_part', { id: 'W1-S01', role: 'post', assemblyId: 'W2', name: 'King', tags: ['k'] });
    expect(res.project.parts['W1-S01']).toMatchObject({ id: 'W1-S01', role: 'post', assemblyId: 'W2', name: 'King', tags: ['k'] });
    expect(res.project.parts['W2-S01']).toBeUndefined();
  });

  it('clears name and section with null', () => {
    let p = fixtureProject();
    p = runOk(p, 'update_part', { id: 'W1-S01', name: 'x' }).project;
    const res = expectRoundTrip(p, 'update_part', { id: 'W1-S01', name: null, sectionId: null, buildStep: { phase: 'floor' } });
    expect(res.project.parts['W1-S01']!.name).toBeUndefined();
    expect(res.project.parts['W1-S01']!.sectionId).toBeUndefined();
    expect(res.project.parts['W1-S01']!.size.width).toBe(38.1);
  });

  it('semantic errors', () => {
    const p = fixtureProject();
    expect(runErr(p, 'update_part', { id: 'W1-S09', role: 'post' })[0]!.code).toBe('not_found');
    expect(runErr(p, 'update_part', { id: 'W1-S01' })[0]!.message).toContain('Nothing to change');
    expect(runErr(p, 'update_part', { id: 'W1-S01', materialId: 'oak' })[0]!.code).toBe('not_found');
    expect(runErr(p, 'update_part', { id: 'W1-S01', assemblyId: 'R1' })[0]!.code).toBe('not_found');
    expect(runErr(p, 'update_part', { id: 'W1-S01', sectionId: 'hss-2x2' })[0]!.message).toBe(
      'A HSS 2x2x1/4 section comes in steel, but SPF No.2 lumber is lumber.',
    );
    // A steel section fits steel, but the nailed joint already on the stud can't go on steel.
    const errs = runErr(p, 'update_part', { id: 'W1-S01', materialId: 'steel-a36', sectionId: 'hss-2x2' });
    expect(errs[0]).toMatchObject({
      code: 'conflict',
      message: `A36 structural steel can't take the joint already on W1-S01: J0001 (16d nails).`,
    });
  });

  it('schema errors', () => {
    expect(runErr(fixtureProject(), 'update_part', { id: 'W1-S01', role: 'studd' })[0]).toMatchObject({
      path: 'role',
      hint: 'Did you mean "stud"?',
    });
  });
});

describe('delete_parts', () => {
  it('deletes parts and cascades their joints; undo restores both', () => {
    const res = expectRoundTrip(fixtureProject(), 'delete_parts', { ids: ['W1-S01', 'W1-S02'] });
    expect(Object.keys(res.project.parts)).toEqual(['W1-P01']);
    expect(res.project.joints).toEqual({});
    expect(res.summary).toBe('Deleted 2 parts; also removed 2 joints.');
  });

  it('deletes a single part with no joints', () => {
    let p = fixtureProject();
    p = runOk(p, 'add_part', stud()).project;
    expect(expectRoundTrip(p, 'delete_parts', { ids: ['W1-S03'] }).summary).toBe('Deleted W1-S03.');
  });

  it('semantic and schema errors', () => {
    const p = fixtureProject();
    expect(runErr(p, 'delete_parts', { ids: ['W1-S07'] })[0]).toMatchObject({ code: 'not_found', message: `There's no part "W1-S07".` });
    expect(runErr(p, 'delete_parts', { ids: 'W1-S01' })[0]!.message).toBe('"ids" should be a list, but got text ("W1-S01").');
  });
});

describe('part cuts (LOC-120)', () => {
  const theta = (Math.atan(0.5) * 180) / Math.PI;
  const rafter = (extra: Record<string, unknown> = {}) =>
    stud({
      role: 'rafter',
      sectionId: '2x6',
      length: '10ft',
      cuts: {
        start: { slope: theta, name: 'plumb' },
        end: { slope: -theta, name: 'plumb' },
        notches: [{ kind: 'birdsmouth', profile: [{ x: '2ft', z: -1 }, { x: '2ft', z: '2in' }, { x: '2ft 4in', z: -1 }] }],
      },
      ...extra,
    });

  it('add_part stores cuts (notch points in mm) and round-trips', () => {
    const res = expectRoundTrip(fixtureProject(), 'add_part', rafter());
    const part = res.project.parts[res.created[0]!]!;
    expect(part.cuts!.start).toEqual({ slope: theta, name: 'plumb' });
    expect(part.cuts!.notches![0]!.profile[1]).toEqual({ x: expect.closeTo(609.6, 6), z: expect.closeTo(50.8, 6) });
    expect(res.summary).toContain('long to the long point, plumb 26.6° both ends · birdsmouth');
  });

  it('refuses invalid cuts with invalid_input on cuts', () => {
    // 2 1/2in long: the two 26.6° plumb cuts through 5 1/2in take 2 3/4in.
    const [err] = runErr(fixtureProject(), 'add_part', rafter({ length: '2.5in', cuts: { start: { slope: theta }, end: { slope: -theta } } }));
    expect(err!.code).toBe('invalid_input');
    expect(err!.path).toBe('cuts');
    expect(err!.message).toContain('short point');
    const [bad] = runErr(fixtureProject(), 'add_part', rafter({ cuts: { notches: [{ kind: 'notch', profile: [{ x: '20ft', z: 0 }, { x: '21ft', z: 0 }, { x: '20ft', z: 10 }] }] } }));
    expect(bad!.message).toContain('outside the part');
  });

  it('update_part replaces cuts, and cuts: null clears them', () => {
    const p = runOk(fixtureProject(), 'add_part', rafter());
    const id = p.created[0]!;
    const set = expectRoundTrip(p.project, 'update_part', { id, cuts: { end: { slope: -45, name: 'plumb' } } });
    expect(set.project.parts[id]!.cuts).toEqual({ end: { slope: -45, name: 'plumb' } });
    const cleared = expectRoundTrip(set.project, 'update_part', { id, cuts: null });
    expect(cleared.project.parts[id]!.cuts).toBeUndefined();
  });

  it('update_part refuses a section change the notches no longer fit', () => {
    const p = runOk(fixtureProject(), 'add_part', rafter({ cuts: { notches: [{ kind: 'notch', profile: [{ x: '2ft', z: '4.5in' }, { x: '2ft 4in', z: '4.5in' }, { x: '2ft 2in', z: '6in' }] }] } }));
    const [err] = runErr(p.project, 'update_part', { id: p.created[0]!, sectionId: '2x4' });
    expect(err!.message).toContain("cuts don't fit the new section");
    expect(err!.hint).toContain('"cuts": null');
  });

  it('resize_part keeps the cuts, and refuses when a notch would fall off', () => {
    const p = runOk(fixtureProject(), 'add_part', rafter());
    const id = p.created[0]!;
    const longer = expectRoundTrip(p.project, 'resize_part', { id, length: '12ft' });
    expect(longer.project.parts[id]!.cuts).toEqual(p.project.parts[id]!.cuts);
    const [err] = runErr(p.project, 'resize_part', { id, length: '18in' });
    expect(err!.message).toContain("cuts don't fit the new size");
    expect(err!.hint).toContain('update_part');
  });
});
