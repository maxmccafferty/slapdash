/**
 * The Supabase adapter (ADR-0001 §10, ADR-0002 §D1 P5): Postgres rows for projects, a
 * private Storage bucket for files, and Supabase Auth (password and passkey). Only this
 * folder imports supabase-js. The app loads it lazily, and only when the Supabase env vars
 * are set, so local-only builds never download it.
 *
 * In the app it sits under `createSyncedBackend` (`@slapdash/storage`), which keeps every
 * write on the device first and pushes it here.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { newId as defaultNewId } from '../../ids.ts';
import type { DeviceState, StorageBackend } from '../../types.ts';
import { SupabaseAuth } from './auth.ts';
import { SupabaseProjectStore } from './store.ts';

export { SupabaseAuth, SIGN_IN_MESSAGES, signInError, toUser } from './auth.ts';
export { CLOUD_UNAVAILABLE_MESSAGE, SIGNED_OUT_MESSAGE, TOO_LARGE_MESSAGE, isUnreachable, toStorageError } from './errors.ts';
export { FILES_BUCKET, FILES_TABLE, PROJECTS_TABLE, SupabaseFiles, SupabaseProjectStore, objectPath, pathSegment } from './store.ts';

/** Where supabase-js keeps the session: `localStorage` in the browser, a map in tests. */
export interface SessionStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface SupabaseBackendOptions {
  /** The project URL, e.g. https://abc.supabase.co. */
  url: string;
  /** The publishable (or legacy anon) key. Never the secret/service-role key. */
  key: string;
  /** Session storage. Default: supabase-js's own (localStorage in browsers). */
  storage?: SessionStorage;
  /** Key the session is stored under. Default supabase-js's (`sb-<ref>-auth-token`). */
  storageKey?: string;
  fetch?: typeof fetch;
  /** Clock for file timestamps. Default Date.now. */
  now?: () => number;
  /** Id generator for files. Default crypto.randomUUID. */
  newId?: () => string;
  /**
   * Device state stays on the device by definition, so the caller passes the local
   * backend's. Without it an in-memory one is used (tests).
   */
  device?: DeviceState;
}

/** An in-memory session store (Node tests, or a browser without localStorage). */
export function memorySessionStorage(): SessionStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** Device state that lasts as long as the page. */
export class MemoryDeviceState implements DeviceState {
  #last: string | null = null;
  async getLastProjectId(): Promise<string | null> {
    return this.#last;
  }
  async setLastProjectId(id: string | null): Promise<void> {
    this.#last = id;
  }
}

export interface SupabaseBackend extends StorageBackend {
  store: SupabaseProjectStore;
  auth: SupabaseAuth;
  client: SupabaseClient;
}

export function createSupabaseBackend(opts: SupabaseBackendOptions): SupabaseBackend {
  const client = createClient(opts.url, opts.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      ...(opts.storage ? { storage: opts.storage } : {}),
      ...(opts.storageKey ? { storageKey: opts.storageKey } : {}),
    },
    ...(opts.fetch ? { global: { fetch: opts.fetch } } : {}),
  });
  const auth = new SupabaseAuth(client);
  return {
    client,
    store: new SupabaseProjectStore(client, { now: opts.now ?? Date.now, newId: opts.newId ?? defaultNewId }),
    auth,
    device: opts.device ?? new MemoryDeviceState(),
    close: () => {
      void client.auth.stopAutoRefresh().catch(() => undefined);
      void client.removeAllChannels().catch(() => undefined);
    },
  };
}
