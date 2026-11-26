import { describe, expect, it } from 'vitest';
import { readTokens } from '../scripts/build-tokens.ts';

const tokens = readTokens();
const colour = (name: string): string => {
  const t = tokens.color.tokens.find((c) => c.name === name);
  if (!t?.value.light) throw new Error(`no colour token ${name}`);
  return t.value.light;
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two token colours. */
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(colour(a)), luminance(colour(b))].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('colour contrast of the pairs the shell uses', () => {
  it('muted matches the ratios in its token notes', () => {
    expect(ratio('muted', 'paper')).toBeGreaterThanOrEqual(5.7);
    // The note rounds to one decimal place (5.09 -> 5.1).
    expect(Math.round(ratio('muted', 'unit') * 10) / 10).toBeGreaterThanOrEqual(5.1);
    // Also the unconfirmed words in the user's bubble while Talk is held: muted on unit.
    expect(ratio('muted', 'unit')).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['ink', 'paper'],
    ['ink', 'unit'],
    ['ink', 'track'],
    ['ink-soft', 'paper'],
    ['ink-soft', 'unit'],
    ['ink-soft', 'track'],
    ['ink', 'signal'],
    // The held Talk key: ink on signal-pressed is only 3.68:1, so its label turns paper.
    ['paper', 'signal-pressed'],
    ['paper', 'key-dark'],
  ])('text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([['paper'], ['unit'], ['track'], ['signal']])('the ink focus ring on %s is at least 3:1', (bg) => {
    expect(ratio('ink', bg)).toBeGreaterThanOrEqual(3);
  });
});
