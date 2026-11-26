/**
 * ID inputs for the agent tools. Claude sometimes wraps an id in quote marks inside the
 * string (the JSON value `"\"R1\""`), so ids are trimmed and one matching pair of `"…"` or
 * `“…”` is stripped before lookup.
 *
 * TODO: switch to `zId` from `@slapdash/core` once LOC-100's version (same behaviour)
 * reaches this branch.
 */
import { unwrapQuotes } from '@slapdash/core';
import { z } from 'zod';

/** Trim, then strip one matching pair of wrapping quote marks. */
export function cleanId(input: string): string {
  return unwrapQuotes(input) ?? input.trim();
}

/** A required id string. */
export const zId = (what: string) => z.string().min(1).transform(cleanId).pipe(z.string().min(1)).describe(what);

/** A list of id strings. */
export const zIdList = (what: string) => z.array(z.string().min(1).transform(cleanId).pipe(z.string().min(1))).describe(what);
