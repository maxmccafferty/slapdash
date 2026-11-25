/**
 * Turns what supabase-js hands back (PostgREST, Storage and Auth errors, failed fetches, a
 * paused free-tier project) into a `StorageError` with a sentence the app can show as is.
 */
import { CLOUD_UNAVAILABLE_MESSAGE, StorageError } from '../../errors.ts';

export { CLOUD_UNAVAILABLE_MESSAGE };

/** The session is gone or was refused. */
export const SIGNED_OUT_MESSAGE = "You've been signed out. Sign in again to sync.";

export const TOO_LARGE_MESSAGE = 'That file is too large for cloud storage (25 MB at most).';

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  error?: unknown;
}

function asErrorLike(e: unknown): ErrorLike {
  return typeof e === 'object' && e !== null ? (e as ErrorLike) : { message: String(e) };
}

function statusOf(e: ErrorLike, status: number | undefined): number | undefined {
  for (const v of [status, e.status, e.statusCode]) {
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return undefined;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** True when the error means the cloud can't be reached: no network, a timeout, 5xx, or paused. */
export function isUnreachable(e: unknown, status?: number): boolean {
  const err = asErrorLike(e);
  const name = text(err.name);
  const message = text(err.message);
  const s = statusOf(err, status);
  if (name === 'TypeError' || name === 'AbortError' || name === 'TimeoutError' || name === 'AuthRetryableFetchError') return true;
  if (/^(TypeError|AbortError|FetchError)\b/.test(message) || /fetch failed|failed to fetch|network ?error|load failed/i.test(message)) return true;
  if (/project is paused|\bpaused\b/i.test(message)) return true;
  return s === 0 || (s !== undefined && s >= 500);
}

/**
 * Map any thrown or returned Supabase error to a StorageError. `status` is the HTTP status
 * supabase-js reports next to the error, when it has one.
 */
export function toStorageError(e: unknown, status?: number): StorageError {
  if (e instanceof StorageError) return e;
  const err = asErrorLike(e);
  const message = text(err.message);
  const code = text(err.code);
  const s = statusOf(err, status);

  if (isUnreachable(e, status)) return new StorageError('unavailable', CLOUD_UNAVAILABLE_MESSAGE);
  if (s === 413 || /payload too large|entitytoolarge|exceeded the maximum allowed size/i.test(`${message} ${code} ${text(err.error)}`)) {
    return new StorageError('too_large', TOO_LARGE_MESSAGE);
  }
  if (s === 401 || code === 'PGRST301' || code === 'PGRST303' || /jwt expired|invalid jwt|session.*(missing|not found)/i.test(message)) {
    return new StorageError('unavailable', SIGNED_OUT_MESSAGE);
  }
  const detail = message || code || 'unknown error';
  return new StorageError('unavailable', `Slapdash's cloud storage refused the request (${detail}).`);
}
