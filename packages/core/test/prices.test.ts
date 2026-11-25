import { describe, expect, it } from 'vitest';
import { SAMPLE_CATALOG, indexCatalog, validatePriceTable, type PriceTable } from '../src/index.ts';

const TODAY = new Date('2026-11-25T12:00:00Z');

function table(): PriceTable {
  return {
    schemaVersion: 1,
    currency: 'USD',
    researchedOn: '2026-11-25',
    region: 'US national big-box retail',
    note: 'Planning estimates, not quotes.',
    entries: [
      {
        key: 'lumber.spf-no2',
        variant: '2x4',
        unit: 'linear-ft',
        low_usd: 0.4,
        high_usd: 0.6,
        description: 'SPF No.2 2x4, per linear foot',
        source: 'Test data',
      },
      {
        key: 'lumber.spf-no2',
        variant: '2x6',
        unit: 'linear-ft',
        low_usd: 0.6,
        high_usd: 0.9,
        description: 'SPF No.2 2x6, per linear foot',
        source: 'Test data',
      },
      {
        key: 'lumber.pt-spf-no2',
        description: 'Pressure-treated lumber',
        source: 'Test data',
        unpriced: 'not stocked',
      },
    ],
  };
}

const check = (raw: unknown) => validatePriceTable(raw, SAMPLE_CATALOG, { today: TODAY });
const errorsOf = (raw: unknown) => {
  const r = check(raw);
  return r.ok ? [] : r.errors;
};

describe('price table', () => {
  it('a valid table passes, against a catalog or its index', () => {
    expect(check(table())).toEqual({ ok: true, table: table() });
    expect(validatePriceTable(table(), indexCatalog(SAMPLE_CATALOG), { today: TODAY }).ok).toBe(true);
  });

  it('low must not be above high', () => {
    const t = table();
    t.entries[0]!.low_usd = 2;
    expect(errorsOf(t)).toEqual(['"entries[0].low_usd" must not be above "high_usd".']);
  });

  it('a priced entry needs unit, low and high; an unpriced one needs a reason', () => {
    const t = table() as unknown as { entries: Array<Record<string, unknown>> };
    delete t.entries[0]!.unit;
    delete t.entries[2]!.unpriced;
    expect(errorsOf(t)).toEqual([
      '"entries[0].unit" is required, or say why there is no price with "unpriced".',
      '"entries[2].unit" is required, or say why there is no price with "unpriced".',
      '"entries[2].low_usd" is required, or say why there is no price with "unpriced".',
      '"entries[2].high_usd" is required, or say why there is no price with "unpriced".',
    ]);
  });

  it('an unpriced entry has no prices', () => {
    const t = table();
    t.entries[2]!.low_usd = 1;
    expect(errorsOf(t)).toEqual([`"entries[2].unpriced" is set, so the entry can't also have a unit or prices.`]);
  });

  it('every entry needs a source', () => {
    const t = table() as unknown as { entries: Array<Record<string, unknown>> };
    delete t.entries[1]!.source;
    expect(errorsOf(t)).toEqual(['"entries[1].source" is required.']);
    t.entries[1]!.source = '';
    expect(errorsOf(t)).toEqual([`"entries[1].source" can't be blank.`]);
  });

  it('key + variant pairs are unique', () => {
    const t = table();
    t.entries[1]!.variant = '2x4';
    expect(errorsOf(t)).toEqual(['The price table lists "lumber.spf-no2" variant "2x4" twice.']);
  });

  it('a key with several entries needs variants and one unit', () => {
    const t = table();
    delete t.entries[1]!.variant;
    t.entries[1]!.unit = 'each';
    expect(errorsOf(t)).toEqual([
      '"lumber.spf-no2" has several price entries, so each needs a "variant" (e.g. a size).',
      '"lumber.spf-no2" is priced in different units (linear-ft, each); use one unit per key.',
    ]);
  });

  it('every catalog price key needs an entry, and every entry a material', () => {
    const t = table();
    t.entries[2]!.key = 'lumber.cedar';
    expect(errorsOf(t)).toEqual([
      'Material "pt-spf-no2" has price key "lumber.pt-spf-no2", which isn\'t in the price table.',
      'The price table has "lumber.cedar", but no material uses that price key.',
    ]);
  });

  it('researchedOn must be a real date and not in the future', () => {
    expect(errorsOf({ ...table(), researchedOn: '2026-02-30' })).toEqual([`"researchedOn" (2026-02-30) isn't a real date.`]);
    expect(errorsOf({ ...table(), researchedOn: '2026-11-26' })).toEqual(['"researchedOn" (2026-11-26) is in the future.']);
    expect(errorsOf({ ...table(), researchedOn: 'last week' })).toEqual([
      '"researchedOn" should be a date written YYYY-MM-DD.',
    ]);
    const { researchedOn: _d, ...undated } = table();
    expect(errorsOf(undated)).toEqual(['"researchedOn" is required.']);
  });

  it('the currency is USD', () => {
    expect(errorsOf({ ...table(), currency: 'EUR' })[0]).toContain('"currency"');
  });
});
