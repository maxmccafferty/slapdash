import { useEffect, useId, useState, type FormEvent } from 'react';
import type { Auth, AuthResult, User } from '@slapdash/storage';
import { PHONE_QUERY } from '../App.tsx';
import { Key } from '../components/Key.tsx';
import { Logo } from '../components/Logo.tsx';
import { useMediaQuery } from '../hooks/useMediaQuery.ts';
import { useSignInStore } from './sign-in-store.ts';
import styles from './SignInCard.module.css';

export const STAY_SIGNED_IN = "You'll stay signed in on this device.";
/** localStorage key: this device has answered the passkey offer. */
export const PASSKEY_OFFER_KEY = 'slapdash.passkeyOffer';

type FlagStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface SignInCardProps {
  auth: Auth;
  onSignedIn: (user: User) => void;
  /** Where the passkey offer's answer is remembered. Default `localStorage`. */
  storage?: FlagStorage | null;
}

const set = useSignInStore.setState;

function defaultStorage(): FlagStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The sign-in card (ADR-0003 §K3), hosted copies only: a plain white unit over the dotted
 * floor with email and password, or a passkey. No sign-up and no reset link: the owner is
 * added on the server. After a first password sign-in on a device that can use passkeys it
 * offers to add one — the only place a passkey is registered, since there is no settings
 * screen.
 */
export function SignInCard({ auth, onSignedIn, storage }: SignInCardProps) {
  const titleId = useId();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const phase = useSignInStore((s) => s.phase);
  const message = useSignInStore((s) => s.message);
  const user = useSignInStore((s) => s.user);
  const registering = useSignInStore((s) => s.registering);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const flags = storage === undefined ? defaultStorage() : storage;
  const passkeys = auth.passkeys?.supported() ? auth.passkeys : null;
  const busy = phase === 'busy';

  const finish = (signedIn: User) => {
    set({ phase: 'idle', message: null, user: null, registering: false });
    onSignedIn(signedIn);
  };

  const answerOffer = () => {
    try {
      flags?.setItem(PASSKEY_OFFER_KEY, 'answered');
    } catch {
      // Private mode: the offer may show again next time.
    }
  };

  const afterPassword = (res: AuthResult) => {
    if (!res.ok) {
      set({ phase: 'error', message: res.error });
      return;
    }
    let answered = true;
    try {
      answered = flags?.getItem(PASSKEY_OFFER_KEY) != null;
    } catch {
      answered = true;
    }
    if (passkeys && flags && !answered) set({ phase: 'offer-passkey', message: null, user: res.user });
    else finish(res.user);
  };

  // Conditional UI: where the browser supports it, the email field's autofill offers the
  // passkey (iOS shows it above the keyboard). A cancelled or replaced request is ignored.
  useEffect(() => {
    if (!passkeys) return;
    const pkc = globalThis.PublicKeyCredential as { isConditionalMediationAvailable?: () => Promise<boolean> } | undefined;
    let live = true;
    void (async () => {
      try {
        if (!(await pkc?.isConditionalMediationAvailable?.())) return;
        const res = await auth.signIn({ kind: 'passkey', conditional: true });
        if (live && res.ok && useSignInStore.getState().phase !== 'offer-passkey') finish(res.user);
      } catch {
        // Not offered: the keys still work.
      }
    })();
    return () => {
      live = false;
    };
    // Once per card (finish only reads the store and the callback).
  }, [auth]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) {
      set({ phase: 'error', message: 'Enter your email and password.' });
      return;
    }
    set({ phase: 'busy', message: null });
    afterPassword(await auth.signIn({ kind: 'password', email: email.trim(), password }));
  };

  const withPasskey = async () => {
    if (busy) return;
    set({ phase: 'busy', message: null });
    const res = await auth.signIn({ kind: 'passkey' });
    if (res.ok) finish(res.user);
    else set({ phase: 'error', message: res.error });
  };

  const addPasskey = async () => {
    if (!passkeys || !user || registering) return;
    set({ registering: true, message: null });
    const res = await passkeys.register();
    if (res.ok) {
      answerOffer();
      finish(user);
    } else {
      set({ registering: false, message: res.error });
    }
  };

  const notNow = () => {
    if (!user) return;
    answerOffer();
    finish(user);
  };

  return (
    <div className={styles.screen} data-testid="sign-in">
      <main className={styles.card} aria-labelledby={titleId}>
        {!isPhone && (
          <div className={styles.logo}>
            <Logo />
          </div>
        )}
        {phase === 'offer-passkey' && user ? (
          <>
            <h1 id={titleId} className={styles.title}>
              Use Face ID or a passkey next time?
            </h1>
            <p className={styles.line}>
              A passkey signs you in on this device without your password{user.email ? ` (${user.email})` : ''}.
            </p>
            <div className={styles.keys}>
              <Key className={styles.primary} tone="dark" label={registering ? 'Adding passkey…' : 'Add passkey'} icon="passkey" disabled={registering} onClick={() => void addPasskey()} />
              <Key className={styles.wide} label="Not now" disabled={registering} onClick={notNow} />
            </div>
          </>
        ) : (
          <>
            <h1 id={titleId} className={styles.title}>
              Sign in
            </h1>
            <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
              <label className={styles.label}>
                Email
                <input
                  className={styles.field}
                  type="email"
                  name="email"
                  autoComplete="username webauthn"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  disabled={busy}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                />
              </label>
              <label className={styles.label}>
                Password
                <input
                  className={styles.field}
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  disabled={busy}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                />
              </label>
              <Key className={styles.primary} type="submit" tone="dark" label={busy ? 'Signing in…' : 'Sign in'} disabled={busy} />
            </form>
            {passkeys && <Key className={styles.wide} label="Sign in with a passkey" icon="passkey" disabled={busy} onClick={() => void withPasskey()} />}
            <p className={styles.line}>{STAY_SIGNED_IN}</p>
          </>
        )}
        <p className={styles.alert} role="alert">
          {message}
        </p>
      </main>
    </div>
  );
}
