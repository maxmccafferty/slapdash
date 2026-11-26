import { describe, expect, it } from 'vitest';
import { checkRateLimit, clientIp, identifyUser, MemoryUsageStore } from '../src/index.ts';

const LIMITS = { ratePerMinute: 30, ratePerDay: 1000 };

describe('rate limit', () => {
  it('limits the 31st request in a minute until the next minute', async () => {
    let t = Date.parse('2026-11-25T10:00:15Z');
    const store = new MemoryUsageStore(() => t);
    for (let i = 0; i < 30; i++) expect(await checkRateLimit(store, 'u', LIMITS, new Date(t))).toEqual({ ok: true });
    expect(await checkRateLimit(store, 'u', LIMITS, new Date(t))).toEqual({ ok: false, retryAfterSeconds: 45 });
    t = Date.parse('2026-11-25T10:00:59.200Z');
    expect(await checkRateLimit(store, 'u', LIMITS, new Date(t))).toEqual({ ok: false, retryAfterSeconds: 1 });
    t = Date.parse('2026-11-25T10:01:00Z');
    expect(await checkRateLimit(store, 'u', LIMITS, new Date(t))).toEqual({ ok: true });
  });

  it('enforces the daily cap until the next UTC day', async () => {
    let t = Date.parse('2026-11-25T23:00:00Z');
    const store = new MemoryUsageStore(() => t);
    const limits = { ratePerMinute: 100, ratePerDay: 3 };
    for (let i = 0; i < 3; i++) expect((await checkRateLimit(store, 'u', limits, new Date(t))).ok).toBe(true);
    expect(await checkRateLimit(store, 'u', limits, new Date(t))).toEqual({ ok: false, retryAfterSeconds: 3600 });
    t = Date.parse('2026-11-26T00:00:00Z');
    expect((await checkRateLimit(store, 'u', limits, new Date(t))).ok).toBe(true);
  });

  it('counts users separately', async () => {
    const t = Date.parse('2026-11-25T10:00:00Z');
    const store = new MemoryUsageStore(() => t);
    const limits = { ratePerMinute: 1, ratePerDay: 10 };
    expect((await checkRateLimit(store, 'a', limits, new Date(t))).ok).toBe(true);
    expect((await checkRateLimit(store, 'a', limits, new Date(t))).ok).toBe(false);
    expect((await checkRateLimit(store, 'b', limits, new Date(t))).ok).toBe(true);
  });
});

describe('identify', () => {
  const req = (headers: Record<string, string>) => new Request('http://localhost/api/claude', { headers });

  it('reads the client IP from the platform headers, first hop first', () => {
    expect(clientIp(req({ 'x-vercel-forwarded-for': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }))).toBe('1.1.1.1');
    expect(clientIp(req({ 'x-forwarded-for': '2.2.2.2, 10.0.0.1' }))).toBe('2.2.2.2');
    expect(clientIp(req({ 'x-real-ip': '3.3.3.3' }))).toBe('3.3.3.3');
    expect(clientIp(req({}))).toBe('local');
  });

  it('hashes the IP: stable, distinct per IP, and never the raw address', async () => {
    const a = await identifyUser(req({ 'x-forwarded-for': '203.0.113.7' }));
    expect(await identifyUser(req({ 'x-forwarded-for': '203.0.113.7' }))).toBe(a);
    expect(await identifyUser(req({ 'x-forwarded-for': '203.0.113.8' }))).not.toBe(a);
    expect(a).not.toContain('203.0.113.7');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});
