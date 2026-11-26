import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TOKENS_CSS_PATH,
  TOKENS_TS_PATH,
  generateCss,
  generateTs,
  parseTokens,
  readTokens,
} from '../scripts/build-tokens.ts';

const REGENERATE = 'The generated tokens are out of date: run `pnpm --filter @slapdash/web tokens`.';
const tokens = readTokens();
const css = readFileSync(TOKENS_CSS_PATH, 'utf8');

describe('generated tokens', () => {
  it('tokens.css matches docs/design/tokens.json', () => {
    expect(css, REGENERATE).toBe(generateCss(tokens));
  });

  it('tokens.ts matches docs/design/tokens.json', () => {
    expect(readFileSync(TOKENS_TS_PATH, 'utf8'), REGENERATE).toBe(generateTs(tokens));
  });

  it('emits every token as a custom property', () => {
    const expected = [
      ...tokens.color.tokens.map((t) => `--color-${t.name}:`),
      ...tokens.type.groups.flatMap((g) =>
        g.styles.flatMap((s) => [`--type-${s.name}-size:`, `--type-${s.name}-line:`, `--type-${s.name}-weight:`]),
      ),
      ...[tokens.spacing, tokens.radius, tokens.shadow, tokens.size].flatMap((g) => g.tokens.map((t) => `--${t.name}:`)),
      ...tokens.motion.tokens.flatMap((m) => [`--${m.name}-duration:`, `--${m.name}-easing:`]),
      '--font-sans:',
    ];
    for (const property of expected) expect(css).toContain(property);
  });

  it('has no text smaller than 14px', () => {
    for (const group of tokens.type.groups) {
      for (const style of group.styles) {
        expect(parseFloat(style.fontSize), `${style.name} is ${style.fontSize}`).toBeGreaterThanOrEqual(14);
      }
    }
  });

  it('has a 44px touch target', () => {
    expect(css).toContain('--size-touch: 44px;');
  });

  it('refuses a malformed design export', () => {
    expect(() => parseTokens({ color: {} })).toThrow(/tokens.json is not in the expected shape/);
  });
});
