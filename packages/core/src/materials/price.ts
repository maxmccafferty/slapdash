/**
 * Prices for the materials list (ADR-0001 §11): one dated low–high table, overridden per
 * project by the person's own prices. No live lookup. Every price comes back in the unit
 * the row is measured in, or with the reason there is none.
 */
import { BUILDER_DEFAULTS } from '../builders/defaults.ts';
import type { PriceEntry, PriceTable, PriceUnit } from '../catalog/prices.ts';
import type { Material } from '../catalog/schema.ts';
import { userPriceKey, type Project, type UserPrice } from '../model/schema.ts';
import { MM_PER_FOOT, MM_PER_INCH } from '../units/length.ts';

/** A 4×8 sheet in ft², for converting a per-ft² price to a per-sheet one. */
export const SHEET_FT2 = (BUILDER_DEFAULTS.sheet.long * BUILDER_DEFAULTS.sheet.short) / (MM_PER_FOOT * MM_PER_FOOT);

export type ResolvedPrice =
  | { ok: true; low_usd: number; high_usd: number; unit: PriceUnit; user: boolean }
  | { ok: false; reason: string };

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

/** A sheet thickness as the price table writes it, to the nearest 1/32in: "7/16in", "23/32in", "1in". */
export function sheetVariant(thickness_mm: number): string {
  const n = Math.round((thickness_mm / MM_PER_INCH) * 32);
  const whole = Math.floor(n / 32);
  const frac = n - whole * 32;
  if (frac === 0) return `${whole}in`;
  const g = gcd(frac, 32);
  const f = `${frac / g}/${32 / g}`;
  return whole === 0 ? `${f}in` : `${whole} ${f}in`;
}

/** The units a person may price a material in, by its category. Site context has none. */
export function priceUnitsFor(material: Material): PriceUnit[] {
  switch (material.category) {
    case 'lumber':
    case 'engineered-wood':
    case 'steel':
      return ['linear-ft', 'each'];
    case 'sheet':
      return ['sheet', 'sq-ft'];
    case 'concrete':
      return ['cu-yd'];
    case 'masonry':
    case 'fastener':
    case 'opening':
      return ['each'];
    case 'site':
      return [];
    default:
      return ['sq-ft', 'linear-ft', 'each'];
  }
}

/** Whether a price key has several sized entries (so a row's variant picks one). */
export function hasVariants(table: PriceTable, key: string): boolean {
  return table.entries.some((e) => e.key === key && e.variant !== undefined);
}

/** The unit the table prices a key in, if it has a priced entry. */
export function tableUnit(table: PriceTable, key: string | undefined): PriceUnit | undefined {
  if (key === undefined) return undefined;
  return table.entries.find((e) => e.key === key && e.unit !== undefined)?.unit;
}

/** The person's price for a material and size: the sized one first, then the one for every size. */
export function userPriceFor(project: Project, materialId: string, variant?: string): UserPrice | undefined {
  const prices = project.prices;
  if (!prices) return undefined;
  if (variant !== undefined) {
    const sized = prices[userPriceKey(materialId, variant)];
    if (sized) return sized;
  }
  return prices[userPriceKey(materialId)];
}

const UNIT_WORDS: Record<PriceUnit, string> = {
  each: 'each',
  'linear-ft': 'linear foot',
  'sq-ft': 'square foot',
  sheet: 'sheet',
  'cu-yd': 'cubic yard',
  lb: 'pound',
};

export function unitWord(unit: PriceUnit): string {
  return UNIT_WORDS[unit];
}

/** Factor that turns a price per `from` into a price per `to`, or null when they don't convert. */
function conversion(from: PriceUnit, to: PriceUnit, length_mm?: number): number | null {
  if (from === to) return 1;
  if (from === 'each' && to === 'linear-ft' && length_mm !== undefined) return MM_PER_FOOT / length_mm;
  if (from === 'sq-ft' && to === 'sheet') return SHEET_FT2;
  if (from === 'sheet' && to === 'sq-ft') return 1 / SHEET_FT2;
  return null;
}

function fromUser(p: UserPrice, unit: PriceUnit): ResolvedPrice {
  const k = conversion(p.per, unit, p.length_mm);
  if (k === null) return { ok: false, reason: `your price is per ${unitWord(p.per)}, but this is counted per ${unitWord(unit)}` };
  const usd = p.usd * k;
  return { ok: true, low_usd: usd, high_usd: usd, unit, user: true };
}

function fromEntry(e: PriceEntry, unit: PriceUnit): ResolvedPrice {
  if (e.unpriced !== undefined) return { ok: false, reason: e.unpriced };
  const k = conversion(e.unit!, unit);
  if (k === null) return { ok: false, reason: `the price table prices it per ${unitWord(e.unit!)}, not per ${unitWord(unit)}` };
  return { ok: true, low_usd: e.low_usd! * k, high_usd: e.high_usd! * k, unit, user: false };
}

/**
 * The price of one `unit` of a material in one size. The person's price wins over the
 * table (low = high). A table key with no variants ignores `variant`.
 */
export function resolvePrice(
  material: Material,
  variant: string | undefined,
  unit: PriceUnit,
  table: PriceTable,
  project: Project,
): ResolvedPrice {
  const user = userPriceFor(project, material.id, variant);
  if (user) return fromUser(user, unit);
  if (material.priceKey === undefined) return { ok: false, reason: 'it isn\'t in the price table' };
  const entries = table.entries.filter((e) => e.key === material.priceKey);
  if (entries.length === 0) return { ok: false, reason: 'it isn\'t in the price table' };
  const sized = entries.some((e) => e.variant !== undefined);
  if (!sized) return fromEntry(entries[0]!, unit);
  const entry = variant === undefined ? undefined : entries.find((e) => e.variant === variant);
  if (!entry) return { ok: false, reason: variant === undefined ? 'the price depends on the size' : `the price table has no ${variant} size` };
  return fromEntry(entry, unit);
}
