/**
 * Screen text into words for speech (ADR-0002 §9: feet and inches are spoken, not read as
 * symbols). Pure.
 */

const FEET = `(?:′|')`;
const INCHES = `(?:″|"|'')`;
const NUM = `\\d+(?:\\.\\d+)?`;
/** "3 1/2" or "1/2" or "3". */
const AMOUNT = `(?:${NUM}\\s+\\d+\\/\\d+|\\d+\\/\\d+|${NUM})`;

const FRACTIONS: Record<string, string> = {
  '1/2': 'a half',
  '1/4': 'a quarter',
  '3/4': 'three quarters',
  '1/8': 'an eighth',
  '3/8': 'three eighths',
  '5/8': 'five eighths',
  '7/8': 'seven eighths',
  '1/16': 'a sixteenth',
};

function amount(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 2) {
    const frac = FRACTIONS[parts[1]!] ?? parts[1]!;
    return `${parts[0]} and ${frac}`;
  }
  const only = parts[0]!;
  if (only.includes('/')) return FRACTIONS[only] ?? only;
  return only;
}

const isZero = (raw: string) => /^0+(?:\.0+)?$/.test(raw.trim());

const unit = (raw: string, one: string, many: string) => {
  const t = raw.trim();
  return /^1(?:\.0+)?$/.test(t) ? one : many;
};

export function speechText(text: string): string {
  let out = text;

  // Feet and inches together: 6′ 10″, 6' 10", 9′ 0″, 6′-10″.
  out = out.replace(new RegExp(`(${NUM})\\s*${FEET}\\s*-?\\s*(${AMOUNT})\\s*${INCHES}`, 'g'), (_m, ft: string, inches: string) => {
    const feet = `${ft} ${unit(ft, 'foot', 'feet')}`;
    return isZero(inches) ? feet : `${feet} ${amount(inches)}`;
  });
  // Inches alone: 3 1/2″, 10″, 1/2".
  out = out.replace(new RegExp(`(${AMOUNT})\\s*${INCHES}`, 'g'), (_m, inches: string) => `${amount(inches)} ${unit(inches, 'inch', 'inches')}`);
  // Feet alone: 4′, 16'.
  out = out.replace(new RegExp(`(${NUM})\\s*${FEET}(?![\\w])`, 'g'), (_m, ft: string) => `${ft} ${unit(ft, 'foot', 'feet')}`);

  // 16×20, 16 x 20 → 16 by 20.
  out = out.replace(/(\d)\s*[×x]\s*(?=\d)/g, '$1 by ');

  // Markdown: headings, list bullets, emphasis and code markers.
  out = out
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/\*\*|__|`+/g, '')
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,;:!?])/g, '$1$2');

  return out.replace(/\s+/g, ' ').trim();
}
