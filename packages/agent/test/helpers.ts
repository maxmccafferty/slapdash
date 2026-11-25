import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { TIER1_CATALOG } from '@slapdash/catalog';
import { CommandBus, createProject, formatErrors, type Project } from '@slapdash/core';
import { expect } from 'vitest';

export function fixedClock(start = 1_800_000_000_000) {
  let t = start;
  return () => t++;
}

export function makeBus(project: Project = createProject({ name: 'Pool house' })): CommandBus {
  return new CommandBus({ project, catalog: TIER1_CATALOG, now: fixedClock() });
}

export function exec(bus: CommandBus, name: string, input: unknown) {
  const res = bus.execute(name, input);
  if (!res.ok) throw new Error(`${name}: ${formatErrors(res.errors)}`);
  return res;
}

/** The 16 × 20 shell inputs: a slab and four 9ft walls, clockwise. */
export const SHELL: [string, unknown][] = [
  ['pour_slab', { from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' } }],
  ['build_wall', { start: { x: 0, z: 0 }, end: { x: '20ft', z: 0 }, height: '9ft', name: 'North wall' }],
  ['build_wall', { start: { x: '20ft', z: 0 }, end: { x: '20ft', z: '16ft' }, height: '9ft', name: 'East wall' }],
  ['build_wall', { start: { x: '20ft', z: '16ft' }, end: { x: 0, z: '16ft' }, height: '9ft', name: 'South wall' }],
  ['build_wall', { start: { x: 0, z: '16ft' }, end: { x: 0, z: 0 }, height: '9ft', name: 'West wall' }],
];

/** A bus with the slab, four walls, a sliding door in W3 and a gable roof. */
export function poolHouseBus(): CommandBus {
  const bus = makeBus();
  for (const [name, input] of SHELL) exec(bus, name, input);
  exec(bus, 'add_opening', { wallId: 'W3', kind: 'sliding-door', centerAt: '10ft' });
  exec(bus, 'build_roof', { type: 'gable', from: { x: 0, z: 0 }, to: { x: '20ft', z: '16ft' }, pitch: '6 in 12', ridgeAxis: 'x' });
  return bus;
}

type Block = { type: string; id?: string; tool_use_id?: string };

/**
 * The messages are a valid request: they start with a user message, roles alternate, and
 * every tool_use is answered by a tool_result in the next message (and nothing else is).
 */
export function expectValidMessages(messages: readonly BetaMessageParam[]): void {
  expect(messages.length).toBeGreaterThan(0);
  expect(messages[0]!.role).toBe('user');
  messages.forEach((m, i) => {
    if (i > 0) expect(m.role, `message ${i} repeats the role ${m.role}`).not.toBe(messages[i - 1]!.role);
    const blocks = (typeof m.content === 'string' ? [] : m.content) as Block[];
    expect(typeof m.content === 'string' || blocks.length > 0, `message ${i} is empty`).toBe(true);
    for (const b of blocks) expect(b.type.startsWith('slapdash_'), `message ${i} leaks ${b.type}`).toBe(false);
    const uses = blocks.filter((b) => b.type === 'tool_use').map((b) => b.id);
    const results = (i > 0 && messages[i - 1]!.role === 'assistant' && typeof messages[i - 1]!.content !== 'string'
      ? (messages[i - 1]!.content as Block[]).filter((b) => b.type === 'tool_use').map((b) => b.id)
      : []) as string[];
    const answered = blocks.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id);
    expect(answered, `message ${i} answers the wrong tool calls`).toEqual(results);
    if (uses.length > 0) {
      const next = messages[i + 1];
      if (next) {
        const nextBlocks = (typeof next.content === 'string' ? [] : next.content) as Block[];
        expect(nextBlocks.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id)).toEqual(uses);
      }
    }
  });
}
