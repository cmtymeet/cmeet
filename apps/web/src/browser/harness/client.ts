// UI side of the development harness: creates the exact configured vault frame,
// waits for its ready announcement from the exact vault origin and window, then
// transfers one MessageChannel. Opt-in only (DEV, ?dev-vault=1); production uses
// the generated bridge. The UI never receives keys or ceremony payloads.

import type { CmsgClient } from '../../../../../core/src/cmsg.js';
import type { VaultOrigins } from '../origins.js';
import { HARNESS_PROTOCOL, connectVault } from './rpc.js';

export interface HarnessConfig {
  origins: VaultOrigins;
  timeoutMillis: number;
}

export interface HarnessSession {
  client: CmsgClient;
  dispose(): Promise<void>;
}

export const READY_MESSAGE = { ready: HARNESS_PROTOCOL } as const;

export async function createHarnessSession(config: HarnessConfig, doc: Document = document): Promise<HarnessSession> {
  const { origins, timeoutMillis } = config;
  if (window.parent !== window || window.location.origin !== origins.member_origin) {
    throw new Error('The vault frame can only be opened by the top-level member page.');
  }
  const frame = doc.createElement('iframe');
  frame.title = 'Secure vault';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.src = origins.vault_url;
  frame.className = 'vault-frame';

  const connection = await new Promise<ReturnType<typeof connectVault>>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('The vault did not start in time.'));
    }, timeoutMillis);
    function onMessage(event: MessageEvent) {
      const data = event.data as { ready?: unknown } | null;
      if (event.origin !== origins.vault_origin || event.source !== frame.contentWindow || data?.ready !== HARNESS_PROTOCOL) return;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      const channel = new MessageChannel();
      frame.contentWindow!.postMessage({ hello: HARNESS_PROTOCOL }, origins.vault_origin, [channel.port2]);
      resolve(connectVault(channel.port1, { timeoutMillis }));
    }
    window.addEventListener('message', onMessage);
    (doc.getElementById('vault-frame-host') ?? doc.body).append(frame);
  });

  return {
    client: connection.client,
    async dispose() {
      connection.dispose();
      frame.remove();
    },
  };
}
