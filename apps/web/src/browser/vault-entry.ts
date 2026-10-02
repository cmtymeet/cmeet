// Entry for the vault origin (vault.<community>.<base>). One bundle serves both
// hosts; the host name selects the entry. The vault origin shows only the vault
// frame, the short sign-in pop-up route, or an honest "unavailable" page. It
// never mounts the member app.

import { mount } from 'svelte';
import VaultFrame from '../views/VaultFrame.svelte';
import VaultCeremony from '../views/VaultCeremony.svelte';
import { memberOriginOf } from './origins.js';
import type { CeremonyState } from '../../../../core/src/cmsg.js';

export const POPUP_PREFIX = '#/ceremony/';

const TIMEOUT_MILLIS = 120_000;

export async function mountVault(target: HTMLElement, win: Window = window): Promise<unknown> {
  const popup = win.location.hash.startsWith(POPUP_PREFIX);
  const nonce = popup ? decodeURIComponent(win.location.hash.slice(POPUP_PREFIX.length)) : '';

  // Production: the runtime-owned ceremony and vault are not wired yet. Nothing
  // below runs, nothing is simulated, and no success is ever shown.
  if (!import.meta.env.DEV) {
    return popup
      ? mount(VaultCeremony, { target, props: { answer: null, nonce } })
      : mount(VaultFrame, { target, props: { ceremony: null, watch: () => {} } });
  }

  const { CEREMONY_CHANNEL, createCeremony } = await import('./harness/ceremony.js');
  if (popup) {
    return mount(VaultCeremony, {
      target,
      props: {
        nonce,
        answer: (status) => {
          const channel = new BroadcastChannel(CEREMONY_CHANNEL);
          channel.postMessage({ type: 'result', nonce, status });
          channel.close();
          win.close();
        },
      },
    });
  }

  const memberOrigin = memberOriginOf(win.location.origin, { allowInsecureLocal: true });
  if (memberOrigin === null || win.parent === win) {
    return mount(VaultFrame, { target, props: { ceremony: null, watch: () => {} } });
  }
  const { createDevCmsg } = await import('../../../../core/src/dev-adapter.js');
  const { startFrame } = await import('./harness/frame.js');
  const { READY_MESSAGE } = await import('./harness/client.js');
  let listener: ((state: CeremonyState) => void) | null = null;
  let frame: ReturnType<typeof startFrame> | null = null;
  const channel = new BroadcastChannel(CEREMONY_CHANNEL);
  const ceremony = createCeremony({
    channel,
    timeoutMillis: TIMEOUT_MILLIS,
    open: (nonceValue) => win.open(`${win.location.origin}/${POPUP_PREFIX}${encodeURIComponent(nonceValue)}`, 'cmeet-ceremony', 'popup,width=420,height=520'),
    emit: (status) => {
      listener?.(status.state);
      frame?.report(status);
    },
  });
  frame = startFrame({
    win,
    memberOrigin,
    client: createDevCmsg(),
    ceremony,
    announce: () => win.parent.postMessage(READY_MESSAGE, memberOrigin),
  });
  return mount(VaultFrame, { target, props: { ceremony, watch: (next) => { listener = next; } } });
}
