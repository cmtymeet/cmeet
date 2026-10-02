import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectVault, isCall, serveVault, HARNESS_PROTOCOL } from '../../src/browser/harness/rpc.js';
import { acceptHello, startFrame, CEREMONY_METHODS } from '../../src/browser/harness/frame.js';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { CmsgClient, CmsgEvent } from '../../../../core/src/cmsg.js';

const closers: (() => void)[] = [];
afterEach(() => { while (closers.length) closers.pop()!(); });

function pair(client: CmsgClient, options: Parameters<typeof serveVault>[2] = {}, timeoutMillis = 2000) {
  const channel = new MessageChannel();
  closers.push(serveVault(channel.port2, client, options));
  const connection = connectVault(channel.port1, { timeoutMillis });
  closers.push(() => connection.dispose());
  return { channel, connection };
}

describe('development vault transport', () => {
  it('answers typed calls from the real development adapter and delivers events', async () => {
    const { connection } = pair(createDevCmsg());
    const status = await connection.client.connectionStatus();
    expect(status.phase).toBeDefined();
    const events: CmsgEvent[] = [];
    const off = connection.client.subscribe((event) => events.push(event));
    connection.client.subscribe(() => {});
    await connection.client.connect();
    await vi.waitFor(() => expect(events.some((event) => event.type === 'connection')).toBe(true));
    off();
    await expect(connection.client.joinWithVoucher({ voucher: 'bad', handle: 'x' })).rejects.toThrow('voucher');
    expect((connection.client as unknown as { then?: unknown }).then).toBeUndefined();
    expect(typeof (connection.client as unknown as Record<symbol, unknown>)[Symbol.iterator]).toBe('undefined');
  });

  it('refuses unknown operations, replayed ids and oversized argument lists', async () => {
    const channel = new MessageChannel();
    closers.push(serveVault(channel.port2, createDevCmsg()));
    const replies: { id: number; ok: boolean; message?: string }[] = [];
    channel.port1.onmessage = (event) => replies.push(event.data);
    closers.push(() => channel.port1.close());
    channel.port1.postMessage({ id: 1, method: 'nonsense', args: [] });
    channel.port1.postMessage({ id: 2, method: 'subscribe', args: [] });
    channel.port1.postMessage({ id: 3, method: 'toString', args: [] });
    channel.port1.postMessage({ id: 3, method: 'connectionStatus', args: [] });
    channel.port1.postMessage({ id: 4, method: 'connectionStatus', args: new Array(9).fill(0) });
    channel.port1.postMessage('garbage');
    channel.port1.postMessage(null);
    channel.port1.postMessage({ id: 5, method: 'connectionStatus', args: [] });
    await vi.waitFor(() => expect(replies.length).toBeGreaterThanOrEqual(4));
    const byId = new Map(replies.map((reply) => [reply.id, reply]));
    expect(byId.get(1)?.message).toBe('Unknown operation.');
    expect(byId.get(2)?.message).toBe('Unknown operation.');
    expect(byId.get(3)?.message).toBeDefined();
    expect(byId.get(4)).toBeUndefined();
    expect(byId.get(5)?.ok).toBe(true);
  });

  it('validates call shape', () => {
    expect(isCall({ id: 1, method: 'a', args: [] })).toBe(true);
    expect(isCall({ id: 1.5, method: 'a', args: [] })).toBe(false);
    expect(isCall({ id: 1, method: 1, args: [] })).toBe(false);
    expect(isCall({ id: 1, method: 'a', args: 'x' })).toBe(false);
    expect(isCall(null)).toBe(false);
    expect(isCall('x')).toBe(false);
  });

  it('turns a non-error rejection into a generic refusal and runs the before hook', async () => {
    const base = createDevCmsg();
    const failing = { ...base, connect: () => Promise.reject('plain') } as unknown as CmsgClient;
    const before = vi.fn(async () => {});
    const { connection } = pair(failing, { before });
    await expect(connection.client.connect()).rejects.toThrow('refused');
    expect(before).toHaveBeenCalledWith('connect');
  });

  it('times out an unanswered call and rejects pending calls on dispose', async () => {
    vi.useFakeTimers();
    try {
      const channel = new MessageChannel();
      const connection = connectVault(channel.port1, { timeoutMillis: 50 });
      closers.push(() => connection.dispose());
      channel.port2.onmessage = () => {};
      closers.push(() => channel.port2.close());
      const late = connection.client.connectionStatus();
      const caught = late.catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(60);
      expect(await caught).toBe('The vault did not answer in time.');
      const second = connection.client.connectionStatus().catch((error: Error) => error.message);
      connection.dispose();
      connection.dispose();
      expect(await second).toBe('The vault connection is closed.');
      await expect(connection.client.connectionStatus()).rejects.toThrow('closed');
      expect(() => connection.client.subscribe(() => {})).not.toThrow();
    } finally { vi.useRealTimers(); }
  });

  it('ignores stray messages on the client port', async () => {
    const channel = new MessageChannel();
    const connection = connectVault(channel.port1, { timeoutMillis: 1000 });
    closers.push(() => connection.dispose());
    closers.push(() => channel.port2.close());
    channel.port2.postMessage(null);
    channel.port2.postMessage({ nothing: true });
    channel.port2.postMessage({ id: 99, ok: true, value: 1 });
    channel.port2.postMessage({ event: null });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it('stops serving after a dispose control message', async () => {
    const { connection } = pair(createDevCmsg());
    await connection.client.connectionStatus();
    connection.dispose();
  });
});

describe('vault frame binding', () => {
  const parent = {};
  const hello = { hello: HARNESS_PROTOCOL };

  it('accepts only the exact member origin, its parent window and one transferred port', () => {
    const port = new MessageChannel();
    closers.push(() => { port.port1.close(); port.port2.close(); });
    const good = { origin: 'https://anna.cmeet.example', source: parent, data: hello, ports: [port.port1] };
    expect(acceptHello(good, 'https://anna.cmeet.example', parent)).toBe(port.port1);
    expect(acceptHello({ ...good, origin: 'https://evil.cmeet.example' }, 'https://anna.cmeet.example', parent)).toBeNull();
    expect(acceptHello({ ...good, origin: 'https://anna.cmeet.example.evil.test' }, 'https://anna.cmeet.example', parent)).toBeNull();
    expect(acceptHello({ ...good, source: {} }, 'https://anna.cmeet.example', parent)).toBeNull();
    expect(acceptHello({ ...good, data: { hello: 'other' } }, 'https://anna.cmeet.example', parent)).toBeNull();
    expect(acceptHello({ ...good, data: null }, 'https://anna.cmeet.example', parent)).toBeNull();
    expect(acceptHello({ ...good, ports: [] }, 'https://anna.cmeet.example', parent)).toBeNull();
    expect(acceptHello({ ...good, ports: [port.port1, port.port2] }, 'https://anna.cmeet.example', parent)).toBeNull();
  });

  function fakeWindow(top = false) {
    const listeners = new Set<(event: MessageEvent) => void>();
    const win = {
      parent: {} as unknown,
      top: {} as unknown,
      addEventListener: (_: 'message', listener: (event: MessageEvent) => void) => listeners.add(listener),
      removeEventListener: (_: 'message', listener: (event: MessageEvent) => void) => listeners.delete(listener),
    };
    if (top) win.parent = win;
    return { win, listeners };
  }

  it('refuses to run top-level, binds once and requires the ceremony for sign-in operations', async () => {
    expect(() => startFrame({ win: fakeWindow(true).win, announce: () => {}, memberOrigin: 'https://m.example', client: createDevCmsg(), ceremony: {} as never })).toThrow('inside the member page');
    const { win, listeners } = fakeWindow();
    const announce = vi.fn();
    const require = vi.fn(async () => {});
    const ceremony = { require, dispose: vi.fn(), continueInPopup: vi.fn(), state: () => 'idle' as const };
    const frame = startFrame({ win, announce, memberOrigin: 'https://anna.cmeet.example', client: createDevCmsg(), ceremony });
    expect(announce).toHaveBeenCalledTimes(1);
    frame.report({ state: 'idle' });
    const channel = new MessageChannel();
    const send = (event: Partial<MessageEvent>) => [...listeners].forEach((listener) => listener(event as MessageEvent));
    send({ origin: 'https://evil.example', source: win.parent as MessageEventSource, data: { hello: HARNESS_PROTOCOL }, ports: [channel.port2] });
    send({ origin: 'https://anna.cmeet.example', source: win.parent as MessageEventSource, data: { hello: HARNESS_PROTOCOL }, ports: [channel.port2] });
    const second = new MessageChannel();
    send({ origin: 'https://anna.cmeet.example', source: win.parent as MessageEventSource, data: { hello: HARNESS_PROTOCOL }, ports: [second.port2] });
    const connection = connectVault(channel.port1, { timeoutMillis: 1000 });
    const seen: CmsgEvent[] = [];
    connection.client.subscribe((event) => seen.push(event));
    await connection.client.connectionStatus();
    expect(require).not.toHaveBeenCalled();
    await expect(connection.client.signIn()).rejects.toThrow();
    expect(require).toHaveBeenCalledTimes(1);
    frame.report({ state: 'popup-open' });
    await vi.waitFor(() => expect(seen.some((event) => event.type === 'ceremony')).toBe(true));
    expect(CEREMONY_METHODS.has('signIn')).toBe(true);
    connection.dispose();
    frame.dispose();
    expect(listeners.size).toBe(0);
    expect(ceremony.dispose).toHaveBeenCalled();
    second.port1.close();
    second.port2.close();
  });
});
