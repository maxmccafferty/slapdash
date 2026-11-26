/**
 * What Claude costs, in integer micro-dollars so spend never drifts with float error.
 *
 * Prices in $ per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing,
 * checked 2026-11-25. A 5-minute cache write is 1.25× input. Update this table when prices move.
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  /** Higher prices for a request whose whole prompt (input + cache reads + cache writes) is over `overTokens`. */
  longContext?: { overTokens: number; price: Omit<ModelPrice, 'longContext'> };
}

export const PRICES_CHECKED = '2026-11-25';

export const PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheWrite: 0.125,
    cacheRead: 0.01,
    longContext: { overTokens: 100_000, price: { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 } },
  },
});

/** The token counts that cost money. Nulls (as the stream sends them) count as zero. */
export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

function mostExpensive(): ModelPrice {
  return Object.values(PRICES).reduce((a, b) => (b.output > a.output ? b : a));
}

const warned = new Set<string>();

/** The price row for a model. Unknown models are priced at the most expensive row, so spend is never under-counted. */
export function priceFor(model: string, warn: (message: string) => void = console.warn): ModelPrice {
  const exact = PRICES[model];
  if (exact) return exact;
  // Dated snapshot IDs (`claude-x-1-2-20260101`) price like their alias.
  const alias = Object.keys(PRICES).find((k) => model.startsWith(`${k}-`) && /^\d{8}$/.test(model.slice(k.length + 1)));
  if (alias) return PRICES[alias]!;
  if (!warned.has(model)) {
    warned.add(model);
    warn(`[keyhole] No price for model "${model}"; counting it at the most expensive rate. Add it to PRICES in packages/keyhole/src/pricing.ts.`);
  }
  return mostExpensive();
}

/** Cost of one usage record in micro-dollars (1e-6 USD), rounded up. */
export function costMicroUsd(model: string, usage: TokenUsage, warn?: (message: string) => void): number {
  const row = priceFor(model, warn);
  const prompt = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const p = row.longContext && prompt > row.longContext.overTokens ? row.longContext.price : row;
  // $/MTok × tokens = micro-dollars.
  const micro =
    p.input * (usage.input_tokens ?? 0) +
    p.output * (usage.output_tokens ?? 0) +
    p.cacheWrite * (usage.cache_creation_input_tokens ?? 0) +
    p.cacheRead * (usage.cache_read_input_tokens ?? 0);
  // Round away float noise first (0.1 × 3 = 0.30000000000000004), then up.
  return Math.ceil(Math.round(micro * 1e6) / 1e6);
}
