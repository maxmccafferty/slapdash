import { CommandBus, createProject, type Project } from '@slapdash/core';
import { TIER1_CATALOG } from '@slapdash/catalog';
import { buildSampleShell } from '../../src/model/sample-shell.ts';

/** A bus holding the 16 × 20 pool-house shell (optionally with stippled site context). */
export function sampleBus(opts: { context?: boolean } = {}): CommandBus {
  const bus = new CommandBus({ project: createProject({ name: 'Pool house' }), catalog: TIER1_CATALOG });
  buildSampleShell(bus, opts);
  return bus;
}

let cached: Project | null = null;
export function sampleProject(): Project {
  return (cached ??= sampleBus().project);
}
