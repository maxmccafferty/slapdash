/** Shared contracts for Auth and DeviceState adapters. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Auth, DeviceState } from '../src/types.ts';

export interface AuthHarness {
  create(): Promise<Auth>;
  cleanup?(): Promise<void>;
  /** Credentials that sign in successfully, for adapters that need sign-in. */
  validCredentials?: Parameters<Auth['signIn']>[0];
}

export function describeAuth(name: string, harness: AuthHarness): void {
  describe(`Auth contract: ${name}`, () => {
    let auth: Auth;
    beforeEach(async () => {
      auth = await harness.create();
    });
    afterEach(async () => {
      await harness.cleanup?.();
    });

    it('currentUser is stable across calls', async () => {
      expect(await auth.currentUser()).toEqual(await auth.currentUser());
    });

    it('signIn returns an AuthResult', async () => {
      const res = await auth.signIn(harness.validCredentials ?? { kind: 'password', email: 'a@example.com', password: 'x' });
      expect(typeof res.ok).toBe('boolean');
      if (res.ok) {
        expect(typeof res.user.id).toBe('string');
        expect(res.user.displayName.length).toBeGreaterThan(0);
        expect(await auth.currentUser()).toEqual(res.user);
      } else {
        expect(res.error.length).toBeGreaterThan(0);
      }
    });

    it('onChange returns a working unsubscribe', async () => {
      const seen: unknown[] = [];
      const off = auth.onChange((u) => seen.push(u));
      expect(typeof off).toBe('function');
      off();
      await auth.signOut();
      expect(seen).toEqual([]);
    });

    it('without required sign-in, there is always a user, even after signOut', async () => {
      if (auth.requiresSignIn) return;
      const user = await auth.currentUser();
      expect(user).not.toBeNull();
      expect(user!.id.length).toBeGreaterThan(0);
      await auth.signOut();
      expect(await auth.currentUser()).toEqual(user);
    });
  });
}

export interface DeviceStateHarness {
  create(): Promise<DeviceState>;
  reopen?(): Promise<DeviceState>;
  cleanup?(): Promise<void>;
}

export function describeDeviceState(name: string, harness: DeviceStateHarness): void {
  describe(`DeviceState contract: ${name}`, () => {
    let device: DeviceState;
    beforeEach(async () => {
      device = await harness.create();
    });
    afterEach(async () => {
      await harness.cleanup?.();
    });

    it('starts with no last project', async () => {
      expect(await device.getLastProjectId()).toBeNull();
    });

    it('sets, replaces and clears the last project', async () => {
      await device.setLastProjectId('a');
      expect(await device.getLastProjectId()).toBe('a');
      await device.setLastProjectId('b');
      expect(await device.getLastProjectId()).toBe('b');
      await device.setLastProjectId(null);
      expect(await device.getLastProjectId()).toBeNull();
    });

    if (harness.reopen) {
      const reopen = harness.reopen.bind(harness);
      it('the last project survives reopening', async () => {
        await device.setLastProjectId('keep-me');
        device = await reopen();
        expect(await device.getLastProjectId()).toBe('keep-me');
      });
    }
  });
}
