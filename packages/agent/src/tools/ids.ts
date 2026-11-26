/**
 * ID inputs for the agent tools. Claude sometimes wraps an id in quote marks inside the
 * string (the JSON value `"\"R1\""`), so ids are trimmed and one matching pair of `"…"` or
 * `“…”` is stripped before lookup.
 *
 * TODO: switch to core's `zId` once LOC-100 (3126f51) syncs in. There it is a schema used as
 * `zId.describe('…')`, not a factory, so call sites change shape;
 * zIdList becomes `z.array(zId)`.
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
