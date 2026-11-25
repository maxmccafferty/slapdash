import { describe, expect, it } from 'vitest';
import {
  HEADER_TABLE,
  anchorBoltCount,
  kingStudsFor,
  largestHeader,
  pickHeader,
  sheathingNailCount,
} from '../../src/builders/rules.ts';
import { MM_PER_FOOT, MM_PER_INCH } from '../../src/units/length.ts';

const IN = MM_PER_INCH;
const FT = MM_PER_FOOT;

describe('IRC 2021 Table R602.7(1), roof and ceiling rows', () => {
  it('transcribes spot values (span / NJ)', () => {
    const row = (snow: 30 | 50 | 70, plies: number, sec: string) => HEADER_TABLE[snow].find((r) => r.plies === plies && r.sectionId === sec)!;
    expect(row(30, 2, '2x8').spans[0]).toBeCloseTo(7 * FT + 7 * IN); // 7-7, 12ft width
    expect(row(30, 2, '2x8').jacks).toEqual([1, 1, 2]);
    expect(row(30, 3, '2x12').spans[2]).toBeCloseTo(8 * FT + 6 * IN); // 8-6, 36ft width
    expect(row(50, 2, '2x10').spans[1]).toBeCloseTo(5 * FT + 11 * IN);
    expect(row(70, 4, '2x12').spans[0]).toBeCloseTo(11 * FT + 7 * IN);
    expect(row(70, 1, '2x8').jacks[2]).toBe(3);
    for (const snow of [30, 50, 70] as const) expect(HEADER_TABLE[snow]).toHaveLength(15);
  });

  it('picks the shallowest header (then fewest plies) that spans the opening', () => {
    // 6ft sliding door, 30 psf, 16ft building (24ft column), 2x4 wall (2 plies max).
    expect(pickHeader({ spanMm: 72 * IN, snowPsf: 30, buildingWidthFt: 16, maxPlies: 2 })).toMatchObject({
      plies: 2,
      sectionId: '2x10',
      jacks: 2,
      buildingWidthFt: 24,
      snowPsf: 30,
    });
    // A 3ft window: 2-2x4 spans 3' 1" at 24ft.
    expect(pickHeader({ spanMm: 36 * IN, snowPsf: 30, buildingWidthFt: 24, maxPlies: 2 })).toMatchObject({ plies: 2, sectionId: '2x4', jacks: 1 });
    // At 12ft width a 6ft opening fits a 2-2x6 (6' 0").
    expect(pickHeader({ spanMm: 72 * IN, snowPsf: 30, buildingWidthFt: 12 })).toMatchObject({ plies: 2, sectionId: '2x6' });
    // Snow under 30 uses the 30 psf rows; 40 psf uses 50.
    expect(pickHeader({ spanMm: 72 * IN, snowPsf: 40, buildingWidthFt: 12 })).toMatchObject({ snowPsf: 50 });
  });

  it('returns null past the table', () => {
    expect(pickHeader({ spanMm: 14 * FT, snowPsf: 30, buildingWidthFt: 36 })).toBeNull();
    expect(pickHeader({ spanMm: 3 * FT, snowPsf: 80, buildingWidthFt: 24 })).toBeNull();
    expect(pickHeader({ spanMm: 3 * FT, snowPsf: 30, buildingWidthFt: 40 })).toBeNull();
    expect(largestHeader({ snowPsf: 30, buildingWidthFt: 36, maxPlies: 2 })).toMatchObject({ plies: 2, sectionId: '2x12' });
  });
});

describe('other rules', () => {
  it('king studs per IRC Table R602.7.5', () => {
    expect(kingStudsFor(3 * FT)).toBe(1);
    expect(kingStudsFor(6 * FT)).toBe(2);
    expect(kingStudsFor(9 * FT)).toBe(3);
    expect(kingStudsFor(16 * FT)).toBe(4);
    expect(kingStudsFor(19 * FT)).toBeNull();
  });

  it('anchor bolts per IRC R403.1.6: 12in from the ends, 6ft apart, at least 2', () => {
    expect(anchorBoltCount(1 * FT)).toBe(2);
    expect(anchorBoltCount(8 * FT)).toBe(2);
    expect(anchorBoltCount(20 * FT)).toBe(4);
  });

  it('sheathing nails: 6in on edges, 12in in the field', () => {
    expect(sheathingNailCount(96 * IN, true)).toBe(16);
    expect(sheathingNailCount(96 * IN, false)).toBe(8);
  });
});
