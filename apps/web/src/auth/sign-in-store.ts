/**
 * The sign-in card's state (ADR-0003 §K3). `offer-passkey` is the step after a first password
 * sign-in on a device that can use passkeys: "Use Face ID or a passkey next time?".
 */
import { create } from 'zustand';
import type { User } from '@slapdash/storage';

export type SignInPhase = 'idle' | 'busy' | 'error' | 'offer-passkey';

export interface SignInState {
  phase: SignInPhase;
  /** A plain sentence for the alert line, or null. */
  message: string | null;
  /** Who signed in, while the passkey offer shows. */
  user: User | null;
  /** The offer is waiting on the passkey prompt. */
  registering: boolean;
}

export const initialSignInState: SignInState = { phase: 'idle', message: null, user: null, registering: false };

export const useSignInStore = create<SignInState>()(() => ({ ...initialSignInState }));

export function resetSignInStore(): void {
  useSignInStore.setState(initialSignInState, true);
}
