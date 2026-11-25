/** Helpers shared by the command definitions. */
import { z } from 'zod';
import { formatBoth } from '../units/length.ts';
import { commandError, type CommandError } from './errors.ts';
import type { Project } from '../model/schema.ts';

export const zId = (what: string) => z.string().min(1).describe(what);

export const zNonBlank = (what: string) =>
  z
    .string()
    .trim()
    .min(1, { error: 'can\'t be blank' })
    .describe(what);

export const zIdList = (what: string) => z.array(z.string().min(1)).min(1).describe(what);

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

export function quoteList(ids: readonly string[]): string {
  return ids.map((id) => `"${id}"`).join(', ');
}

/** Lowest point a part may reach: 20 ft below ground is surely a typo. */
export const MIN_Y_MM = -6000;

export function checkElevation(y: number, path: string, what: string): CommandError | null {
  if (y < MIN_Y_MM) {
    return commandError(
      'invalid_input',
      `${what} would be at ${formatBoth(y)}, deeper than 20 ft below ground. Check the sign of y (y is up).`,
      { path },
    );
  }
  return null;
}

export function exists(record: Record<string, unknown>, id: string): boolean {
  return Object.hasOwn(record, id);
}

/** Validate an explicitly supplied ID: right pattern and not already in use. */
export function checkExplicitId(
  project: Project,
  table: 'assemblies' | 'parts' | 'joints',
  id: string,
  pattern: RegExp,
  example: string,
): CommandError | null {
  if (!pattern.test(id)) {
    return commandError('invalid_input', `"${id}" isn't a valid ID here; IDs look like ${example}.`, { path: 'id' });
  }
  if (exists(project[table], id)) {
    return commandError('conflict', `The ID "${id}" is already in use.`, {
      path: 'id',
      hint: 'Leave "id" out and one will be chosen.',
    });
  }
  return null;
}
