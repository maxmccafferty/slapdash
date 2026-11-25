/**
 * Auth over Supabase (ADR-0002 §F2): email + password, and passkeys (Supabase's native
 * WebAuthn support, so there is no WebAuthn server of our own). The session is persisted by
 * supabase-js in the given storage (localStorage in the browser), so `currentUser()` works
 * offline and while the project is paused.
 */
import type { Session, SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js';
import type { Auth, AuthResult, Passkeys, SignInCredentials, User } from '../../types.ts';
import { CLOUD_UNAVAILABLE_MESSAGE, isUnreachable } from './errors.ts';

export const SIGN_IN_MESSAGES = {
  invalidCredentials: "That email and password don't match.",
  noPasskey: "This device doesn't have a passkey for Slapdash yet. Sign in with your password once, then add one.",
  passkeysOff: "Passkeys aren't turned on for this Slapdash.",
  cancelled: 'Passkey sign-in was cancelled.',
  passkeyNotSaved: "The passkey wasn't added. You can still sign in with your password.",
  unreachable: CLOUD_UNAVAILABLE_MESSAGE,
  missingFields: 'Enter your email and password.',
  signedOut: "You're not signed in.",
} as const;

export function toUser(user: SupabaseUser): User {
  const meta = (user.user_metadata ?? {}) as { name?: unknown; full_name?: unknown };
  const name = typeof meta.name === 'string' && meta.name ? meta.name : typeof meta.full_name === 'string' && meta.full_name ? meta.full_name : undefined;
  const email = user.email || undefined;
  return { id: user.id, displayName: name ?? email ?? 'Signed in', ...(email ? { email } : {}) };
}

interface ErrorFields {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  status?: unknown;
  cause?: unknown;
}

/** A plain sentence for a failed sign-in or passkey call. */
export function signInError(e: unknown, kind: 'password' | 'passkey' | 'register'): string {
  const err = (typeof e === 'object' && e !== null ? e : { message: String(e) }) as ErrorFields;
  const code = typeof err.code === 'string' ? err.code : '';
  const message = typeof err.message === 'string' ? err.message : '';
  const causeName = (err.cause as { name?: unknown } | undefined)?.name;
  const status = typeof err.status === 'number' ? err.status : undefined;

  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) return SIGN_IN_MESSAGES.invalidCredentials;
  if (code === 'webauthn_credential_not_found' || /credential.*not found/i.test(message)) return SIGN_IN_MESSAGES.noPasskey;
  if (code === 'passkey_disabled' || /passkey.*(disabled|not enabled)/i.test(message)) return SIGN_IN_MESSAGES.passkeysOff;
  if (
    code === 'ERROR_CEREMONY_ABORTED' ||
    err.name === 'NotAllowedError' ||
    err.name === 'AbortError' ||
    causeName === 'NotAllowedError' ||
    causeName === 'AbortError'
  ) {
    return kind === 'register' ? SIGN_IN_MESSAGES.passkeyNotSaved : SIGN_IN_MESSAGES.cancelled;
  }
  // A 400/422 from Auth is a refusal, not an outage.
  if (status === undefined || status === 0 || status >= 500 || err.name === 'AuthRetryableFetchError') {
    if (isUnreachable(e, status)) return SIGN_IN_MESSAGES.unreachable;
  }
  if (kind === 'register') return SIGN_IN_MESSAGES.passkeyNotSaved;
  return message ? `Sign-in didn't work: ${message.replace(/\.$/, '')}.` : "Sign-in didn't work. Try again.";
}

class SupabasePasskeys implements Passkeys {
  readonly #client: SupabaseClient;
  constructor(client: SupabaseClient) {
    this.#client = client;
  }

  supported(): boolean {
    return typeof globalThis.PublicKeyCredential !== 'undefined';
  }

  async register(): Promise<AuthResult> {
    try {
      const { data: current } = await this.#client.auth.getSession();
      if (!current.session) return { ok: false, error: SIGN_IN_MESSAGES.signedOut };
      const { error } = await this.#client.auth.registerPasskey();
      if (error) return { ok: false, error: signInError(error, 'register') };
      return { ok: true, user: toUser(current.session.user) };
    } catch (e) {
      return { ok: false, error: signInError(e, 'register') };
    }
  }
}

export class SupabaseAuth implements Auth {
  readonly requiresSignIn = true;
  readonly passkeys: Passkeys;
  readonly #client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.#client = client;
    this.passkeys = new SupabasePasskeys(client);
  }

  async #session(): Promise<Session | null> {
    try {
      const { data } = await this.#client.auth.getSession();
      return data.session;
    } catch {
      return null;
    }
  }

  /** From the persisted session: no network call, so it works offline. */
  async currentUser(): Promise<User | null> {
    const session = await this.#session();
    return session ? toUser(session.user) : null;
  }

  async signIn(credentials: SignInCredentials): Promise<AuthResult> {
    try {
      if (credentials.kind === 'password') {
        const email = credentials.email.trim();
        if (!email || !credentials.password) return { ok: false, error: SIGN_IN_MESSAGES.missingFields };
        const { data, error } = await this.#client.auth.signInWithPassword({ email, password: credentials.password });
        if (error || !data.user) return { ok: false, error: signInError(error, 'password') };
        return { ok: true, user: toUser(data.user) };
      }
      const { data, error } = await this.#client.auth.signInWithPasskey(
        credentials.conditional ? { options: { mediation: 'conditional' } } : undefined,
      );
      const user = data?.session?.user ?? data?.user ?? null;
      if (error || !user) return { ok: false, error: signInError(error, 'passkey') };
      return { ok: true, user: toUser(user) };
    } catch (e) {
      return { ok: false, error: signInError(e, credentials.kind) };
    }
  }

  /** Signs out on this device only; other devices stay signed in. */
  async signOut(): Promise<void> {
    try {
      await this.#client.auth.signOut({ scope: 'local' });
    } catch {
      // The local session is cleared even when the server can't be told.
    }
  }

  onChange(fn: (user: User | null) => void): () => void {
    let last: string | null | undefined;
    const { data } = this.#client.auth.onAuthStateChange((event, session) => {
      const id = session?.user.id ?? null;
      if (event === 'INITIAL_SESSION' && last === undefined) {
        last = id;
        return;
      }
      if (id === last) return;
      last = id;
      fn(session ? toUser(session.user) : null);
    });
    return () => data.subscription.unsubscribe();
  }

  /** The current access token (supabase-js refreshes it when it has expired). */
  async accessToken(): Promise<string | null> {
    return (await this.#session())?.access_token ?? null;
  }
}
