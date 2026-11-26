import { MemoryUsageStore } from '../src/index.ts';
import { usageStoreContract } from './usage-store.suite.ts';

usageStoreContract('memory', () => {
  let t = Date.parse('2026-11-25T00:00:00Z');
  return { store: new MemoryUsageStore(() => t), advance: (ms) => (t += ms) };
});
