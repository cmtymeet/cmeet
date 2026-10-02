// Vault-frame side of the development harness. Runs only at the vault origin,
// only as a non-top-level frame, and binds exactly one MessageChannel from the
// exact member origin and its parent window. No rebind is possible.

import type { CmsgClient } from '../../../../../core/src/cmsg.js';
import type { Ceremony } from './ceremony.js';
import { HARNESS_PROTOCOL, serveVault } from './rpc.js';

/** Operations that need the passkey ceremony before they run. */
export const CEREMONY_METHODS = new Set(['joinWithVoucher', 'signIn', 'signInRole']);

export interface HelloEvent {
  origin: string;
  source: unknown;
  data: unknown;
  ports: readonly MessagePort[];
}

/** Returns the transferred port only for the exact member origin and parent. */
export function acceptHello(event: HelloEvent, memberOrigin: string, parent: unknown): MessagePort | null {
  if (event.origin !== memberOrigin || event.source !== parent) return null;
  const data = event.data as { hello?: unknown } | null;
  if (!data || data.hello !== HARNESS_PROTOCOL || event.ports.length !== 1) return null;
  return event.ports[0] ?? null;
}

export interface FrameWindow {
  parent: unknown;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

export interface FrameDeps {
  win: FrameWindow & { top: unknown };
  /** Sends the ready announcement to the parent at its exact origin. */
  announce: () => void;
  memberOrigin: string;
  client: CmsgClient;
  ceremony: Ceremony;
}

export interface Frame {
  /** Forwards a ceremony status to the bound UI (status only). */
  report(status: { state: string }): void;
  dispose(): void;
}

export function startFrame(deps: FrameDeps): Frame {
  if (deps.win.parent === deps.win) throw new Error('The vault must run inside the member page.');
  let bound: MessagePort | null = null;
  let stop: (() => void) | null = null;

  const listener = (event: MessageEvent) => {
    if (bound !== null) return;
    const port = acceptHello(event, deps.memberOrigin, deps.win.parent);
    if (port === null) return;
    bound = port;
    stop = serveVault(port, deps.client, {
      before: (method) => (CEREMONY_METHODS.has(method) ? deps.ceremony.require() : Promise.resolve()),
    });
  };
  deps.win.addEventListener('message', listener);
  deps.announce();

  return {
    report(status) {
      bound?.postMessage({ event: { type: 'ceremony', status } });
    },
    dispose() {
      deps.win.removeEventListener('message', listener);
      stop?.();
      deps.ceremony.dispose();
    },
  };
}
