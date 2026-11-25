/**
 * The sign-in gate for a hosted copy with Supabase (ADR-0002 §F3): the browser sends the
 * signed-in user's access token as `Authorization: Bearer …`, and the keyhole asks Supabase
 * Auth who it belongs to (`GET /auth/v1/user`). No supabase-js: only `fetch`, so the
 * Vercel bundle stays small. Answers are cached briefly by a hash of the token.
 */
import { createHash } from 'node:crypto';
import type { Identify } from './identify.ts';

export type Authenticate = (request: Request) => Promise<string | null>;

export interface SupabaseIdentityOptions {
  /** Project URL, e.g. https://abc.supabase.co. */
  url: string;
  /** Publishable (anon) key: sent as `apikey`. */
  key: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** How long a good token is trusted without asking again. Default 60 s. */
  hitTtlMs?: number;
  /** How long a refused token stays refused. Default 10 s. */
  missTtlMs?: number;
  /** Most cached tokens. Default 500. */
  maxEntries?: number;
  /** Timeout for the call to Supabase. Default 5 s. */
  timeoutMs?: number;
}

export interface SupabaseIdentity {
  /** The user id for the request's bearer token, or null when there is none or it's refused. */
  verify: Authenticate;
  /** For the rate limit: `u:<user id>`. Call after `verify` succeeded. */
  identify: Identify;
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  const m = header ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null;
  return m ? m[1]! : null;
}

export function supabaseIdentity(opts: SupabaseIdentityOptions): SupabaseIdentity {
  const base = opts.url.replace(/\/+$/, '');
  const fetchImpl = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const hitTtl = opts.hitTtlMs ?? 60_000;
  const missTtl = opts.missTtlMs ?? 10_000;
  const maxEntries = opts.maxEntries ?? 500;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const cache = new Map<string, { userId: string | null; until: number }>();

  async function ask(token: string): Promise<string | null> {
    try {
      const res = await fetchImpl(`${base}/auth/v1/user`, {
        method: 'GET',
        headers: { apikey: opts.key, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { id?: unknown };
      return typeof body.id === 'string' && body.id ? body.id : null;
    } catch {
      // Supabase can't be reached: Claude can't be checked out to anyone either.
      return null;
    }
  }

  const verify: Authenticate = async (request) => {
    const token = bearerToken(request);
    if (!token) return null;
    const key = createHash('sha256').update(token).digest('hex');
    const at = now();
    const hit = cache.get(key);
    if (hit && hit.until > at) return hit.userId;
    const userId = await ask(token);
    cache.delete(key);
    cache.set(key, { userId, until: at + (userId ? hitTtl : missTtl) });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
    return userId;
  };

  const identify: Identify = async (request) => {
    const userId = await verify(request);
    return userId ? `u:${userId}` : 'u:anonymous';
  };

  return { verify, identify };
}
