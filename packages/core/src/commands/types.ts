import type { z } from 'zod';
import type { CatalogIndex } from '../catalog/validate.ts';
import type { Project } from '../model/schema.ts';
import type { SiteDefaults } from '../site/design-loads.ts';
import type { CommandError } from './errors.ts';

export interface CommandContext {
  catalog: CatalogIndex;
  now: () => number;
  /**
   * The app's site defaults (default location, loads table, fallbacks). Builders size
   * headers and footings from the same resolved loads the solver checks against.
   */
  siteDefaults?: SiteDefaults;
}

/** A command with its input fully resolved (generated IDs filled in, lengths in mm). Serialisable. */
export interface AppliedCommand {
  name: string;
  input: unknown;
}

export interface ApplyResult {
  project: Project;
  /** Commands that undo this one, applied in reverse order. */
  inverse: AppliedCommand[];
  /** The resolved form of this command; re-applying it recreates the same IDs. */
  redo: AppliedCommand;
  /** One plain-language line, e.g. `Added stud W1-S01 (2x4, 2438 mm (8' 0")).` */
  summary: string;
  /** IDs of entities this command created. */
  created: string[];
}

/**
 * A command: typed input → schema validation → semantic checks → apply.
 * `check` and `apply` are pure; `apply` is only called when `check` returns no errors.
 * Internal commands (`exposed: false`) are used for undo and are never offered to Claude.
 */
export interface CommandDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  exposed: boolean;
  schema: S;
  check(project: Project, input: z.output<S>, ctx: CommandContext): CommandError[];
  apply(project: Project, input: z.output<S>, ctx: CommandContext): ApplyResult;
}

export type AnyCommandDef = CommandDef<z.ZodType>;

export function defineCommand<S extends z.ZodType>(def: CommandDef<S>): CommandDef<S> {
  return def;
}
