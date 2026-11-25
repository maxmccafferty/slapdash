import { assemblyCommands } from './assemblies.ts';
import { internalCommands } from './internal.ts';
import { jointCommands } from './joints.ts';
import { partCommands } from './parts.ts';
import { siteCommands } from './site.ts';
import type { AnyCommandDef } from './types.ts';

const all: AnyCommandDef[] = [
  ...assemblyCommands,
  ...partCommands,
  ...jointCommands,
  ...siteCommands,
  ...internalCommands,
] as AnyCommandDef[];

/** Every command by name, including the internal ones used for undo. */
export const commandRegistry: ReadonlyMap<string, AnyCommandDef> = new Map(all.map((d) => [d.name, d]));

/** The commands offered to Claude (and later the UI). Internal undo commands are excluded. */
export function exposedCommands(): AnyCommandDef[] {
  return all.filter((d) => d.exposed);
}
