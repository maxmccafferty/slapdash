import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FileUsageStore } from '../src/index.ts';
import { usageStoreContract } from './usage-store.suite.ts';

const dir = mkdtempSync(join(tmpdir(), 'keyhole-file-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;

usageStoreContract('file', () => {
  let t = Date.parse('2026-11-25T00:00:00Z');
  return { store: new FileUsageStore(join(dir, `case-${n++}`, 'usage.json'), () => t), advance: (ms) => (t += ms) };
});

describe('file usage store', () => {
  it('survives a new instance on the same path', async () => {
    const path = join(dir, 'persist', 'usage.json');
    await new FileUsageStore(path).addSpend('2026-11', 1_234);
    await new FileUsageStore(path).incr('k', 60);
    const again = new FileUsageStore(path);
    expect(await again.getSpend('2026-11')).toBe(1_234);
    expect(await again.incr('k', 60)).toBe(2);
  });

  it('prunes expired counters on write', async () => {
    let t = 0;
    const path = join(dir, 'prune', 'usage.json');
    const store = new FileUsageStore(path, () => t);
    await store.incr('old', 1);
    t = 5_000;
    await store.incr('new', 60);
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')).counters)).toEqual(['new']);
  });
});
