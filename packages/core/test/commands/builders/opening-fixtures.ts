/** Shared fixtures for the update_opening and remove_opening tests. */
import { expect } from 'vitest';
import { createProject, type Project } from '../../../src/index.ts';
import { expectSound, runOk } from '../../helpers.ts';

export const IN = 25.4;

/** The pool house's four walls on a 20 x 16ft slab: W1 north, W2 east, W3 south, W4 west. */
export function poolWalls(): Project {
  let p = runOk(createProject({ name: 'Pool house' }), 'pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }).project;
  p = runOk(p, 'build_wall', { start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '9ft', name: 'North wall' }).project;
  p = runOk(p, 'build_wall', { start: { x: '20ft', z: 0 }, end: { x: '20ft', z: '16ft' }, height: '9ft', name: 'East wall' }).project;
  p = runOk(p, 'build_wall', { start: { x: '20ft', z: '16ft' }, end: { x: 0, z: '16ft' }, height: '9ft', name: 'South wall' }).project;
  return runOk(p, 'build_wall', { start: { x: 0, z: '16ft' }, end: { x: 0, z: 0 }, height: '9ft', name: 'West wall' }).project;
}

/** The pool house with openings added in order (O1, O2, …). */
export function withOpenings(...openings: Record<string, unknown>[]): Project {
  let p = poolWalls();
  for (const o of openings) p = runOk(p, 'add_opening', o).project;
  return p;
}

export const inWall = (p: Project, wall: string) => Object.values(p.parts).filter((x) => x.assemblyId === wall);
export const tagged = (p: Project, wall: string, role: string, tag: string) => inWall(p, wall).filter((x) => x.role === role && x.tags.includes(tag));
export const counts = (p: Project, wall: string) => ({
  common: tagged(p, wall, 'stud', 'common').length,
  king: tagged(p, wall, 'stud', 'king').length,
  jack: tagged(p, wall, 'stud', 'jack').length,
  cripple: tagged(p, wall, 'stud', 'cripple').length,
  header: inWall(p, wall).filter((x) => x.role === 'header').length,
  sill: inWall(p, wall).filter((x) => x.role === 'sill').length,
  bottom: tagged(p, wall, 'plate', 'bottom').length,
  sheathing: inWall(p, wall).filter((x) => x.role === 'sheathing').length,
});

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Every part as (assembly, role, tags, position, size), sorted: the model's geometry without IDs. */
export const geometry = (p: Project) =>
  Object.values(p.parts)
    .map(
      (x) =>
        `${x.assemblyId}|${x.role}|${x.sectionId ?? ''}|${x.tags.join(',')}|${r1(x.position.x)},${r1(x.position.y)},${r1(x.position.z)}|${r1(x.size.length)},${r1(x.size.width)},${r1(x.size.height)}`,
    )
    .sort();

/**
 * Parts an opening edit may re-make: the opening's own, and the wall's commons, bottom
 * plate pieces and sheathing (the geometry tests pin down which ones actually change).
 */
function mayChange(p: Project, id: string, openingId: string, wallId: string): boolean {
  const part = p.parts[id]!;
  if (part.assemblyId === openingId || part.tags.includes(`opening:${openingId}`)) return true;
  if (part.assemblyId !== wallId) return false;
  return part.role === 'sheathing' || (part.role === 'plate' && part.tags.includes('bottom')) || (part.role === 'stud' && part.tags.includes('common'));
}

/**
 * The edit happened in place: the wall's recipe and every assembly are still there,
 * parts outside the opening's framing keep their IDs and values, other walls are
 * untouched, and the result is sound.
 */
export function expectInPlace(before: Project, after: Project, openingId: string, wallId: string, removed = false) {
  expect(after.assemblies[wallId]).toEqual(before.assemblies[wallId]);
  for (const a of Object.keys(before.assemblies)) {
    if (removed && a === openingId) expect(after.assemblies).not.toHaveProperty(a);
    else expect(after.assemblies).toHaveProperty(a);
  }
  for (const [id, part] of Object.entries(before.parts)) {
    if (mayChange(before, id, openingId, wallId)) continue;
    expect(after.parts[id], id).toEqual(part);
  }
  expectSound(after);
}
