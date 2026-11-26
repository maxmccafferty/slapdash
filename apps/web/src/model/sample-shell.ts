/**
 * The 16 × 20 pool-house shell from the core acceptance test
 * (`packages/core/test/builders/shell.acceptance.test.ts`): slab, four 9 ft walls, a sliding
 * door, a window and a 6 in 12 gable. Builder-made, through the bus, in one group (one
 * Claude turn). Used by `?sample=pool-house` in dev and by the e2e tests.
 */
import { formatErrors, type CommandBus } from '@slapdash/core';

export const SAMPLE_SHELL_COMMANDS: ReadonlyArray<readonly [string, unknown]> = [
  ['pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }],
  ['build_wall', { start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '9ft', name: 'North wall' }],
  ['build_wall', { start: { x: '20ft', z: 0 }, end: { x: '20ft', z: '16ft' }, height: '9ft', name: 'East wall' }],
  ['build_wall', { start: { x: '20ft', z: '16ft' }, end: { x: 0, z: '16ft' }, height: '9ft', name: 'South wall' }],
  ['build_wall', { start: { x: 0, z: '16ft' }, end: { x: 0, z: 0 }, height: '9ft', name: 'West wall' }],
  ['add_opening', { wallId: 'W3', kind: 'sliding-door', centerAt: '10ft' }],
  ['add_opening', { wallId: 'W2', kind: 'window', centerAt: '8ft' }],
  ['build_roof', { type: 'gable', from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' }, pitch: '6 in 12', ridgeAxis: 'x' }],
];

/** Site context to exercise stippling: the existing house next door and a tree. */
export const SAMPLE_CONTEXT_COMMANDS: ReadonlyArray<readonly [string, unknown]> = [
  ['place_structure', { kind: 'house', at: { x: '30ft', z: 0 }, width: '30ft', depth: '20ft' }],
  ['place_structure', { kind: 'tree', at: { x: '-8ft', z: '24ft' } }],
];

export interface SampleOptions {
  context?: boolean;
  /** Called with the ids each command created, e.g. to outline them as "in progress". */
  onCreated?: (ids: string[]) => void;
}

/** Run the sample on a bus in one undo group. Throws if a command is refused. */
export function buildSampleShell(bus: CommandBus, opts: SampleOptions = {}): void {
  const commands = [...SAMPLE_SHELL_COMMANDS, ...(opts.context ? SAMPLE_CONTEXT_COMMANDS : [])];
  bus.group({ label: 'Build the pool house shell', source: 'claude', turnId: 'sample' }, () => {
    for (const [name, input] of commands) {
      const res = bus.execute(name, input);
      if (!res.ok) throw new Error(`${name}: ${formatErrors(res.errors)}`);
      opts.onCreated?.(res.created.filter((id) => id in bus.project.parts));
    }
  });
}
