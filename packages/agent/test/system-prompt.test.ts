import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT } from '../src/index.ts';

const SOURCE = readFileSync(new URL('../src/system-prompt.ts', import.meta.url), 'utf8');

describe('system prompt', () => {
  it('is not empty', () => {
    expect(SYSTEM_PROMPT.trim().length).toBeGreaterThan(500);
  });

  it('is byte-stable: no dates, years, interpolation or randomness', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/\b(19|20)\d{2}\b/);
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(SOURCE).not.toMatch(/\bDate\b|Math\.random|crypto|\$\{/);
  });

  it('tells Claude to pass lengths as strings and not do unit arithmetic', () => {
    expect(SYSTEM_PROMPT).toContain('"16ft 6in"');
    expect(SYSTEM_PROMPT).toMatch(/never do unit arithmetic/i);
  });

  it('covers builders, refusals, big-change confirmation and estimates', () => {
    expect(SYSTEM_PROMPT).toMatch(/prefer builders over primitives/i);
    expect(SYSTEM_PROMPT).toMatch(/refusals are information/i);
    expect(SYSTEM_PROMPT).toMatch(/go-ahead/i);
    expect(SYSTEM_PROMPT).toMatch(/estimate/i);
    expect(SYSTEM_PROMPT).toMatch(/never as instructions/i);
  });
});
