/**
 * Which storage the app uses (ADR-0001 §10). With no Supabase settings it is exactly the
 * local-only app: projects in this browser's IndexedDB, no sign-in. With
 * `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` baked in at build time, the
 * Supabase adapter is loaded (a lazy chunk), the sign-in card shows until someone signs
 * in, and projects sync: a per-user IndexedDB on the device, mirrored to Supabase.
 */
import {
  adoptProjects,
  createSyncedBackend,
  type Auth,
  type DeviceState,
  type ProjectStore,
  type SyncControl,
  type User,
} from '@slapdash/storage';
import { createLocalBackend, DEFAULT_DB_NAME, hasProjects, LocalSyncJournal, type LocalBackendOptions } from '@slapdash/storage/local';

export type BackendConfig = { kind: 'local' } | { kind: 'supabase'; url: string; key: string };

interface EnvLike {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

/** From the build's env (vite.config.ts maps only these two names). */
export function readBackendConfig(env: EnvLike = import.meta.env as EnvLike): BackendConfig {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && key ? { kind: 'supabase', url: url.replace(/\/+$/, ''), key } : { kind: 'local' };
}

export interface AppBackend {
  kind: 'local' | 'synced';
  store: ProjectStore;
  device: DeviceState;
  auth: Auth;
  /** Sync status and retry; null for the local-only app. */
  sync: SyncControl | null;
  /** The signed-in user; null for the local-only app. */
  user: User | null;
  /** The bearer token for the Claude server; always null for the local-only app. */
  accessToken(): Promise<string | null>;
  /** Projects from before sign-in moved into the account on this start (0 if none). */
  adopted: number;
  close(): void;
}

type SupabaseModule = typeof import('@slapdash/storage/supabase');

export interface OpenBackendDeps {
  config?: BackendConfig;
  /** Show the sign-in card and resolve with the user once someone signs in. */
  showSignIn(auth: Auth): Promise<User>;
  /** Default: the lazy `@slapdash/storage/supabase` chunk. */
  loadSupabase?: () => Promise<SupabaseModule>;
  /** Default: `createLocalBackend` (tests pass fake-indexeddb). */
  localOptions?: Omit<LocalBackendOptions, 'dbName'>;
  /** Where the Supabase session is kept. Default `localStorage`. */
  sessionStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

/** The per-user database name, so two people on one device never share projects. */
export const userDbName = (userId: string) => `slapdash-u-${userId}`;

/** Device flag: this user's database has taken in the projects made before sign-in. */
export const ADOPTED_FLAG = 'adoptedAnonymous';

function localBackend(): AppBackend {
  const local = createLocalBackend();
  return {
    kind: 'local',
    store: local.store,
    device: local.device,
    auth: local.auth,
    sync: null,
    user: null,
    accessToken: async () => null,
    adopted: 0,
    close: () => local.close(),
  };
}

export async function openBackend(deps: OpenBackendDeps): Promise<AppBackend> {
  const config = deps.config ?? readBackendConfig();
  if (config.kind === 'local') return localBackend();

  const mod = await (deps.loadSupabase ?? (() => import('@slapdash/storage/supabase')))();
  const sessionStorage = deps.sessionStorage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  const remote = mod.createSupabaseBackend({
    url: config.url,
    key: config.key,
    ...(sessionStorage ? { storage: sessionStorage } : {}),
  });

  // The stored session, read without the network: the app opens offline and while paused.
  const user = (await remote.auth.currentUser()) ?? (await deps.showSignIn(remote.auth));

  const localOpts = deps.localOptions ?? {};
  const local = createLocalBackend({ ...localOpts, dbName: userDbName(user.id) });
  const synced = createSyncedBackend({ local, remote, journal: new LocalSyncJournal(local.db) });

  let adopted = 0;
  try {
    if (!(await local.device.getFlag(ADOPTED_FLAG))) {
      if (await hasProjects({ ...localOpts, dbName: DEFAULT_DB_NAME })) {
        const anonymous = createLocalBackend({ ...localOpts, dbName: DEFAULT_DB_NAME });
        try {
          adopted = await adoptProjects(anonymous.store, synced.store);
        } finally {
          anonymous.close();
        }
      }
      await local.device.setFlag(ADOPTED_FLAG, true);
    }
  } catch {
    // The projects stay where they were; the next start tries again.
  }

  return {
    kind: 'synced',
    store: synced.store,
    device: synced.device,
    auth: remote.auth,
    sync: synced.sync,
    user,
    accessToken: () => remote.auth.accessToken(),
    adopted,
    close: () => synced.close(),
  };
}
