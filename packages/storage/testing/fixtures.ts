import { CommandBus, SAMPLE_CATALOG, createProject } from '@slapdash/core';
import type { ProjectRecord } from '../src/types.ts';

/** A fixed clock that ticks 1 ms per call. */
export function fixedClock(start = 1_700_000_000_000): () => number {
  let t = start;
  return () => t++;
}

/** Sequential ids: `${prefix}-1`, `${prefix}-2`, … */
export function sequentialIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function must(res: { ok: boolean }, what: string): void {
  if (!res.ok) throw new Error(`sampleRecord: ${what} failed: ${JSON.stringify(res)}`);
}

/**
 * A realistic record built through the command bus: a small wall with a joint, an undo
 * stack, a redo stack, a named version and a chat log with content blocks and a summary.
 */
export function sampleRecord(opts: { id?: string; name?: string; updatedAt?: number } = {}): ProjectRecord {
  const now = fixedClock();
  const bus = new CommandBus({ project: createProject({ name: 'New project' }), catalog: SAMPLE_CATALOG, now });
  bus.group({ label: 'Build the south wall', source: 'claude', turnId: 't1' }, () => {
    must(bus.execute('add_assembly', { name: 'South wall', kind: 'wall' }), 'add_assembly');
    must(
      bus.execute('add_part', {
        assemblyId: 'W1',
        role: 'stud',
        materialId: 'spf-no2',
        sectionId: '2x4',
        position: { x: 0, y: 38.1, z: 0 },
        length: '92 5/8in',
      }),
      'add_part',
    );
    must(
      bus.execute('add_part', {
        assemblyId: 'W1',
        role: 'plate',
        materialId: 'spf-no2',
        sectionId: '2x4',
        position: { x: 0, y: 0, z: 0 },
        length: '8ft',
      }),
      'add_part plate',
    );
    must(bus.execute('connect', { jointTypeId: 'nailed-16d', partIds: ['W1-S01', 'W1-P01'], at: { x: 0, y: 38.1, z: 0 } }), 'connect');
  });
  must(bus.saveVersion('first wall', 'before the second stud'), 'saveVersion');
  must(
    bus.execute('add_part', {
      assemblyId: 'W1',
      role: 'stud',
      materialId: 'spf-no2',
      sectionId: '2x4',
      position: { x: '16in', y: 38.1, z: 0 },
      length: '92 5/8in',
    }),
    'add_part 2',
  );
  must(bus.execute('rename_project', { name: opts.name ?? 'Pool house' }), 'rename_project');
  must(bus.execute('set_design_load', { key: 'groundSnow', value: '30 psf', source: 'user', note: 'from the county' }), 'set_design_load');
  must(bus.undo(), 'undo'); // leaves one entry on the redo stack

  return {
    id: opts.id ?? 'sample-1',
    meta: { name: bus.project.name, named: true, createdAt: 1_700_000_000_000, updatedAt: opts.updatedAt ?? 1_700_000_100_000 },
    project: bus.project,
    history: bus.serialize(),
    chat: {
      version: 1,
      summary: 'The user wants a small pool house with one framed wall so far.',
      messages: [
        { id: 'm1', role: 'user', at: 1_700_000_000_500, turnId: 't1', content: 'Build me the south wall, 8 ft long.' },
        {
          id: 'm2',
          role: 'assistant',
          at: 1_700_000_000_900,
          turnId: 't1',
          content: [
            { type: 'text', text: 'Added the south wall with a stud and a plate.' },
            { type: 'tool_use', id: 'tu_1', name: 'add_part', input: { assemblyId: 'W1', length: '92 5/8in', nested: [1, null, true] } },
          ],
        },
      ],
    },
  };
}

/** Bytes 0..255, then `extra` more bytes, so every byte value is covered. */
export function allBytes(extra = 0): Uint8Array {
  const out = new Uint8Array(256 + extra);
  for (let i = 0; i < out.length; i++) out[i] = i % 256;
  return out;
}
