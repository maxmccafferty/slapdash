/** Text helpers shared by the query tools, the project summary and dispatch. */
import { formatFeetInches } from '@slapdash/core';

/** Feet and inches for Claude: `9' 0"`, or just inches under a foot (`3 1/2"`). */
export function ft(mm: number): string {
  return formatFeetInches(mm).replace(/^(-?)0' /, '$1');
}

/** Feet and inches with millimetres in brackets: `16' 0" (4877 mm)`. */
export function ftMm(mm: number): string {
  return `${ft(mm)} (${Math.round(mm)} mm)`;
}

/** Trim to `max` characters on a word boundary, with an ellipsis. */
export function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Natural order for ids: `W2-S2` before `W2-S10`. */
export function compareIds(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

/** `1 part`, `3 parts`. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
