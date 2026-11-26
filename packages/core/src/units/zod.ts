/**
 * Zod helpers for unit-bearing inputs. Lengths accept a JSON number (millimetres)
 * or text with a unit; both come out as millimetres. Generate JSON Schema with
 * `io: 'input'` so the transforms are representable.
 */
import { z } from 'zod';
import { formatBoth, parseLength } from './length.ts';
import { parsePitch, pitchFromRatio, type Pitch } from './pitch.ts';

export const LENGTH_DESCRIPTION =
  "Length: a number in millimetres, or a string with a unit, e.g. 16ft 6in, 9', 5 1/2in or 4877mm. Write the value itself without extra quote marks.";

const lengthInput = z.union([z.number(), z.string()], {
  error: 'should be a length: a number in millimetres or a string with a unit, e.g. 8ft 6in',
});

/** Any length (may be zero or negative), as millimetres. */
export const zLength = lengthInput
  .transform((value, ctx): number => {
    if (typeof value === 'number') return value;
    const parsed = parseLength(value);
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.error, input: value });
      return z.NEVER;
    }
    return parsed.value;
  })
  .describe(LENGTH_DESCRIPTION);

/** A length that must be more than zero, as millimetres. */
export const zPositiveLength = zLength
  .superRefine((mm, ctx) => {
    if (!(mm > 0)) {
      ctx.addIssue({
        code: 'custom',
        message: `must be more than zero (you gave ${formatBoth(mm)})`,
        input: mm,
      });
    }
  })
  .describe(`${LENGTH_DESCRIPTION} Must be more than zero.`);

/** A roof pitch: text like `6 in 12` / `6/12` / `26.57deg`, or a number meaning rise per 12. */
export const zPitch = z
  .union([z.number(), z.string()], {
    error: 'should be a roof pitch, e.g. 6 in 12 or 26.57deg',
  })
  .transform((value, ctx): Pitch => {
    if (typeof value === 'number') return pitchFromRatio(value / 12);
    const parsed = parsePitch(value);
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.error, input: value });
      return z.NEVER;
    }
    return parsed.value;
  })
  .describe(
    'Roof pitch: a string, e.g. 6 in 12, 6/12 or 26.57deg, or a number meaning inches of rise per 12 of run. Write the value itself without extra quote marks.',
  );

/** A point in project space (mm, y-up). Each coordinate accepts a number (mm) or text with a unit. */
export const zVec3Input = z
  .strictObject({
    x: zLength.describe(`East-west (+x is east). ${LENGTH_DESCRIPTION}`),
    y: zLength.describe(`Height above ground (+y is up). ${LENGTH_DESCRIPTION}`),
    z: zLength.describe(`North-south (+z is south). ${LENGTH_DESCRIPTION}`),
  })
  .describe('A point in millimetres from the ground origin corner; y is up.');
