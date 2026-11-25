import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/index.ts';

const KEY = 'sk-ant-TEST-SENTINEL-123';

describe('readConfig', () => {
  it('has the documented defaults', () => {
    const c = readConfig({});
    expect(c).toMatchObject({
      apiKey: undefined,
      model: 'claude-sonnet-5-5',
      maxTokens: 32000,
      effort: 'medium',
      fallbacks: true,
      monthlyBudgetUsd: 10,
      ratePerMinute: 30,
      ratePerDay: 1000,
      maxBodyBytes: 8 * 1024 * 1024,
      maxMessages: 400,
      allowedOrigins: [],
      usageFile: '.data/usage.json',
      upstash: undefined,
    });
  });

  it('reads overrides', () => {
    const c = readConfig({
      ANTHROPIC_API_KEY: KEY,
      SLAPDASH_MODEL: 'claude-opus-5-5',
      SLAPDASH_MAX_TOKENS: '64000',
      SLAPDASH_EFFORT: 'high',
      SLAPDASH_FALLBACKS: 'off',
      SLAPDASH_MONTHLY_BUDGET_USD: '2.5',
      SLAPDASH_RATE_PER_MINUTE: '5',
      SLAPDASH_RATE_PER_DAY: '50',
      SLAPDASH_ALLOWED_ORIGINS: 'https://a.example/, https://b.example',
      SLAPDASH_USAGE_FILE: '/tmp/u.json',
      KV_REST_API_URL: 'https://kv.example/',
      KV_REST_API_TOKEN: 'tok',
    });
    expect(c).toMatchObject({
      apiKey: KEY,
      model: 'claude-opus-5-5',
      maxTokens: 64000,
      effort: 'high',
      fallbacks: false,
      monthlyBudgetUsd: 2.5,
      ratePerMinute: 5,
      ratePerDay: 50,
      allowedOrigins: ['https://a.example', 'https://b.example'],
      usageFile: '/tmp/u.json',
      upstash: { url: 'https://kv.example', token: 'tok' },
    });
  });

  it('accepts the Upstash variable names too', () => {
    expect(readConfig({ UPSTASH_REDIS_REST_URL: 'https://u', UPSTASH_REDIS_REST_TOKEN: 't' }).upstash).toEqual({ url: 'https://u', token: 't' });
  });

  it('treats blank values as unset', () => {
    expect(readConfig({ ANTHROPIC_API_KEY: '  ', SLAPDASH_MODEL: '' })).toMatchObject({ apiKey: undefined, model: 'claude-sonnet-5-5' });
  });

  it.each([
    ['SLAPDASH_MONTHLY_BUDGET_USD', 'ten'],
    ['SLAPDASH_MONTHLY_BUDGET_USD', '-1'],
    ['SLAPDASH_RATE_PER_MINUTE', '1.5'],
    ['SLAPDASH_RATE_PER_DAY', '0'],
    ['SLAPDASH_MAX_TOKENS', 'Infinity'],
    ['SLAPDASH_EFFORT', 'extreme'],
    ['SLAPDASH_FALLBACKS', 'maybe'],
  ])('rejects %s=%s with a plain message', (name, value) => {
    expect(() => readConfig({ [name]: value })).toThrow(name);
  });

  it('never shows the key in JSON or util.inspect', () => {
    const c = readConfig({ ANTHROPIC_API_KEY: KEY });
    expect(JSON.stringify(c)).not.toContain(KEY);
    expect(JSON.stringify(c)).toContain('[redacted]');
    expect(inspect(c)).not.toContain(KEY);
    expect(inspect({ nested: c }, { depth: 5 })).not.toContain(KEY);
    expect(c.apiKey).toBe(KEY);
  });
});
