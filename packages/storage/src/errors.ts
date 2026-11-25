/** A remote backend is down, paused or unreachable. Work stays on the device and syncs later. */
export const CLOUD_UNAVAILABLE_MESSAGE =
  "Slapdash's cloud storage isn't answering. If it's on Supabase's free tier it may be paused after a quiet week; your work is saved on this device and will sync when it's back.";

export type StorageErrorCode = 'invalid' | 'not_found' | 'unavailable' | 'too_large';

/** A storage failure with a plain-language message that can be shown to the user as is. */
export class StorageError extends Error {
  override readonly name = 'StorageError';
  readonly code: StorageErrorCode;
  /** Individual problems, for `invalid`. */
  readonly details: readonly string[];

  constructor(code: StorageErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function isStorageError(e: unknown): e is StorageError {
  return e instanceof StorageError;
}

/** A user-facing sentence for any thrown value. */
export function describeError(e: unknown): string {
  if (e instanceof StorageError) return e.message;
  const detail = e instanceof Error ? e.message : String(e);
  return `Something went wrong with storage (${detail}).`;
}
