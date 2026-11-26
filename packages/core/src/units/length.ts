/**
 * Lengths. The model stores every length as a number of millimetres (ADR-0002 §A9).
 * People and Claude speak in feet and inches, so tools accept text like "16ft 6in"
 * and this module turns it into millimetres. Claude never does unit arithmetic.
 */

export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = MM_PER_INCH * 12;

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export type UnitSystem = 'imperial' | 'metric';

const EXAMPLES = `Try 16ft 6in, 9', 5 1/2in or 4877mm.`;

type Unit = 'ft' | 'in' | 'mm' | 'cm' | 'm';

const UNIT_WORDS: ReadonlyArray<readonly [string, Unit]> = [
  ['inches', 'in'],
  ['inch', 'in'],
  ['in', 'in'],
  ['"', 'in'],
  ['feet', 'ft'],
  ['foot', 'ft'],
  ['ft', 'ft'],
  ["'", 'ft'],
  ['mm', 'mm'],
  ['millimetres', 'mm'],
  ['millimeters', 'mm'],
  ['cm', 'cm'],
  ['centimetres', 'cm'],
  ['centimeters', 'cm'],
  ['metres', 'm'],
  ['meters', 'm'],
  ['m', 'm'],
];

const MM_PER_UNIT: Record<Unit, number> = {
  ft: MM_PER_FOOT,
  in: MM_PER_INCH,
  mm: 1,
  cm: 10,
  m: 1000,
};

// "6 1/2" or "6-1/2" (whole + fraction), "1/2", "3.5", ".5"
const MIXED = /^(\d+)(?:\s+|-)(\d+)\/(\d+)/;
const FRACTION = /^(\d+)\/(\d+)/;
const DECIMAL = /^(\d+(?:\.\d*)?|\.\d+)/;

function normalise(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[’′]/g, "'") // ’ ′
    .replace(/[“”″]/g, '"') // “ ” ″
    .replace(/''/g, '"')
    .replace(/\s+/g, ' ');
}

function readNumber(s: string): { value: number; rest: string } | { error: 'zero-denominator' } | null {
  let m = MIXED.exec(s);
  if (m) {
    const den = Number(m[3]);
    if (den === 0) return { error: 'zero-denominator' };
    return { value: Number(m[1]) + Number(m[2]) / den, rest: s.slice(m[0].length) };
  }
  m = FRACTION.exec(s);
  if (m) {
    const den = Number(m[2]);
    if (den === 0) return { error: 'zero-denominator' };
    return { value: Number(m[1]) / den, rest: s.slice(m[0].length) };
  }
  m = DECIMAL.exec(s);
  if (m) return { value: Number(m[1]), rest: s.slice(m[0].length) };
  return null;
}

function readUnit(s: string): { unit: Unit; rest: string } | null {
  for (const [word, unit] of UNIT_WORDS) {
    if (!s.startsWith(word)) continue;
    const rest = s.slice(word.length);
    // Words must end at a boundary ("in" must not match "inx"); quote marks always do.
    if (/^[a-z]/.test(word) && /^[a-z]/.test(rest)) continue;
    return { unit, rest };
  }
  return null;
}

/**
 * If `input` (trimmed) is wrapped in a matching pair of quote marks (`"…"` or `“…”`),
 * return what is inside, trimmed; otherwise null. Claude sometimes sends the JSON
 * string `"\"9ft\""`. Callers must try the inner text first and fall back to the
 * original, because a lone trailing `"` is a real inch mark (`5 1/2"`).
 */
export function unwrapQuotes(input: string): string | null {
  const s = input.trim();
  if (s.length < 2) return null;
  const first = s[0];
  const last = s[s.length - 1];
  if ((first === '"' && last === '"') || (first === '“' && last === '”')) {
    return s.slice(1, -1).trim();
  }
  return null;
}

/** True for a unitless zero like `0`, `0.0`, `-0` or `+.0`. Zero is the same in every unit. */
export function isUnitlessZero(input: string): boolean {
  return /^[-+]?(?:0+(?:\.0*)?|\.0+)$/.test(input.trim());
}

/**
 * Parse a length written by a person into millimetres.
 *
 * Accepts feet/inches in most common spellings (`16ft 6in`, `16' 6"`, `16'-6"`,
 * `16 ft 6 1/2 in`, `5 1/2"`, `0.75'`), and metric (`4877mm`, `487.7 cm`, `4.877 m`).
 * A bare number is rejected because it is ambiguous, except zero; JSON numbers are
 * already mm. Text wrapped in quote marks (`"9ft"`, `“16ft 6in”`) is read without them.
 * Negative values parse; schemas decide whether a sign is allowed.
 */
export function parseLength(input: string): Result<number> {
  const inner = unwrapQuotes(input);
  if (inner === null) return parseBareLength(input);
  const unwrapped = parseBareLength(inner);
  if (unwrapped.ok) return unwrapped;
  const whole = parseBareLength(input);
  // Neither reading works: the inner error ("has no unit") is the more useful one.
  return whole.ok ? whole : unwrapped;
}

function parseBareLength(input: string): Result<number> {
  if (isUnitlessZero(input)) return { ok: true, value: 0 };
  const original = input.trim();
  if (original === '') {
    return { ok: false, error: `Enter a length. ${EXAMPLES}` };
  }
  const cantRead: Result<number> = {
    ok: false,
    error: `Couldn't read "${original}" as a length. ${EXAMPLES}`,
  };

  let s = normalise(input);
  let sign = 1;
  if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1).trimStart();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trimStart();
  }

  const segments: Array<{ value: number; unit: Unit | null }> = [];
  while (s.length > 0) {
    if (segments.length > 0) {
      // Separator between feet and inches: space, hyphen or comma ("16'-6"", "16', 6"").
      s = s.replace(/^\s*[-,]?\s*/, '');
      if (s.length === 0) break;
    }
    const num = readNumber(s);
    if (num === null) return cantRead;
    if ('error' in num) {
      return { ok: false, error: `"${original}" divides by zero. ${EXAMPLES}` };
    }
    s = num.rest.trimStart();
    const unit = readUnit(s);
    if (unit) s = unit.rest.trimStart();
    segments.push({ value: num.value, unit: unit ? unit.unit : null });
  }

  if (segments.length === 0) return cantRead;

  const [first, second, ...extra] = segments;
  if (!first || extra.length > 0) return cantRead;

  if (first.unit === null) {
    if (segments.length === 1) {
      const n = original.replace(/^[-+]/, '');
      return {
        ok: false,
        error: `"${original}" has no unit. Add a unit, e.g. ${n}ft, ${n}in or ${n}mm.`,
      };
    }
    return cantRead;
  }

  let mm = first.value * MM_PER_UNIT[first.unit];
  if (second) {
    // Only feet followed by inches may be combined; a bare trailing number means inches.
    if (first.unit !== 'ft') return cantRead;
    if (second.unit !== null && second.unit !== 'in') return cantRead;
    mm += second.value * MM_PER_INCH;
  }
  if (!Number.isFinite(mm)) return cantRead;
  return { ok: true, value: sign * mm };
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

export interface FeetInchesOptions {
  /** Round to the nearest 1/precision inch. Default 16. */
  precision?: number;
}

/**
 * Format millimetres as feet and inches, e.g. `16' 6"`, `16' 6 1/2"`, `0' 1/2"`, `-2' 0"`.
 * Rounds to the nearest 1/precision inch and reduces the fraction.
 */
export function formatFeetInches(mm: number, opts: FeetInchesOptions = {}): string {
  const precision = opts.precision ?? 16;
  const units = Math.round((Math.abs(mm) / MM_PER_INCH) * precision);
  const perFoot = 12 * precision;
  const feet = Math.floor(units / perFoot);
  const rem = units - feet * perFoot;
  const whole = Math.floor(rem / precision);
  const frac = rem - whole * precision;
  const sign = mm < 0 && units > 0 ? '-' : '';

  let inches: string;
  if (frac === 0) {
    inches = `${whole}"`;
  } else {
    const g = gcd(frac, precision);
    const fraction = `${frac / g}/${precision / g}`;
    inches = whole === 0 ? `${fraction}"` : `${whole} ${fraction}"`;
  }
  return `${sign}${feet}' ${inches}`;
}

export interface FormatLengthOptions extends FeetInchesOptions {
  /** Decimal places for metric output. Default 0. */
  decimals?: number;
}

/** Format millimetres for display: `16' 6"` (imperial) or `5029 mm` (metric). */
export function formatLength(
  mm: number,
  system: UnitSystem = 'imperial',
  opts: FormatLengthOptions = {},
): string {
  if (system === 'metric') {
    const decimals = opts.decimals ?? 0;
    const rounded = Number(mm.toFixed(decimals));
    return `${Object.is(rounded, -0) ? 0 : rounded} mm`;
  }
  return formatFeetInches(mm, opts);
}

/** Both systems at once, for error messages: `2438 mm (8' 0")`. */
export function formatBoth(mm: number): string {
  return `${formatLength(mm, 'metric')} (${formatFeetInches(mm)})`;
}
