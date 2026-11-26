import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Auth, AuthResult, SignInCredentials, User } from '@slapdash/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PASSKEY_OFFER_KEY, SignInCard, STAY_SIGNED_IN } from '../../src/auth/SignInCard.tsx';
import { resetSignInStore } from '../../src/auth/sign-in-store.ts';
import { setViewportWidth } from '../setup.ts';

const OWNER: User = { id: 'u1', displayName: 'max@example.com', email: 'max@example.com' };

function fakeAuth(opts: { passkeys?: boolean; register?: AuthResult } = {}) {
  const calls: SignInCredentials[] = [];
  const register = vi.fn(async (): Promise<AuthResult> => opts.register ?? { ok: true, user: OWNER });
  const auth: Auth = {
    requiresSignIn: true,
    currentUser: async () => null,
    signIn: vi.fn(async (c: SignInCredentials): Promise<AuthResult> => {
      calls.push(c);
      if (c.kind === 'passkey') return { ok: true, user: OWNER };
      return c.password === 'right' ? { ok: true, user: OWNER } : { ok: false, error: "That email and password don't match." };
    }),
    signOut: async () => {},
    onChange: () => () => {},
    ...(opts.passkeys ? { passkeys: { supported: () => true, register } } : {}),
  };
  return { auth, calls, register };
}

function memoryFlags(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}

beforeEach(() => resetSignInStore());
afterEach(() => vi.unstubAllGlobals());

async function typeCredentials(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('the sign-in card (ADR-0003 §K3)', () => {
  it('shows email, password, Sign in, the passkey key and the stay-signed-in line; no sign-up or reset', () => {
    render(<SignInCard auth={fakeAuth({ passkeys: true }).auth} onSignedIn={() => {}} storage={memoryFlags()} />);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username webauthn');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute('type', 'submit');
    expect(screen.getByRole('button', { name: 'Sign in with a passkey' })).toBeInTheDocument();
    expect(screen.getByText(STAY_SIGNED_IN)).toBeInTheDocument();
    expect(screen.queryByText(/sign up|create an account|forgot|reset/i)).toBeNull();
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.getByRole('img', { name: 'slapdash' })).toBeInTheDocument();
  });

  it('hides the passkey key where passkeys are not supported, and the logo on phones', () => {
    setViewportWidth(390);
    render(<SignInCard auth={fakeAuth().auth} onSignedIn={() => {}} storage={memoryFlags()} />);
    expect(screen.queryByRole('button', { name: 'Sign in with a passkey' })).toBeNull();
    expect(screen.queryByRole('img', { name: 'slapdash' })).toBeNull();
  });

  it('a wrong password shows the plain message in an alert', async () => {
    const onSignedIn = vi.fn();
    render(<SignInCard auth={fakeAuth().auth} onSignedIn={onSignedIn} storage={memoryFlags()} />);
    await typeCredentials('max@example.com', 'wrong');
    expect(await screen.findByRole('alert')).toHaveTextContent("That email and password don't match.");
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('empty fields ask for both without calling the server', async () => {
    const { auth } = fakeAuth();
    render(<SignInCard auth={auth} onSignedIn={() => {}} storage={memoryFlags()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your email and password.');
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('a right password signs in (no passkey support: straight to the app)', async () => {
    const onSignedIn = vi.fn();
    const fake = fakeAuth();
    render(<SignInCard auth={fake.auth} onSignedIn={onSignedIn} storage={memoryFlags()} />);
    await typeCredentials(' max@example.com ', 'right');
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(OWNER));
    expect(fake.calls).toEqual([{ kind: 'password', email: 'max@example.com', password: 'right' }]);
  });

  it('after a first password sign-in it offers a passkey; Add passkey registers one and continues', async () => {
    const onSignedIn = vi.fn();
    const flags = memoryFlags();
    const fake = fakeAuth({ passkeys: true });
    render(<SignInCard auth={fake.auth} onSignedIn={onSignedIn} storage={flags} />);
    await typeCredentials('max@example.com', 'right');
    expect(await screen.findByRole('heading', { name: 'Use Face ID or a passkey next time?' })).toBeInTheDocument();
    expect(onSignedIn).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add passkey' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(OWNER));
    expect(fake.register).toHaveBeenCalledTimes(1);
    expect(flags.map.get(PASSKEY_OFFER_KEY)).toBe('answered');
  });

  it('Not now continues without a passkey and the offer is not shown again', async () => {
    const onSignedIn = vi.fn();
    const flags = memoryFlags();
    const fake = fakeAuth({ passkeys: true });
    const { unmount } = render(<SignInCard auth={fake.auth} onSignedIn={onSignedIn} storage={flags} />);
    await typeCredentials('max@example.com', 'right');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Not now' }));
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(fake.register).not.toHaveBeenCalled();
    unmount();
    resetSignInStore();

    const again = vi.fn();
    render(<SignInCard auth={fake.auth} onSignedIn={again} storage={flags} />);
    await typeCredentials('max@example.com', 'right');
    await waitFor(() => expect(again).toHaveBeenCalledWith(OWNER));
  });

  it('a failed registration says so and keeps the offer open', async () => {
    const fake = fakeAuth({ passkeys: true, register: { ok: false, error: "The passkey wasn't added. You can still sign in with your password." } });
    render(<SignInCard auth={fake.auth} onSignedIn={() => {}} storage={memoryFlags()} />);
    await typeCredentials('max@example.com', 'right');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Add passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("The passkey wasn't added.");
    expect(screen.getByRole('button', { name: 'Not now' })).toBeEnabled();
  });

  it('Sign in with a passkey signs in without the fields', async () => {
    const onSignedIn = vi.fn();
    const fake = fakeAuth({ passkeys: true });
    render(<SignInCard auth={fake.auth} onSignedIn={onSignedIn} storage={memoryFlags()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in with a passkey' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(OWNER));
    expect(fake.calls).toEqual([{ kind: 'passkey' }]);
  });

  it('offers the passkey from autofill where the browser supports conditional UI', async () => {
    vi.stubGlobal('PublicKeyCredential', { isConditionalMediationAvailable: async () => true });
    const onSignedIn = vi.fn();
    const fake = fakeAuth({ passkeys: true });
    render(<SignInCard auth={fake.auth} onSignedIn={onSignedIn} storage={memoryFlags()} />);
    await waitFor(() => expect(fake.calls).toContainEqual({ kind: 'passkey', conditional: true }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(OWNER));
  });
});
