/**
 * Starting models for edit scenarios, built with builder commands on the bus: no tokens,
 * deterministic, and the history before the turn is known. These mirror
 * `apps/web/src/model/sample-shell.ts`, which evals can't import (it lives in the web app).
 *
 * Plan axes: +x east, +z south, so z = 0 is the north edge. Walls come out W1…W4 in order.
 */
import { formatErrors, type CommandBus } from '@slapdash/core';

export type SeedCommands = ReadonlyArray<readonly [string, unknown]>;

/** Slab 20ft × 16ft at the origin and four 9ft walls: W1 north, W2 east, W3 south, W4 west. No openings, no roof. */
export const POOL_HOUSE_WALLS: SeedCommands = [
  ['pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }],
  ['build_wall', { start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '9ft', name: 'North wall' }],
  ['build_wall', { start: { x: '20ft', z: 0 }, end: { x: '20ft', z: '16ft' }, height: '9ft', name: 'East wall' }],
  ['build_wall', { start: { x: '20ft', z: '16ft' }, end: { x: 0, z: '16ft' }, height: '9ft', name: 'South wall' }],
  ['build_wall', { start: { x: 0, z: '16ft' }, end: { x: 0, z: 0 }, height: '9ft', name: 'West wall' }],
];

/**
 * Slab 10ft (east-west) × 8ft (north-south), walls in the same order and naming: north, east
 * and west 8ft, south 9ft 11 1/4in, the high side of a 3 in 12 shed roof sloping down to the
 * north (the roof builder needs the walls to meet the roof line within a fraction of an inch).
 */
export const SHED_WALLS_8x10: SeedCommands = [
  ['pour_slab', { from: { x: 0, z: 0 }, to: { x: '10ft', z: '8ft' } }],
  ['build_wall', { start: { x: 0, z: 0 }, end: { x: '10ft', z: 0 }, height: '8ft', name: 'North wall' }],
  ['build_wall', { start: { x: '10ft', z: 0 }, end: { x: '10ft', z: '8ft' }, height: '8ft', name: 'East wall' }],
  ['build_wall', { start: { x: '10ft', z: '8ft' }, end: { x: 0, z: '8ft' }, height: '9ft 11.25in', name: 'South wall' }],
  ['build_wall', { start: { x: 0, z: '8ft' }, end: { x: 0, z: 0 }, height: '8ft', name: 'West wall' }],
];

/**
 * A tree whose 12in trunk sits right on the line from the origin east, 15ft along, so a
 * straight fence there would run through it. (The canopy starts 10ft up, clear of fences.)
 */
export const TREE_ON_LINE: SeedCommands = [['place_structure', { kind: 'tree', at: { x: '15ft', z: 0 } }]];

/** Runs the commands as the person, in one undo step. Throws if any is refused. */
export function applySeed(bus: CommandBus, commands: SeedCommands): void {
  bus.group({ label: 'Eval seed', source: 'user', turnId: 'seed' }, () => {
    for (const [name, input] of commands) {
      const res = bus.execute(name, input);
      if (!res.ok) throw new Error(`Seed ${name}: ${formatErrors(res.errors)}`);
    }
  });
}
