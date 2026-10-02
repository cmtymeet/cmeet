// Development-only transport over one MessagePort between the UI (top-level
// origin) and the vault frame. It carries typed cmsg calls and events of the
// DEVELOPMENT adapter only: no secrets, no raw buffers, no generic channel.
// Production uses the generated bridge instead; this file is never imported
// from a production code path.

import type { CmsgClient, CmsgEvent } from '../../../../../core/src/cmsg.js';

export const HARNESS_PROTOCOL = 'cmeet-dev-harness-1';
export const MAX_ARGS = 8;

type Call = { id: number; method: string; args: unknown[] };
type Reply = { id: number; ok: true; value: unknown } | { id: number; ok: false; message: string };
type Push = { event: CmsgEvent };
type Control = { subscribe: true } | { dispose: true };

/** Methods the vault owns; the client may call any other typed method. */
const LOCAL_ONLY = new Set(['subscribe']);

export interface ServeOptions {
  /** Called before a method runs; may require a passkey ceremony first. */
  before?: (method: string) => Promise<void>;
}

export function isCall(data: unknown): data is Call {
  if (typeof data !== 'object' || data === null) return false;
  const call = data as Record<string, unknown>;
  return Number.isSafeInteger(call.id) && typeof call.method === 'string' && Array.isArray(call.args) && call.args.length <= MAX_ARGS;
}

/** Vault side: answers calls on the port with strictly increasing ids. */
export function serveVault(port: MessagePort, client: CmsgClient, options: ServeOptions = {}): () => void {
  let lastId = 0;
  let unsubscribe: (() => void) | null = null;
  const api = client as unknown as Record<string, unknown>;

  function reply(message: Reply) {
    port.postMessage(message);
  }

  async function run(call: Call) {
    const method = api[call.method];
    if (LOCAL_ONLY.has(call.method) || !Object.prototype.hasOwnProperty.call(api, call.method) || typeof method !== 'function') {
      reply({ id: call.id, ok: false, message: 'Unknown operation.' });
      return;
    }
    try {
      await options.before?.(call.method);
      const value = await (method as (...args: unknown[]) => Promise<unknown>).apply(client, call.args);
      reply({ id: call.id, ok: true, value });
    } catch (error) {
      reply({ id: call.id, ok: false, message: error instanceof Error ? error.message : 'The vault refused the request.' });
    }
  }

  function stop() {
    unsubscribe?.();
    unsubscribe = null;
    port.onmessage = null;
    port.close();
  }

  port.onmessage = (message: MessageEvent) => {
    const data = message.data as unknown;
    if (isCall(data)) {
      if (data.id <= lastId) {
        reply({ id: data.id, ok: false, message: 'Replayed request refused.' });
        return;
      }
      lastId = data.id;
      void run(data);
      return;
    }
    const control = data as { subscribe?: unknown; dispose?: unknown } | null;
    if (control?.subscribe === true && unsubscribe === null) {
      unsubscribe = client.subscribe((event) => port.postMessage({ event } satisfies Push));
    } else if (control?.dispose === true) {
      stop();
    }
  };
  return stop;
}

export interface ConnectOptions {
  timeoutMillis: number;
}

export interface HarnessConnection {
  client: CmsgClient;
  /** Closes the port and fails every pending call. */
  dispose(): void;
}

/** UI side: a typed client whose every method is one bounded request. */
export function connectVault(port: MessagePort, options: ConnectOptions): HarnessConnection {
  let nextId = 0;
  let closed = false;
  let subscribed = false;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const handlers = new Set<(event: CmsgEvent) => void>();

  port.onmessage = (message: MessageEvent) => {
    const data = message.data as Partial<Reply> & Partial<Push>;
    if (data && typeof data === 'object' && 'event' in data && data.event) {
      for (const handler of [...handlers]) handler(data.event);
      return;
    }
    if (!data || typeof data.id !== 'number') return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    clearTimeout(entry.timer);
    if (data.ok === true) entry.resolve((data as { value: unknown }).value);
    else entry.reject(new Error((data as { message: string }).message));
  };

  function call(method: string, args: unknown[]): Promise<unknown> {
    if (closed) return Promise.reject(new Error('The vault connection is closed.'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('The vault did not answer in time.'));
      }, options.timeoutMillis);
      pending.set(id, { resolve, reject, timer });
      port.postMessage({ id, method, args } satisfies Call);
    });
  }

  function subscribe(handler: (event: CmsgEvent) => void): () => void {
    handlers.add(handler);
    if (!subscribed && !closed) {
      subscribed = true;
      port.postMessage({ subscribe: true } satisfies Control);
    }
    return () => { handlers.delete(handler); };
  }

  const client = new Proxy({} as Record<string, unknown>, {
    get(_target, name) {
      if (typeof name !== 'string' || name === 'then') return undefined;
      if (name === 'subscribe') return subscribe;
      return (...args: unknown[]) => call(name, args);
    },
  }) as unknown as CmsgClient;

  return {
    client,
    dispose() {
      if (closed) return;
      closed = true;
      port.postMessage({ dispose: true } satisfies Control);
      port.onmessage = null;
      port.close();
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('The vault connection is closed.'));
      }
      pending.clear();
      handlers.clear();
    },
  };
}
