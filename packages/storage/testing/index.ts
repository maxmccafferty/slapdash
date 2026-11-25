/**
 * Shared adapter test suites (vitest). Every adapter runs these from its own test file:
 *
 *   describeProjectStore('local', { create, reopen, cleanup });
 *   describeAuth('local', { create });
 *   describeDeviceState('local', { create, reopen, cleanup });
 */
export { describeProjectStore, type StoreHarness } from './project-store-suite.ts';
export { describeAuth, describeDeviceState, type AuthHarness, type DeviceStateHarness } from './auth-suite.ts';
export { allBytes, fixedClock, sampleRecord, sequentialIds } from './fixtures.ts';
