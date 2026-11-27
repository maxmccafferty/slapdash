import { describe, expect, it } from 'vitest';
import type { Project } from '../../../src/index.ts';
import { expectRoundTrip, makeBus, runErr, runOk } from '../../helpers.ts';
import { counts, expectInPlace, geometry, inWall, poolWalls, tagged, withOpenings } from './opening-fixtures.ts';

const door = { wallId: 'W3', kind: 'door', centerAt: '10ft' } as const;
const window = { wallId: 'W1', kind: 'window', at: '5ft' } as const;
const jointCount = (p: Project) => Object.keys(p.joints).length;
const anchorsOn = (p: Project, id: string) => Object.values(p.joints).filter((j) => j.jointTypeId === 'anchor-bolt' && j.partIds.includes(id));

describe('remove_opening', () => {
  it('removes a door and gives back the bare wall', () => {
    const before = withOpenings(door);
    const res = expectRoundTrip(before, 'remove_opening', { openingId: 'O1' });
    const p = res.project;
    expectInPlace(before, p, 'O1', 'W3', true);
    expect(p.assemblies.O1).toBeUndefined();
    expect(Object.values(p.parts).some((x) => x.assemblyId === 'O1' || x.tags.includes('opening:O1'))).toBe(false);
    const bare = poolWalls();
    expect(counts(p, 'W3')).toEqual(counts(bare, 'W3'));
    expect(geometry(p)).toEqual(geometry(bare));
    expect(jointCount(p)).toBe(jointCount(bare));
    const plates = tagged(p, 'W3', 'plate', 'bottom');
    expect(plates).toHaveLength(1);
    expect(plates[0]!.size.length).toBeCloseTo(tagged(bare, 'W3', 'plate', 'bottom')[0]!.size.length);
    expect(anchorsOn(p, plates[0]!.id)).toHaveLength(1);
    expect(res.summary).toBe('Removed O1 (3\' 2" × 6\' 10 1/2" door) from W3: put back 2 common studs, the bottom plate and the sheathing.');
  });

  it('removes a window: whole sheathing sheets and commons come back', () => {
    const before = withOpenings(window);
    const p = expectRoundTrip(before, 'remove_opening', { openingId: 'O1' }).project;
    expectInPlace(before, p, 'O1', 'W1', true);
    const bare = poolWalls();
    expect(geometry(p)).toEqual(geometry(bare));
    expect(counts(p, 'W1')).toEqual(counts(bare, 'W1'));
    expect(jointCount(p)).toBe(jointCount(bare));
  });

  it('removing one of two openings leaves the other one framed and cut', () => {
    const before = withOpenings(door, { wallId: 'W3', kind: 'window', at: '2ft' });
    const p = expectRoundTrip(before, 'remove_opening', { openingId: 'O1' }).project;
    expectInPlace(before, p, 'O1', 'W3', true);
    for (const x of Object.values(before.parts).filter((x) => x.tags.includes('opening:O2'))) expect(p.parts[x.id]).toEqual(x);
    const only = withOpenings({ wallId: 'W3', kind: 'window', at: '2ft' });
    expect(counts(p, 'W3')).toEqual(counts(only, 'W3'));
    expect(jointCount(p)).toBe(jointCount(only));
    // Same geometry, apart from the window being O2 rather than O1.
    expect(geometry(p)).toEqual(geometry(only).map((g) => g.replaceAll('O1', 'O2')).sort());
  });

  it('keeps sheathing off where it was taken off, and copes with a missing plate piece', () => {
    let p = withOpenings(door);
    p = runOk(p, 'delete_parts', { ids: inWall(p, 'W3').filter((x) => x.role === 'sheathing').map((x) => x.id) }).project;
    const res = runOk(p, 'remove_opening', { openingId: 'O1' });
    expect(inWall(res.project, 'W3').filter((x) => x.role === 'sheathing')).toHaveLength(0);
    expect(res.summary).toBe('Removed O1 (3\' 2" × 6\' 10 1/2" door) from W3: put back 2 common studs and the bottom plate.');

    let q = withOpenings(door);
    const right = tagged(q, 'W3', 'plate', 'bottom').sort((a, b) => a.position.x - b.position.x)[0]!;
    q = runOk(q, 'delete_parts', { ids: [right.id] }).project;
    expect(runOk(q, 'remove_opening', { openingId: 'O1' }).project.assemblies.O1).toBeUndefined();
  });

  it('refuses an unknown opening or a hand-made one, changing nothing', () => {
    const before = withOpenings(door);
    expect(runErr(before, 'remove_opening', { openingId: 'O9' })[0]).toMatchObject({ code: 'not_found', path: 'openingId' });
    const p = runOk(before, 'add_assembly', { name: 'Hand door', kind: 'opening' }).project;
    const id = Object.keys(p.assemblies).find((a) => !Object.hasOwn(before.assemblies, a))!;
    const [err] = runErr(p, 'remove_opening', { openingId: id });
    expect(err).toMatchObject({ code: 'not_allowed', path: 'openingId' });
    const bus = makeBus(p);
    expect(bus.execute('remove_opening', { openingId: id }).ok).toBe(false);
    expect(bus.project).toBe(p);
  });

  it('undo through the bus restores it in one step', () => {
    const before = withOpenings(door);
    const bus = makeBus(before);
    expect(bus.execute('remove_opening', { openingId: 'O1' }).ok).toBe(true);
    bus.undo();
    const { counters: _a, ...now } = bus.project;
    const { counters: _b, ...was } = before;
    expect(now).toEqual(was);
  });
});
