import { describe, expect, it, vi } from 'vitest';
import { costMicroUsd, priceFor, PRICES } from '../src/index.ts';

describe('pricing', () => {
  it('prices a mix of input, output, cache write and cache read exactly', () => {
    // Sonnet 5.5: 2 / 10 / 2.5 / 0.10 $ per MTok.
    const usage = { input_tokens: 1_000, output_tokens: 2_000, cache_creation_input_tokens: 10_000, cache_read_input_tokens: 50_000 };
    // 2×1000 + 10×2000 + 2.5×10000 + 0.1×50000 = 2000 + 20000 + 25000 + 5000
    expect(costMicroUsd('claude-sonnet-5-5', usage)).toBe(52_000);
    // Opus 5.5: 4 / 20 / 5 / 0.20
    expect(costMicroUsd('claude-opus-5-5', usage)).toBe(4_000 + 40_000 + 50_000 + 10_000);
  });

  it('treats null and missing counts as zero and rounds fractions up', () => {
    expect(costMicroUsd('claude-sonnet-5-5', { input_tokens: null, output_tokens: 1 })).toBe(10);
    expect(costMicroUsd('claude-sonnet-5-5', { cache_read_input_tokens: 3 })).toBe(1); // 0.3 µ$ → 1
    expect(costMicroUsd('claude-sonnet-5-5', { cache_read_input_tokens: 30 })).toBe(3); // no float drift
  });

  it('uses the higher Haiku 5.5 prices for a prompt over 100,000 tokens', () => {
    expect(costMicroUsd('claude-haiku-5-5', { input_tokens: 100_000, output_tokens: 1_000 })).toBe(10_000 + 500);
    expect(costMicroUsd('claude-haiku-5-5', { input_tokens: 50_000, cache_read_input_tokens: 50_001, output_tokens: 1_000 })).toBe(
      Math.ceil(0.5 * 50_000 + 0.05 * 50_001 + 2.5 * 1_000),
    );
  });

  it('prices dated snapshots like their alias', () => {
    expect(priceFor('claude-sonnet-5-5-20261001')).toBe(PRICES['claude-sonnet-5-5']);
  });

  it('prices an unknown model at the most expensive row and warns once', () => {
    const warn = vi.fn();
    const top = Math.max(...Object.values(PRICES).map((p) => p.output));
    expect(priceFor('claude-mystery-9', warn).output).toBe(top);
    expect(costMicroUsd('claude-mystery-9', { output_tokens: 1 }, warn)).toBe(top);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('has a cache write at 1.25× input on every row', () => {
    for (const p of Object.values(PRICES)) expect(p.cacheWrite).toBeCloseTo(p.input * 1.25, 10);
  });
});
