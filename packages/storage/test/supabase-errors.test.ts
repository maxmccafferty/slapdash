/** The Supabase error mapping, without a network. */
import { describe, expect, it } from 'vitest';
import { SIGN_IN_MESSAGES, signInError } from '../src/adapters/supabase/auth.ts';
import { CLOUD_UNAVAILABLE_MESSAGE, SIGNED_OUT_MESSAGE, toStorageError } from '../src/adapters/supabase/errors.ts';
import { objectPath, pathSegment } from '../src/adapters/supabase/store.ts';
import { StorageError } from '../src/errors.ts';

describe('toStorageError', () => {
  it.each([
    ['a failed fetch', new TypeError('fetch failed'), undefined],
    ['PostgREST reporting a fetch failure (status 0)', { message: 'TypeError: fetch failed', code: '' }, 0],
    ['a timeout', Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }), undefined],
    ['a paused project (540)', { message: 'Project paused' }, 540],
    ['a 503', { message: 'Service Unavailable' }, 503],
    ['"project is paused" in the message', { message: 'This project is paused' }, 400],
  ])('%s → unavailable with the paused message', (_name, error, status) => {
    const e = toStorageError(error, status);
    expect(e).toBeInstanceOf(StorageError);
    expect(e.code).toBe('unavailable');
    expect(e.message).toBe(CLOUD_UNAVAILABLE_MESSAGE);
    expect(e.message).toMatch(/saved on this device/);
  });

  it('413 and EntityTooLarge → too_large', () => {
    expect(toStorageError({ message: 'Payload too large' }, 413).code).toBe('too_large');
    expect(toStorageError({ statusCode: '413', error: 'EntityTooLarge', message: 'The object exceeded the maximum allowed size' }).code).toBe('too_large');
  });

  it('an expired session → unavailable with the signed-out message', () => {
    expect(toStorageError({ code: 'PGRST301', message: 'JWT expired' }, 401).message).toBe(SIGNED_OUT_MESSAGE);
    expect(toStorageError({ message: 'JWT expired' }).message).toBe(SIGNED_OUT_MESSAGE);
  });

  it('anything else → unavailable with the detail', () => {
    const e = toStorageError({ code: '42501', message: 'permission denied for table projects' }, 403);
    expect(e.code).toBe('unavailable');
    expect(e.message).toContain('permission denied for table projects');
  });

  it('passes StorageErrors through', () => {
    const original = new StorageError('invalid', 'bad');
    expect(toStorageError(original)).toBe(original);
  });
});

describe('signInError', () => {
  it('maps the documented codes to plain sentences', () => {
    expect(signInError({ code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 }, 'password')).toBe(SIGN_IN_MESSAGES.invalidCredentials);
    expect(signInError({ code: 'webauthn_credential_not_found', status: 404 }, 'passkey')).toBe(SIGN_IN_MESSAGES.noPasskey);
    expect(signInError({ code: 'passkey_disabled', status: 422 }, 'passkey')).toBe(SIGN_IN_MESSAGES.passkeysOff);
    expect(signInError({ name: 'WebAuthnError', code: 'ERROR_CEREMONY_ABORTED', message: 'aborted' }, 'passkey')).toBe(SIGN_IN_MESSAGES.cancelled);
    expect(signInError(Object.assign(new Error('x'), { name: 'NotAllowedError' }), 'passkey')).toBe(SIGN_IN_MESSAGES.cancelled);
    expect(signInError({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 }, 'password')).toBe(SIGN_IN_MESSAGES.unreachable);
    expect(signInError(Object.assign(new Error('x'), { name: 'NotAllowedError' }), 'register')).toBe(SIGN_IN_MESSAGES.passkeyNotSaved);
  });
});

describe('storage paths', () => {
  it('keeps plain ids and encodes anything else without % signs', () => {
    expect(pathSegment('3f2a-uuid_1')).toBe('3f2a-uuid_1');
    expect(pathSegment('a/b c%')).toMatch(/^b64\.[A-Za-z0-9_-]+$/);
    expect(pathSegment('a.b')).not.toBe('a.b');
    expect(objectPath('u1', 'p1', 'thumbnail')).toBe('u1/p1/thumbnail');
  });
});
