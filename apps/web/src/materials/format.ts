/**
 * Words and numbers for the materials list, the cut list and the PDF. Lengths read like the
 * 2D sheet (`8′ 8 5/8″`); money is whole dollars, as a range unless it is the person's own
 * price.
 */
import { formatFeetInches, type CutListGroup, type MaterialsRow, type MaterialsTotals, type RowCost } from '@slapdash/core';
import { toPrimes } from '../renderer/units.ts';

export const NO_PRICE = 'no price yet';
export const EMPTY_MATERIALS = 'Nothing built yet. Ask Claude to build something and the list fills in.';

/** `8′ 8 5/8″`, to the nearest 1/16in. */
export function formatCutLength(mm: number): string {
  return toPrimes(formatFeetInches(mm));
}

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, minimumFractionDigits: 0 });

/** Whole dollars from cents: `$1,240`. */
export function formatDollars(cents: number): string {
  return dollars.format(Math.round(cents / 100));
}

/** `$1,240–$1,890`, or one value when low and high round to the same dollar. */
export function formatRange(lowCents: number, highCents: number): string {
  const low = formatDollars(lowCents);
  const high = formatDollars(highCents);
  return low === high ? low : `${low}–${high}`;
}

export function formatCost(cost: RowCost): string {
  return cost.user ? formatDollars(cost.low_cents) : formatRange(cost.low_cents, cost.high_cents);
}

/** The total line: `$2,391–$3,831`, and how many rows have no price yet. */
export function formatTotal(totals: MaterialsTotals): string {
  return formatRange(totals.low_cents, totals.high_cents);
}

export function unpricedNote(totals: MaterialsTotals): string | null {
  if (totals.unpriced === 0) return null;
  return totals.unpriced === 1 ? '1 item has no price yet.' : `${totals.unpriced} items have no price yet.`;
}

/** `Prices from 25 Nov 2026. Planning estimates, not quotes.` */
export function priceDateNote(totals: MaterialsTotals): string {
  const [y, m, d] = totals.researchedOn.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `Prices from ${date}. Planning estimates, not quotes.`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** `2×4` from a nominal like `2x4`. */
export function nominalText(nominal: string | undefined): string {
  return (nominal ?? '').replace(/(\d)\s*x\s*(\d)/gi, '$1×$2');
}

function hardwareWord(row: MaterialsRow): [string, string] {
  if (/nail/i.test(row.name)) return ['nail', 'nails'];
  if (/screw/i.test(row.name)) return ['screw', 'screws'];
  if (/bolt|anchor/i.test(row.name)) return ['bolt', 'bolts'];
  return ['pc', 'pcs'];
}

/** "62 pcs", "18 sheets", "2.75 yd³", "640 nails", "34 linear ft", "120 ft²". */
export function formatAmount(row: MaterialsRow): string {
  switch (row.measure) {
    case 'boards':
    case 'pieces':
      return plural(row.quantity, 'pc', 'pcs');
    case 'sheets':
      return plural(row.quantity, 'sheet');
    case 'cu-yd':
      return `${row.quantity.toFixed(2).replace(/\.?0+$/, '')} yd³`;
    case 'linear-ft':
      return `${Math.ceil(row.quantity - 1e-9).toLocaleString('en-US')} linear ft`;
    case 'sq-ft':
      return `${Math.ceil(row.quantity - 1e-9).toLocaleString('en-US')} ft²`;
    case 'fasteners': {
      const [one, many] = hardwareWord(row);
      return plural(row.quantity, one, many);
    }
  }
}

/** The row's name: the material, then the size and board ("SPF No.2 lumber · 2×4 · precut stud 8′ 8 5/8″"). */
export function rowLabel(row: MaterialsRow): { name: string; detail: string | null } {
  const bits: string[] = [];
  if (row.nominal) bits.push(nominalText(row.nominal));
  else if (row.variant && row.measure === 'sheets') bits.push(row.variant.replace(/in$/, '″'));
  else if (row.variant && row.measure === 'fasteners') bits.push(`for ${nominalText(row.variant)}`);
  if (row.stock) bits.push(`${row.stock.name ?? 'board'} ${formatCutLength(row.stock.length_mm)}`);
  return { name: row.name, detail: bits.length > 0 ? bits.join(' · ') : null };
}

/** "From 2×4 precut studs, 8′ 8 5/8″" or "From 2×6 boards, 18′ 0″". */
export function boardTitle(group: Pick<CutListGroup, 'nominal' | 'stock'>): string {
  const kind = group.stock.name ? `${group.stock.name}s` : 'boards';
  return `From ${nominalText(group.nominal)} ${kind}, ${formatCutLength(group.stock.length_mm)}`;
}

export function boardCount(n: number): string {
  return plural(n, 'board');
}
