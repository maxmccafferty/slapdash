/**
 * Roof joints are flush in world space, measured on the faces the renderer draws
 * (`geometry/faces.ts`: the cut solid's surface triangles, placed by position + rotation):
 *
 * - each common rafter's ridge plumb cut on the ridge board's side face;
 * - each birdsmouth's seat on the cap plate and its heel on the wall's outside face;
 * - the bevelled top rows of gable sheathing on one plumb plane at the ridge;
 * - a shed's seats and heels on the low and the high plates.
 *
 * "Flush" is: opposed faces, parallel within 0.01°, every vertex of the cut face within
 * 0.5 mm of the other face's plane, and a real shared area (they overlap, not just align).
 */
import { describe, expect, it } from 'vitest';
import {
  contactGap,
  createProject,
  faceToward,
  facingFace,
  parseLength,
  partFaces,
  partSolidAabb,
  type FaceContact,
  type Part,
  type PlanarFace,
  type Project,
} from '../../src/index.ts';
import { run, runErr, runOk } from '../helpers.ts';

const IN = 25.4;
const FT = 12 * IN;
const TOL = 0.5;
const SLAB = 4 * IN;

/** Worst |gap| seen per joint kind, across every case in this file (reported at the end). */
const worst: Record<string, number> = {};
const note = (kind: string, c: FaceContact) => (worst[kind] = Math.max(worst[kind] ?? 0, contactGap(c)));

/** A slab and four walls around L (x) × S (z), north wall along z = 0; optionally a taller south wall (mm). */
function shell(L: number, S: number, south?: number): Project {
  let p = runOk(createProject({ name: 't' }), 'pour_slab', { from: { x: 0, z: 0 }, to: { x: `${L}mm`, z: `${S}mm` } }).project;
  const wall = (start: unknown, end: unknown, height = '9ft') => (p = runOk(p, 'build_wall', { start, end, height }).project);
  const [x1, z1] = [`${L}mm`, `${S}mm`];
  wall({ x: 0, z: 0 }, { x: x1, z: 0 });
  wall({ x: x1, z: 0 }, { x: x1, z: z1 });
  wall({ x: x1, z: z1 }, { x: 0, z: z1 }, south === undefined ? '9ft' : `${south}mm`);
  wall({ x: 0, z: z1 }, { x: 0, z: 0 });
  return p;
}

const inRoof = (p: Project) => Object.values(p.parts).filter((x) => p.assemblies[x.assemblyId]?.kind === 'roof');
const inWall = (p: Project, wallId: string) => Object.values(p.parts).filter((x) => x.assemblyId === wallId);
/** The north (z = 0) and south (z = S) walls, by their builder params. */
function wallOn(p: Project, z: number): string {
  const w = Object.values(p.assemblies).find((a) => {
    const params = a.builder?.params as { start?: { z: number }; end?: { z: number } } | undefined;
    return a.kind === 'wall' && Math.abs((params?.start?.z ?? NaN) - z) < 1 && Math.abs((params?.end?.z ?? NaN) - z) < 1;
  });
  if (!w) throw new Error(`no wall on z = ${z}`);
  return w.id;
}

/** Flush: parallel, within TOL of the other plane, and sharing area. */
function expectFlush(kind: string, what: string, c: FaceContact | undefined, minArea = 1) {
  expect(c, `${what}: no opposed face`).toBeDefined();
  note(kind, c!);
  expect(c!.angleDeg, `${what}: angle`).toBeLessThan(0.01);
  expect(contactGap(c!), `${what}: gap ${c!.minGapMm.toFixed(3)}..${c!.maxGapMm.toFixed(3)} mm`).toBeLessThanOrEqual(TOL);
  expect(c!.overlapArea, `${what}: shared area`).toBeGreaterThan(minArea);
}

/** Sum of shared area between `part`'s best face toward each target and that target, all within TOL. */
function seatOn(part: Part, targets: PlanarFace[], kind: string, what: string): { area: number; face: PlanarFace | null } {
  let area = 0;
  let face: PlanarFace | null = null;
  for (const t of targets) {
    const hit = facingFace(part, t);
    // Faces that only line up from afar (a lower sheathing panel's top edge a foot down)
    // are not in contact; anything within an inch is, and must then be within TOL.
    if (!hit || hit.contact.overlapArea < 1 || contactGap(hit.contact) > IN) continue;
    expectFlush(kind, what, hit.contact);
    area += hit.contact.overlapArea;
    face = hit.face;
  }
  expect(area, `${what}: touches nothing`).toBeGreaterThan(1);
  return { area, face };
}

const UP = { x: 0, y: 1, z: 0 };
const NORTH = { x: 0, y: 0, z: -1 };
const SOUTH = { x: 0, y: 0, z: 1 };
const caps = (p: Project, wallId: string) => inWall(p, wallId).filter((x) => x.role === 'plate' && x.tags.includes('top-cap'));
const wallSheets = (p: Project, wallId: string) => inWall(p, wallId).filter((x) => x.role === 'sheathing');
/**
 * What a birdsmouth seat bears on: cap plate tops and the sheathing's top edges, of every
 * wall (at a corner the end wall's plate may be the one under the seat). Only faces near the
 * seat count (see `seatOn`).
 */
const allWalls = (p: Project) => Object.values(p.assemblies).filter((a) => a.kind === 'wall').map((a) => a.id);
const seatTargets = (p: Project) => allWalls(p).flatMap((w) => [...caps(p, w), ...wallSheets(p, w)]).map((c) => faceToward(c, UP));

/**
 * Birdsmouth on a bearing wall: the seat on the cap plate top, the heel on `heelTargets`.
 * Returns the seat and heel areas so callers can check they are the full cut faces.
 */
function expectBirdsmouth(rf: Part, plateTops: PlanarFace[], heelTargets: PlanarFace[], where: string) {
  const seat = seatOn(rf, plateTops, 'seat', `${rf.id} seat on the ${where} plate`);
  const heel = seatOn(rf, heelTargets, 'heel', `${rf.id} heel at the ${where} wall`);
  // The whole seat and heel faces bear: nothing of either hangs in air.
  expect(seat.area / seat.face!.area, `${rf.id} seat bears fully`).toBeGreaterThan(0.999);
  expect(heel.area / heel.face!.area, `${rf.id} heel bears fully`).toBeGreaterThan(0.999);
}

describe('gable roof joints are flush in world space', () => {
  const PITCHES = [1, 4, 6, 12, 24];
  const SPANS = [10 * FT, 16 * FT, 24 * FT];
  const cases = PITCHES.flatMap((rise) => SPANS.map((S) => ({ rise, S, ft: S / FT })));

  it.each(cases)('$rise in 12 over $ft ft', ({ rise, S }) => {
    const L = 20 * FT;
    const base = shell(L, S);
    const input = { type: 'gable', ridgeAxis: 'x', from: { x: 0, z: 0 }, to: { x: `${L}mm`, z: `${S}mm` }, pitch: `${rise} in 12` };
    const res = run(base, { name: 'build_roof', input });
    if (!res.ok) {
      // Steep and wide: the rafters are past stock length, so the builder refuses. Each pitch
      // still builds at the 10ft span (checked below).
      expect(S).toBeGreaterThan(10 * FT);
      expect(res.errors[0]!.message).toMatch(/past the 20' 0" stock length/);
      return;
    }
    const p = res.project;
    const parts = inRoof(p);
    const ridge = parts.find((x) => x.role === 'ridge')!;
    const ridgeFace = { north: faceToward(ridge, NORTH), south: faceToward(ridge, SOUTH) };
    const ridgeTop = Math.max(...partFaces(ridge).flatMap((f) => f.vertices.map((v) => v.y)));
    const commons = parts.filter((x) => x.role === 'rafter' && x.tags.includes('common'));
    expect(commons.length).toBeGreaterThan(4);
    const north = wallOn(p, 0);
    const south = wallOn(p, S);
    // The seat bears on the cap plate and, for its first 7/16in, on the top edge of the wall sheathing.
    const plateTops = { north: seatTargets(p), south: seatTargets(p) };
    // The wall's outside face: its sheathing's outer face (north wall faces −z, south +z).
    const outside = { north: wallSheets(p, north).map((s) => faceToward(s, NORTH)), south: wallSheets(p, south).map((s) => faceToward(s, SOUTH)) };

    for (const rf of commons) {
      const side = rf.tags.includes('side:north') ? 'north' : 'south';
      // Ridge: the plumb cut lands on the ridge board's side face.
      const hit = facingFace(rf, ridgeFace[side]);
      expectFlush('ridge', `${rf.id} at the ridge`, hit?.contact);
      const plumb = hit!.face;
      const plumbTop = Math.max(...plumb.vertices.map((v) => v.y));
      const plumbBottom = Math.min(...plumb.vertices.map((v) => v.y));
      // Tops flush, and the shared area runs from the top down the full ridge-board depth or the plumb cut, whichever stops first.
      expect(plumbTop).toBeCloseTo(ridgeTop, 3);
      expect(hit!.contact.overlapY!.max).toBeCloseTo(ridgeTop, 3);
      const ridgeBottom = ridgeTop - ridge.size.height;
      expect(hit!.contact.overlapY!.min).toBeCloseTo(Math.max(plumbBottom, ridgeBottom), 3);
      // Birdsmouth: seat on the cap plate, heel on the sheathing's outside face.
      expectBirdsmouth(rf, plateTops[side], outside[side], side);
    }

    // Sheathing: the bevelled top rows meet on one plumb plane, on the ridge centreline.
    const bevelled = parts.filter((x) => x.role === 'sheathing' && (x.cuts?.farEdge || x.cuts?.nearEdge));
    const bn = bevelled.filter((x) => x.tags.includes('side:north'));
    const bs = bevelled.filter((x) => x.tags.includes('side:south'));
    expect(bn.length).toBeGreaterThan(0);
    expect(bs.length).toBe(bn.length);
    let shared = 0;
    for (const a of bn) {
      const fa = faceToward(a, SOUTH);
      expect(fa.offset, `${a.id} bevel on the ridge centreline`).toBeCloseTo(S / 2, 3);
      for (const b of bs) {
        const hit = facingFace(b, fa);
        if (!hit || hit.contact.overlapArea < 1) continue;
        expectFlush('sheathing', `${a.id} meets ${b.id} at the ridge`, hit.contact);
        // The two top faces meet on the apex line: both bevels top out at the same height.
        const topA = Math.max(...fa.vertices.map((v) => v.y));
        expect(hit.contact.overlapY!.max).toBeCloseTo(topA, 3);
        shared += hit.contact.overlapArea;
      }
    }
    // Every bit of the north bevels meets a south bevel (no part of the ridge line is open).
    expect(shared / bn.reduce((s, a) => s + faceToward(a, SOUTH).area, 0)).toBeGreaterThan(0.999);
  });
});

describe('shed roof joints are flush in world space', () => {
  it.each([1, 2, 3, 4, 6])('%i in 12: seats and heels on the low and high plates', (rise) => {
    const L = 12 * FT;
    const S = 10 * FT;
    const input = { type: 'shed', lowSide: 'north', from: { x: 0, z: 0 }, to: { x: `${L}mm`, z: `${S}mm` }, pitch: `${rise} in 12` };
    const msg = runErr(shell(L, S), 'build_roof', input)[0]!.message;
    const needed = parseLength(/needs them at (.+)\. Build/.exec(msg)![1]!);
    if (!needed.ok) throw new Error(msg);
    const p = runOk(shell(L, S, needed.value - SLAB), 'build_roof', input).project;
    const commons = inRoof(p).filter((x) => x.role === 'rafter' && x.tags.includes('common'));
    expect(commons.length).toBeGreaterThan(4);
    const north = wallOn(p, 0);
    const south = wallOn(p, S);
    const lowTops = seatTargets(p);
    const lowOutside = wallSheets(p, north).map((s) => faceToward(s, NORTH));
    const highTops = seatTargets(p);
    // The high heel bears on the inside faces of the high wall's plates (the cap, and the top
    // plate below it once the heel is deeper than 1 1/2in).
    const highPlates = inWall(p, south).filter((x) => x.role === 'plate' && (x.tags.includes('top-cap') || x.tags.includes('top')));
    const highInside = highPlates.map((c) => faceToward(c, NORTH));
    const plateX = { min: Math.min(...highPlates.map((c) => partSolidAabb(c).min.x)), max: Math.max(...highPlates.map((c) => partSolidAabb(c).max.x)) };
    let overCorner = 0;
    for (const rf of commons) {
      expect(rf.cuts?.notches).toHaveLength(2);
      expectBirdsmouth(rf, lowTops, lowOutside, 'low');
      // Known gap, not a cut problem: the high wall butts into the (lower) east side wall, so
      // its plates stop 3 1/2in short of the corner and the end rafter there has no plate
      // under its high end, only the edge of the wall sheathing. Every rafter over the high
      // plates must bear on them fully.
      const x0 = partSolidAabb(rf).min.x;
      if (x0 > plateX.max - 1 || x0 + 1.5 * IN < plateX.min + 1) {
        overCorner++;
        continue;
      }
      expectBirdsmouth(rf, highTops, highInside, 'high');
    }
    expect(overCorner).toBe(1);
  });
});

describe('the measurement', () => {
  it('sees a rafter that stops short of the ridge, or runs into it', () => {
    const p = runOk(shell(20 * FT, 16 * FT), 'build_roof', { type: 'gable', from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' }, pitch: '6 in 12' }).project;
    const ridge = inRoof(p).find((x) => x.role === 'ridge')!;
    const rf = inRoof(p).find((x) => x.role === 'rafter' && x.tags.includes('common') && x.tags.includes('side:north'))!;
    const face = faceToward(ridge, NORTH);
    for (const dz of [-3, -0.6, 0.6, 3]) {
      const moved = { ...rf, position: { ...rf.position, z: rf.position.z + dz } };
      const c = facingFace(moved, face)!.contact;
      // Moving north (−z) opens a gap (+); moving south runs it into the ridge (−).
      expect(c.minGapMm).toBeCloseTo(-dz, 6);
      expect(c.maxGapMm).toBeCloseTo(-dz, 6);
      expect(contactGap(c) > TOL).toBe(true);
    }
    // A plumb cut at the wrong angle (4/12 on a 6/12 rafter) has no face on the ridge: the
    // nearest parallel one is the heel, far away.
    const tilted = { ...rf, cuts: { ...rf.cuts!, end: { slope: -(Math.atan(4 / 12) * 180) / Math.PI } } };
    const hit = facingFace(tilted, face);
    expect(hit === null || contactGap(hit.contact) > 100).toBe(true);
  });
});

describe('worst-case gaps', () => {
  it('is reported', () => {
    // One line for the record; every case above already asserts ≤ 0.5 mm.
    console.log(`worst |gap| (mm): ${Object.entries(worst).map(([k, v]) => `${k} ${v.toExponential(2)}`).join(', ')}`);
    expect(Object.values(worst).every((v) => v <= TOL)).toBe(true);
  });
});
