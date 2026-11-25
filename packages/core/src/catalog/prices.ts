/**
 * The price table (ADR-0001 §11): one dated table of low–high US retail prices,
 * researched once, with no live lookup. Catalog materials point into it with
 * `priceKey`; the table carries one `researchedOn` date that is shown with every cost.
 * Real data lives in `packages/catalog`; this file only defines its shape and checks.
 */
import { z } from 'zod';
import { kebabId, type Catalog } from './schema.ts';
import { isCatalogIndex, type CatalogIndex } from './validate.ts';
import { zodIssuesToErrors } from '../commands/errors.ts';

export const PRICE_TABLE_SCHEMA_VERSION = 1;

/** How an entry is priced. Matched to how parts are measured, so a materials list can multiply. */
export const PRICE_UNITS = ['each', 'linear-ft', 'sq-ft', 'sheet', 'cu-yd', 'lb'] as const;
export const zPriceUnit = z.enum(PRICE_UNITS);
export type PriceUnit = z.infer<typeof zPriceUnit>;

const usd = z.number().positive();

/**
 * One priced item, or one that says why it has no price (`unpriced`). Priced entries
 * have `unit`, `low_usd` and `high_usd`; unpriced ones have none of them.
 */
export const zPriceEntry = z
  .strictObject({
    /** Matches a catalog `priceKey`, e.g. "lumber.spf-no2". */
    key: kebabId,
    /**
     * Which size, when one key has several prices: a section id ("2x6") for sectioned
     * parts, a nominal thickness ("23/32in") for sheet goods, a size for hardware ("2x8").
     */
    variant: z.string().min(1).optional(),
    /** What was priced, e.g. "SPF No.2 2x6, 8–16ft boards, per linear foot". */
    description: z.string().min(1),
    /** Where the numbers came from. Required on every entry. */
    source: z.string().min(1),
    unit: zPriceUnit.optional(),
    low_usd: usd.optional(),
    high_usd: usd.optional(),
    /** Why this entry has no price, e.g. "pick a specific window or door". */
    unpriced: z.string().min(1).optional(),
  })
  .superRefine((e, ctx) => {
    const priced = e.unit !== undefined || e.low_usd !== undefined || e.high_usd !== undefined;
    if (e.unpriced !== undefined) {
      if (priced) {
        ctx.addIssue({
          code: 'custom',
          path: ['unpriced'],
          message: "is set, so the entry can't also have a unit or prices",
        });
      }
      return;
    }
    for (const field of ['unit', 'low_usd', 'high_usd'] as const) {
      if (e[field] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'is required, or say why there is no price with "unpriced"',
        });
      }
    }
    if (e.low_usd !== undefined && e.high_usd !== undefined && e.low_usd > e.high_usd) {
      ctx.addIssue({ code: 'custom', path: ['low_usd'], message: 'must not be above "high_usd"' });
    }
  });
export type PriceEntry = z.infer<typeof zPriceEntry>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'should be a date written YYYY-MM-DD');

export const zPriceTable = z.strictObject({
  schemaVersion: z.literal(PRICE_TABLE_SCHEMA_VERSION),
  currency: z.literal('USD'),
  /** The day the prices were researched (YYYY-MM-DD). Shown with every cost. */
  researchedOn: isoDate,
  /** Where the prices apply, e.g. "US national big-box retail". */
  region: z.string().min(1),
  /** Caveat shown with costs, e.g. "Planning estimates, not quotes." */
  note: z.string().min(1),
  entries: z.array(zPriceEntry),
});
export type PriceTable = z.infer<typeof zPriceTable>;

export type PriceTableResult = { ok: true; table: PriceTable } | { ok: false; errors: string[] };

function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Validate a raw price table against a catalog: check its shape, that `researchedOn`
 * is a real date and not in the future, that key + variant pairs are unique, that a
 * key with several entries gives each a variant and one unit, that every catalog
 * `priceKey` has an entry and that every entry is used by some material. Errors are
 * plain sentences.
 */
export function validatePriceTable(
  raw: unknown,
  catalog: Catalog | CatalogIndex,
  opts: { today?: Date } = {},
): PriceTableResult {
  const parsed = zPriceTable.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: zodIssuesToErrors(parsed.error.issues, raw).map((e) => e.message) };
  }
  const table = parsed.data;
  const errors: string[] = [];

  if (!isRealDate(table.researchedOn)) {
    errors.push(`"researchedOn" (${table.researchedOn}) isn't a real date.`);
  } else {
    const today = (opts.today ?? new Date()).toISOString().slice(0, 10);
    if (table.researchedOn > today) errors.push(`"researchedOn" (${table.researchedOn}) is in the future.`);
  }

  const byKey = new Map<string, PriceEntry[]>();
  for (const e of table.entries) {
    const list = byKey.get(e.key) ?? [];
    list.push(e);
    byKey.set(e.key, list);
  }
  for (const [key, list] of byKey) {
    const seen = new Set<string>();
    for (const e of list) {
      const v = e.variant ?? '';
      if (seen.has(v)) {
        errors.push(
          e.variant === undefined
            ? `The price table lists "${key}" twice; give each entry a different "variant".`
            : `The price table lists "${key}" variant "${e.variant}" twice.`,
        );
      }
      seen.add(v);
    }
    if (list.length > 1) {
      if (list.some((e) => e.variant === undefined)) {
        errors.push(`"${key}" has several price entries, so each needs a "variant" (e.g. a size).`);
      }
      const units = new Set(list.flatMap((e) => (e.unit === undefined ? [] : [e.unit])));
      if (units.size > 1) {
        errors.push(`"${key}" is priced in different units (${[...units].join(', ')}); use one unit per key.`);
      }
    }
  }

  const materials = isCatalogIndex(catalog) ? [...catalog.materials.values()] : catalog.materials;
  const used = new Set<string>();
  for (const m of materials) {
    if (m.priceKey === undefined) continue;
    used.add(m.priceKey);
    if (!byKey.has(m.priceKey)) {
      errors.push(`Material "${m.id}" has price key "${m.priceKey}", which isn't in the price table.`);
    }
  }
  for (const key of byKey.keys()) {
    if (!used.has(key)) errors.push(`The price table has "${key}", but no material uses that price key.`);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, table };
}

