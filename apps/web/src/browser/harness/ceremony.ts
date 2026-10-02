// Vault-origin controller for the passkey ceremony route. The ceremony runs in
// a short top-level pop-up at the vault origin; the pop-up reports back to the
// vault frame over a same-origin channel and closes. This controller carries
// STATUS only. In development the pop-up is a fixture and approves nothing real.

import type { CeremonyState, CeremonyStatus } from '../../../../../core/src/cmsg.js';

export interface ResultChannel {
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

export interface CeremonyDeps {
  /** Opens the pop-up synchronously inside a user gesture; null when blocked. */
  open: (nonce: string) => { closed: boolean; close(): void } | null;
  channel: ResultChannel;
  emit: (status: CeremonyStatus) => void;
  timeoutMillis: number;
  pollMillis?: number;
  nonce?: () => string;
}

export const CEREMONY_CHANNEL = 'cmeet-ceremony';

export interface Ceremony {
  /** Asks for a ceremony; resolves on success, rejects on timeout or failure. */
  require(): Promise<void>;
  /** Must be called from a click handler: opens the pop-up synchronously. */
  continueInPopup(): void;
  state(): CeremonyState;
  dispose(): void;
}

function randomNonce(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createCeremony(deps: CeremonyDeps): Ceremony {
  const makeNonce = deps.nonce ?? randomNonce;
  let state: CeremonyState = 'idle';
  let nonce = '';
  let pending: Promise<void> | null = null;
  let settle: { resolve: () => void; reject: (error: Error) => void } | null = null;
  let popup: { closed: boolean; close(): void } | null = null;
  let watch: ReturnType<typeof setInterval> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;

  function set(next: CeremonyState) {
    state = next;
    deps.emit({ state: next });
  }

  function clearTimers() {
    if (watch !== null) clearInterval(watch);
    if (deadline !== null) clearTimeout(deadline);
    watch = null;
    deadline = null;
  }

  function finish(error?: Error) {
    clearTimers();
    nonce = '';
    popup = null;
    const current = settle;
    settle = null;
    pending = null;
    if (error) current?.reject(error);
    else current?.resolve();
  }

  deps.channel.onmessage = (event) => {
    const data = event.data as { type?: string; nonce?: string; status?: string } | null;
    // One result per request: a stale, foreign or repeated message is ignored.
    if (!data || data.type !== 'result' || nonce === '' || data.nonce !== nonce) return;
    if (data.status === 'approved') {
      set('done');
      finish();
    } else {
      popup = null;
      set('cancelled');
    }
  };

  return {
    require() {
      if (pending) return pending;
      nonce = makeNonce();
      pending = new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
      deadline = setTimeout(() => {
        popup?.close();
        set('timeout');
        finish(new Error('The sign-in took too long. Try again.'));
      }, deps.timeoutMillis);
      set('continue-needed');
      return pending;
    },

    continueInPopup() {
      if (pending === null || !(state === 'continue-needed' || state === 'blocked' || state === 'cancelled')) return;
      const opened = deps.open(nonce);
      if (opened === null) {
        set('blocked');
        return;
      }
      popup = opened;
      set('popup-open');
      if (watch !== null) clearInterval(watch);
      watch = setInterval(() => {
        if (popup !== null && popup.closed && state === 'popup-open') {
          popup = null;
          set('cancelled');
        }
      }, deps.pollMillis ?? 400);
    },

    state: () => state,

    dispose() {
      clearTimers();
      popup?.close();
      deps.channel.close();
      const current = settle;
      settle = null;
      pending = null;
      current?.reject(new Error('The sign-in was closed.'));
    },
  };
}
