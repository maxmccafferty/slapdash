import { describe, expect, it } from 'vitest';
import { runErr, expectRoundTrip, expectSound, makeBus, run, runOk } from '../../helpers.ts';
import { placeMember } from '../../../src/geometry/frame.ts';
import { wallFrame, wallParamsOf } from '../../../src/builders/layout/wall-state.ts';
import { UNIT_CATALOG, bounds, piece, unitCtx, unitParts, wallBox } from './unit-fixtures.ts';
import { IN, counts, expectInPlace, geometry, inWall, poolWalls, tagged, withOpenings } from './opening-fixtures.ts';
import type { Project } from '../../../src/index.ts';

const door = { wallId: 'W3', kind: 'door', centerAt: '10ft' } as const;
const window = { wallId: 'W1', kind: 'window', at: '5ft' } as const;
const params = (p: Project, id = 'O1') => p.assemblies[id]!.builder!.params as Record<string, number | string | null | object>;
/** Recipe numbers to 0.01 mm, so float noise from inches doesn't fail toMatchObject. */
const close = (p: Project, id = 'O1') =>
  Object.fromEntries(Object.entries(params(p, id)).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v]));
const mm = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 100) / 100]));
const jointCount = (p: Project) => Object.keys(p.joints).length;
const plateIds = (p: Project, wall: string) => new Set(tagged(p, wall, 'plate', 'bottom').map((x) => x.id));

/** The same opening added fresh to the bare walls. */
const fresh = (o: Record<string, unknown>) => withOpenings(o);

describe('update_opening', () => {
  it('widens a door about its centre, re-framing only that opening', () => {
    const before = withOpenings(door);
    const res = expectRoundTrip(before, 'update_opening', { openingId: 'O1', width: '4ft' });
    const p = res.project;
    expectInPlace(before, p, 'O1', 'W3');
    expect(close(p)).toMatchObject(mm({ width: 48 * IN, at: 96 * IN, framingU0: 93 * IN, framingU1: 147 * IN }));
    // Same model as adding a 4ft door centred at 10ft to the bare walls.
    const same = fresh({ ...door, width: '4ft' });
    expect(geometry(p)).toEqual(geometry(same));
    expect(counts(p, 'W3')).toEqual(counts(same, 'W3'));
    expect(jointCount(p)).toBe(jointCount(same));
    expect(params(p)).toEqual(params(same));
    expect(counts(p, 'W3').common).toBe(counts(before, 'W3').common - 2);
    // Two bottom-plate pieces with the new gap, each anchor-bolted.
    const plates = tagged(p, 'W3', 'plate', 'bottom');
    expect(plates).toHaveLength(2);
    for (const plate of plates) {
      expect(Object.values(p.joints).filter((j) => j.jointTypeId === 'anchor-bolt' && j.partIds.includes(plate.id))).toHaveLength(1);
    }
    expect(res.summary).toContain('Re-framed O1 in W3: now a 4\' 0" × 6\' 10 1/2" door');
    expect(res.summary).toContain('was 3\' 2" wide');
  });

  it('narrows a door to 3ft (commons come back only where the old framing blocked them)', () => {
    const before = withOpenings(door);
    const p = expectRoundTrip(before, 'update_opening', { openingId: 'O1', width: '3ft' }).project;
    expectInPlace(before, p, 'O1', 'W3');
    const same = fresh({ ...door, width: '3ft' });
    expect(geometry(p)).toEqual(geometry(same));
    expect(jointCount(p)).toBe(jointCount(same));
    expect(params(p)).toEqual(params(same));
    expect(close(p)).toMatchObject(mm({ width: 36 * IN, at: 102 * IN }));
  });

  it('moves a window along the wall: commons back in the old span, out of the new, sheathing re-cut', () => {
    const before = withOpenings(window);
    const res = expectRoundTrip(before, 'update_opening', { openingId: 'O1', at: '9ft' });
    const p = res.project;
    expectInPlace(before, p, 'O1', 'W1');
    const same = fresh({ ...window, at: '9ft' });
    expect(geometry(p)).toEqual(geometry(same));
    expect(jointCount(p)).toBe(jointCount(same));
    expect(params(p)).toEqual(params(same));
    expect(close(p)).toMatchObject(mm({ at: 108 * IN, roBottom: params(before).roBottom as number }));
    expect(res.summary).toMatch(/put back 3 common studs, removed 3\./);
  });

  it('a new window height keeps the sill; sillHeight moves it', () => {
    const before = withOpenings(window);
    const taller = runOk(before, 'update_opening', { openingId: 'O1', height: '5ft' }).project;
    const sill0 = params(before).roBottom as number;
    expect(close(taller)).toMatchObject(mm({ height: 60 * IN, roBottom: sill0, sillHeight: sill0 }));
    expect(geometry(taller)).toEqual(geometry(fresh({ ...window, height: '5ft', sillHeight: sill0 })));

    const res = expectRoundTrip(before, 'update_opening', { openingId: 'O1', height: '3ft', sillHeight: '42in' });
    const p = res.project;
    expectInPlace(before, p, 'O1', 'W1');
    expect(close(p)).toMatchObject(mm({ roBottom: 42 * IN, roTop: 78 * IN, sillHeight: 42 * IN }));
    const sill = inWall(p, 'W1').find((x) => x.role === 'sill')!;
    expect(sill.position.y).toBeCloseTo(4 * IN + 42 * IN - 1.5 * IN);
    expect(geometry(p)).toEqual(geometry(fresh({ ...window, height: '3ft', sillHeight: '42in' })));
    expect(res.summary).toContain('sill at');
  });

  it('a wider opening gets a deeper header, and the summary says so', () => {
    const before = withOpenings(door);
    const res = expectRoundTrip(before, 'update_opening', { openingId: 'O1', width: '6ft' });
    const header = (p: Project) => inWall(p, 'W3').find((x) => x.role === 'header' && x.tags.includes('opening:O1'))!;
    expect(header(before).sectionId).toBe('2x6');
    expect(header(res.project).sectionId).toBe('2x10');
    expect(res.summary).toContain('header 2-2x6 → 2-2x10');
    expectInPlace(before, res.project, 'O1', 'W3');
  });

  it('keeps the opening ID, its name and seq, and works on build_wall inline openings', () => {
    let p = runOk(poolWalls(), 'build_wall', { start: { x: '30ft', z: 0 }, end: { x: '50ft', z: 0 }, height: '9ft', openings: [{ kind: 'window', at: '5ft' }] }).project;
    p = runOk(p, 'add_opening', door).project;
    const [wallId, openingId] = ['W5', 'O1'];
    expect(params(p, 'O1').wallId).toBe('W5');
    const after = expectRoundTrip(p, 'update_opening', { openingId, width: '30in' }).project;
    expect(after.assemblies[openingId]).toMatchObject({ id: openingId, name: p.assemblies[openingId]!.name, buildStep: p.assemblies[openingId]!.buildStep });
    expectInPlace(p, after, openingId, wallId);
  });

  it('leaves another opening in the same wall alone', () => {
    const before = withOpenings(window, { wallId: 'W1', kind: 'window', at: '14ft' });
    const p = expectRoundTrip(before, 'update_opening', { openingId: 'O1', width: '4ft' }).project;
    expectInPlace(before, p, 'O1', 'W1');
    for (const x of Object.values(before.parts).filter((x) => x.tags.includes('opening:O2'))) expect(p.parts[x.id]).toEqual(x);
    const same = withOpenings({ ...window, at: '54in', width: '4ft' }, { wallId: 'W1', kind: 'window', at: '14ft' });
    expect(geometry(p)).toEqual(geometry(same));
    expect(jointCount(p)).toBe(jointCount(same));
  });

  it('a door narrowed then widened back gives the original framing', () => {
    const before = withOpenings(door);
    const narrow = runOk(before, 'update_opening', { openingId: 'O1', width: '3ft' }).project;
    const back = runOk(narrow, 'update_opening', { openingId: 'O1', width: '38in' }).project;
    expect(geometry(back)).toEqual(geometry(before));
    expect(params(back)).toEqual(params(before));
    expect(plateIds(back, 'W3').size).toBe(2);
  });

  it('a part that comes out of the re-framing unchanged keeps its ID and joints', () => {
    // A door only made shorter: the kings, the bottom plate pieces and the sheathing beside it
    // are laid out again exactly where they were, so they aren't swapped for new IDs.
    const before = withOpenings(door);
    const res = expectRoundTrip(before, 'update_opening', { openingId: 'O1', height: '6ft 6in' });
    const p = res.project;
    const kings = (q: Project) => tagged(q, 'W3', 'stud', 'king').map((x) => x.id).sort();
    expect(kings(p)).toEqual(kings(before));
    expect(plateIds(p, 'W3')).toEqual(plateIds(before, 'W3'));
    for (const id of kings(before)) expect(p.parts[id]).toBe(before.parts[id]);
    const jointsOf = (q: Project, id: string) => Object.values(q.joints).filter((j) => j.partIds.includes(id)).length;
    for (const id of kings(before)) expect(jointsOf(p, id)).toBe(jointsOf(before, id));
    // Whatever did change is still the same model as framing the shorter door fresh.
    const same = fresh({ ...door, height: '6ft 6in' });
    expect(geometry(p)).toEqual(geometry(same));
    expect(jointCount(p)).toBe(jointCount(same));
    expect(Object.keys(p.parts).filter((id) => !before.parts[id]).length).toBeLessThan(Object.keys(before.parts).filter((id) => before.parts[id]!.assemblyId === 'W3').length / 3);
  });

  it('a part that differs only in its cuts is not taken for unchanged', () => {
    // A king given an angled end by hand: re-framing lays out a plain king in the same box,
    // which is a different part, so the cut king is replaced rather than kept.
    const before0 = withOpenings(door);
    const [cutKing, plainKing] = tagged(before0, 'W3', 'stud', 'king').map((x) => x.id).sort();
    const before = runOk(before0, 'update_part', { id: cutKing, cuts: { end: { slope: 30 } } }).project;
    const p = expectRoundTrip(before, 'update_opening', { openingId: 'O1', height: '6ft 6in' }).project;
    expect(p.parts[cutKing!]).toBeUndefined();
    expect(p.parts[plainKing!]).toBe(before.parts[plainKing!]);
    expect(tagged(p, 'W3', 'stud', 'king').every((x) => x.cuts === undefined)).toBe(true);
  });

  describe('refuses, changing nothing', () => {
    const before = withOpenings(door, { wallId: 'W3', kind: 'window', at: '2ft' });
    const cases: [string, Record<string, unknown>, RegExp, string?][] = [
      ['past the wall end', { at: '17ft' }, /more room at the/, 'at'],
      ['onto another opening', { at: '3ft' }, /would overlap O2's framing/, 'at'],
      ['too tall', { height: '8ft 6in' }, /fits a door at most/, 'height'],
      ['past the header table', { width: '17ft', centerAt: '10ft' }, /longer than any built-up 2x header/, 'width'],
      ['sillHeight on a door', { sillHeight: '3ft' }, /only applies to windows/, 'sillHeight'],
      ['both at and centerAt', { at: '8ft', centerAt: '10ft' }, /exactly one of "at"/, 'at'],
      ['no fields', {}, /Give at least one of width/, 'openingId'],
    ];
    for (const [what, input, message, path] of cases) {
      it(what, () => {
        const errs = runErr(before, 'update_opening', { openingId: 'O1', ...input });
        expect(errs[0]!.message).toMatch(message);
        if (path) expect(errs[0]!.path).toBe(path);
        const bus = makeBus(before);
        const res = bus.execute('update_opening', { openingId: 'O1', ...input });
        expect(res.ok).toBe(false);
        expect(bus.project).toBe(before);
        expect(bus.canUndo).toBe(false);
      });
    }

    it('an unknown opening', () => {
      const [err] = runErr(before, 'update_opening', { openingId: 'O9', width: '3ft' });
      expect(err).toMatchObject({ code: 'not_found', path: 'openingId' });
    });

    it('a hand-made opening', () => {
      const p = runOk(before, 'add_assembly', { name: 'Hand door', kind: 'opening' }).project;
      const id = Object.keys(p.assemblies).find((a) => !Object.hasOwn(before.assemblies, a))!;
      const [err] = runErr(p, 'update_opening', { openingId: id, width: '3ft' });
      expect(err).toMatchObject({ code: 'not_allowed', path: 'openingId' });
      expect(err!.message).toContain("wasn't made with add_opening, so update_opening can't re-frame it");
    });

    it('a window in a wall whose sheathing was taken off keeps it off', () => {
      let p = withOpenings(window);
      p = runOk(p, 'delete_parts', { ids: inWall(p, 'W1').filter((x) => x.role === 'sheathing').map((x) => x.id) }).project;
      const res = run(p, { name: 'update_opening', input: { openingId: 'O1', at: '9ft' } });
      expect(res.ok).toBe(true);
      if (res.ok) expect(inWall(res.project, 'W1').filter((x) => x.role === 'sheathing')).toHaveLength(0);
    });
  });
});

describe('update_opening re-sizes the window or door unit', () => {
  const add = (o: Record<string, unknown>) => runOk(poolWalls(), 'add_opening', o, unitCtx).project;
  const frameBounds = (p: Project) => bounds(p, unitParts(p).filter((x) => x.role === 'frame' && !x.tags.includes('unit:flange')));

  it('a new width re-sizes the whole unit', () => {
    const before = add(window);
    const p = expectRoundTrip(before, 'update_opening', { openingId: 'O1', width: '4ft' }, unitCtx).project;
    const b = frameBounds(p);
    expect(b.u1 - b.u0).toBeCloseTo(47 * IN, 6);
    expect(Object.values(p.parts).some((x) => x.role === 'panel')).toBe(false);
    expect(unitParts(p).length).toBe(unitParts(before).length);
    expectSound(p, UNIT_CATALOG);
  });

  it('a new window height keeps the parts whose geometry did not change: the sill, the bottom fin and the bottom rail', () => {
    const before = add(window);
    const p = runOk(before, 'update_opening', { openingId: 'O1', height: '5ft' }, unitCtx).project;
    const kept = (name: string) => piece(unitParts(before), name).filter((x) => p.parts[x.id] !== undefined).map((x) => x.id);
    expect(kept('sill')).toEqual(piece(unitParts(before), 'sill').map((x) => x.id));
    expect(kept('rail').length).toBeGreaterThanOrEqual(1);
    const bottomFin = piece(unitParts(before), 'flange').find((x) => wallBox(before, x).v1 <= wallBox(before, piece(unitParts(before), 'sill')[0]!).v0 + 1e-6)!;
    expect(p.parts[bottomFin.id]).toEqual(bottomFin);
    expect(piece(unitParts(p), 'head')[0]!.id).not.toBe(piece(unitParts(before), 'head')[0]!.id);
    expectSound(p, UNIT_CATALOG);
  });

  it('moving the opening gives every unit part a new ID', () => {
    const before = add(window);
    const p = runOk(before, 'update_opening', { openingId: 'O1', centerAt: '12ft' }, unitCtx).project;
    for (const x of unitParts(before)) expect(p.parts[x.id], x.id).toBeUndefined();
    expect(unitParts(p).length).toBe(unitParts(before).length);
  });

  it('upgrades a pre-unit single panel to a unit, and leaves other parts in O1 alone', () => {
    const built = add(window);
    // Make it look like a project saved before units: one panel filling the rough opening.
    const legacy = structuredClone(built);
    const unit = unitParts(built);
    const ids = new Set(unit.map((x) => x.id));
    for (const id of ids) delete legacy.parts[id];
    for (const [jid, j] of Object.entries(legacy.joints)) if (j.partIds.some((id) => ids.has(id))) delete legacy.joints[jid];
    const op = params(built) as unknown as { wallId: string; at: number; width: number; roBottom: number; roTop: number };
    const wall = wallParamsOf(built, op.wallId)!;
    const placed = placeMember(wallFrame(wall), { u0: op.at, u1: op.at + op.width, v0: op.roBottom, v1: op.roTop, w0: 0, w1: wall.depth }, 'u', 'v');
    const sill = unit.find((x) => x.tags.includes('unit:sill'))!;
    legacy.parts['O1-PN01'] = { ...sill, ...placed, id: 'O1-PN01', role: 'panel', tags: ['window', 'opening:O1'] };
    legacy.parts['O1-X01'] = { ...sill, ...placed, id: 'O1-X01', role: 'other', tags: ['note'], position: { x: 0, y: 5000, z: -5000 } };
    delete (legacy.assemblies.O1!.builder!.params as Record<string, unknown>).style;

    const p = runOk(legacy, 'update_opening', { openingId: 'O1', width: '40in' }, unitCtx).project;
    expect(p.parts['O1-PN01']).toBeUndefined();
    expect(p.parts['O1-X01']).toEqual(legacy.parts['O1-X01']);
    expect(unitParts(p).length).toBe(unit.length);
    expect(params(p)).toMatchObject({ style: 'casement' });
  });
});
