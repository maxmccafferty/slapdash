import { describe, expect, it, vi } from 'vitest';
import { FileUsageStore, MemoryUsageStore, readConfig, selectUsageStore, UpstashUsageStore } from '../src/index.ts';

describe('selectUsageStore', () => {
  it('uses Upstash when its URL and token are set', () => {
    const env = { KV_REST_API_URL: 'https://kv', KV_REST_API_TOKEN: 't', VERCEL_ENV: 'production' };
    expect(selectUsageStore(readConfig(env), env)).toBeInstanceOf(UpstashUsageStore);
  });

  it.each(['production', 'preview'])('falls back to memory with a warning on a %s deployment without Upstash', (VERCEL_ENV) => {
    const warn = vi.fn();
    expect(selectUsageStore(readConfig({}), { VERCEL_ENV }, warn)).toBeInstanceOf(MemoryUsageStore);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Upstash'));
  });

  it('uses the JSON file otherwise (local dev, vercel dev)', () => {
    const warn = vi.fn();
    expect(selectUsageStore(readConfig({}), {}, warn)).toBeInstanceOf(FileUsageStore);
    expect(selectUsageStore(readConfig({}), { VERCEL_ENV: 'development' }, warn)).toBeInstanceOf(FileUsageStore);
    expect(warn).not.toHaveBeenCalled();
  });
});
