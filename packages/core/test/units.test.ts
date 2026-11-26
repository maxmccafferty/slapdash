import { describe, expect, it } from 'vitest';
import {
  MM_PER_INCH,
  formatBoth,
  formatFeetInches,
  formatLength,
  formatPitch,
  parseLength,
  parsePitch,
  zLength,
  zPitch,
  zPositiveLength,
  zVec3Input,
  LENGTH_DESCRIPTION,
} from '../src/index.ts';

const mm = (s: string) => {
  const r = parseLength(s);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const err = (s: string) => {
  const r = parseLength(s);
  if (r.ok) throw new Error(`parsed ${s}`);
  return r.error;
};

describe('parseLength', () => {
  it.each([
    ['16ft 6in', 5029.2],
    ["9'", 2743.2],
    ["16'6\"", 5029.2],
    ["16' 6\"", 5029.2],
    ["16'-6\"", 5029.2],
    ['16 ft 6 1/2 in', 5041.9],
    ['5 1/2"', 139.7],
    ['5-1/2in', 139.7],
    ['3.5in', 88.9],
    ['1/2in', 12.7],
    ["0.75'", 228.6],
    ['4877mm', 4877],
    ['4.877 m', 4877],
    ['487.7cm', 4877],
    ['-2ft', -609.6],
    ['16 feet 6 inches', 5029.2],
    ['1 foot', 304.8],
    ['16FT 6IN', 5029.2],
    ['16’ 6”', 5029.2],
    ["5 1/2''", 139.7],
    ["16' 6", 5029.2],
    ['.5in', 12.7],
  ])('%s → %f mm', (input, expected) => {
    expect(mm(input)).toBeCloseTo(expected, 6);
  });

  it('rejects a bare number and asks for a unit', () => {
    expect(err('16')).toBe('"16" has no unit. Add a unit, e.g. 16ft, 16in or 16mm.');
  });

  it('rejects misspelt units in plain language', () => {
    expect(err('16 fet')).toBe(`Couldn't read "16 fet" as a length. Try 16ft 6in, 9', 5 1/2in or 4877mm.`);
  });

  describe('quote marks Claude copies from examples', () => {
    it.each([
      ['"9ft"', 2743.2],
      ['  "9ft"  ', 2743.2],
      ['“16ft 6in”', 5029.2],
      ['"16\' 6"', 5029.2],
      ['"0"', 0],
      ['“-0”', 0],
    ])('%j → %f mm', (input, expected) => {
      expect(mm(input)).toBeCloseTo(expected, 6);
    });

    it.each([
      ['5 1/2"', 139.7],
      ["16' 6\"", 5029.2],
      ["9'", 2743.2],
      ['36"', 914.4],
    ])('a real inch or foot mark is kept: %j → %f mm', (input, expected) => {
      expect(mm(input)).toBeCloseTo(expected, 6);
    });

    it('a quoted bare number is still rejected for having no unit', () => {
      expect(err('"9"')).toBe('"9" has no unit. Add a unit, e.g. 9ft, 9in or 9mm.');
      expect(err('“12”')).toBe('"12" has no unit. Add a unit, e.g. 12ft, 12in or 12mm.');
    });

    it('a quote on one side only is not unwrapped', () => {
      expect(err('"9ft')).toContain("Couldn't read");
      expect(err('“9ft"')).toContain("Couldn't read");
    });
  });

  describe('unitless zero', () => {
    it.each(['0', '0.0', '-0', '+0', '.0', '00', ' 0 '])('%j → 0 mm', (input) => {
      expect(Object.is(mm(input), 0)).toBe(true);
    });

    it.each(['12', '0.5', '-1', '01'])('%j is still rejected for having no unit', (input) => {
      expect(err(input)).toContain('has no unit');
    });
  });

  it.each([
    ['', 'Enter a length'],
    ['ft', "Couldn't read"],
    ['1/0in', 'divides by zero'],
    ['6in 2ft', "Couldn't read"],
    ['2m 3in', "Couldn't read"],
    ['1ft 2in 3in', "Couldn't read"],
    ['abc', "Couldn't read"],
  ])('rejects %j', (input, message) => {
    expect(err(input)).toContain(message);
  });
});

describe('formatFeetInches', () => {
  it.each([
    [5029.2, `16' 6"`],
    [139.7, `0' 5 1/2"`],
    [88.9, `0' 3 1/2"`],
    [12.7, `0' 1/2"`],
    [5041.9, `16' 6 1/2"`],
    [0, `0' 0"`],
    [-609.6, `-2' 0"`],
    [-0.1, `0' 0"`],
    [304.8 * 2 - 0.5, `2' 0"`], // rounds up into the next foot
    [25.4 * 11.99, `1' 0"`], // 11.99" carries 12" into a foot
    [3.175, `0' 1/8"`],
  ])('%f mm → %s', (value, expected) => {
    expect(formatFeetInches(value)).toBe(expected);
  });

  it('respects precision', () => {
    expect(formatFeetInches(25.4 * 1.3, { precision: 4 })).toBe(`0' 1 1/4"`);
  });

  it('formats metric and both', () => {
    expect(formatLength(4877.2, 'metric')).toBe('4877 mm');
    expect(formatLength(12.74, 'metric', { decimals: 1 })).toBe('12.7 mm');
    expect(formatLength(5029.2)).toBe(`16' 6"`);
    expect(formatBoth(2438.4)).toBe(`2438 mm (8' 0")`);
  });
});

describe('round trips', () => {
  it('parse(format(mm)) is within 1/32" for a sweep of values', () => {
    for (let v = -3000; v <= 20000; v += 7.37) {
      const back = mm(formatFeetInches(v));
      expect(Math.abs(back - v)).toBeLessThanOrEqual(MM_PER_INCH / 32 + 1e-9);
    }
  });

  it.each([`16' 6"`, `0' 5 1/2"`, `8' 0"`, `-2' 0"`, `0' 1/16"`, `12' 11 15/16"`, `3' 7 3/4"`])(
    'format(parse(%s)) is unchanged',
    (s) => {
      expect(formatFeetInches(mm(s))).toBe(s);
    },
  );
});

describe('parsePitch / formatPitch', () => {
  const pitch = (s: string) => {
    const r = parsePitch(s);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

  it.each(['6 in 12', '6/12', '6:12', '6 IN 12', '3/6', '"6 in 12"', '“6/12”'])('%s is a 6-in-12 pitch', (s) => {
    const p = pitch(s);
    expect(p.rise).toBeCloseTo(6);
    expect(p.run).toBe(12);
    expect(p.ratio).toBeCloseTo(0.5);
    expect(p.degrees).toBeCloseTo(26.565, 3);
  });

  it('reads degrees', () => {
    expect(pitch('26.57deg').rise).toBeCloseTo(6, 2);
    expect(pitch('45°').rise).toBeCloseTo(12);
    expect(pitch('30 degrees').degrees).toBe(30);
  });

  it('rejects nonsense in plain language', () => {
    const r = (s: string) => {
      const res = parsePitch(s);
      return res.ok ? '' : res.error;
    };
    expect(r('steep')).toContain(`Couldn't read "steep" as a roof pitch`);
    expect(r('"6"')).toBe('"6" is ambiguous. Write it as 6 in 12 or 6deg.');
    expect(r('6/0')).toContain('run of zero');
    expect(r('95deg')).toContain('less than 90 degrees');
    expect(r('6')).toContain('ambiguous');
  });

  it('a unitless zero is a flat roof', () => {
    for (const s of ['0', '0.0', '"0"']) expect(pitch(s).ratio).toBe(0);
  });

  it('formats to the nearest quarter rise, or degrees', () => {
    expect(formatPitch(pitch('6/12'))).toBe('6 in 12');
    expect(formatPitch(pitch('6.25/12'))).toBe('6.25 in 12');
    expect(formatPitch(pitch('26.57deg'))).toBe('6 in 12');
    expect(formatPitch(pitch('35deg'))).toBe('35°');
  });

  it('round-trips', () => {
    for (const s of ['4 in 12', '6 in 12', '9.5 in 12', '12 in 12', '35°']) {
      expect(formatPitch(pitch(s))).toBe(s);
    }
  });
});

describe('zod helpers', () => {
  it('zLength accepts mm numbers and unit strings', () => {
    expect(zLength.parse(2438)).toBe(2438);
    expect(zLength.parse('8ft')).toBeCloseTo(2438.4);
    expect(zLength.safeParse('8').success).toBe(false);
    expect(zLength.safeParse(true).success).toBe(false);
  });

  it('zLength reads what Claude actually sends: wrapped quotes and a bare zero', () => {
    // The JSON value "\"9ft\"" arrives as the string "9ft" with its quotes.
    expect(zLength.parse(JSON.parse('"\\"9ft\\""'))).toBeCloseTo(2743.2);
    expect(zLength.parse('0')).toBe(0);
    expect(zVec3Input.parse({ x: '0', y: '"0"', z: '“16ft 6in”' })).toEqual({ x: 0, y: 0, z: expect.closeTo(5029.2, 6) });
  });

  it('descriptions Claude reads never wrap example values in quote marks', () => {
    for (const schema of [zLength, zPositiveLength, zPitch]) {
      expect(schema.description).not.toMatch(/"/);
    }
    expect(LENGTH_DESCRIPTION).toContain('without extra quote marks');
  });

  it('zPositiveLength rejects zero and negatives with the value in both systems', () => {
    const r = zPositiveLength.safeParse('-2ft');
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe(`must be more than zero (you gave -610 mm (-2' 0"))`);
    expect(zPositiveLength.safeParse(0).success).toBe(false);
  });

  it('zPitch accepts text and rise-per-12 numbers', () => {
    expect(zPitch.parse('6/12').ratio).toBeCloseTo(0.5);
    expect(zPitch.parse(4).ratio).toBeCloseTo(1 / 3);
  });
});
