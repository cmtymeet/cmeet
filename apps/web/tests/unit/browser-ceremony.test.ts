import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { createCeremony, CEREMONY_CHANNEL } from '../../src/browser/harness/ceremony.js';
import { mountVault, POPUP_PREFIX } from '../../src/browser/vault-entry.js';
import VaultFrame from '../../src/views/VaultFrame.svelte';
import VaultCeremony from '../../src/views/VaultCeremony.svelte';
import VaultStatus from '../../src/views/VaultStatus.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { CeremonyState, CmsgEvent } from '../../../../core/src/cmsg.js';

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

function setup(open: () => { closed: boolean; close(): void } | null, timeoutMillis = 10_000) {
  const channel = { onmessage: null as ((event: MessageEvent) => void) | null, close: vi.fn() };
  const statuses: CeremonyState[] = [];
  const ceremony = createCeremony({
    open, channel, timeoutMillis, pollMillis: 10, nonce: () => 'nonce-1',
    emit: (status) => statuses.push(status.state),
  });
  const answer = (data: unknown) => channel.onmessage?.({ data } as MessageEvent);
  return { ceremony, channel, statuses, answer };
}

describe('ceremony controller', () => {
  it('asks, opens the pop-up from the click and completes on one approved result', async () => {
    vi.useFakeTimers();
    const popup = { closed: false, close: vi.fn() };
    const open = vi.fn(() => popup);
    const { ceremony, statuses, answer } = setup(open);
    ceremony.continueInPopup();
    expect(open).not.toHaveBeenCalled();
    const first = ceremony.require();
    expect(ceremony.require()).toBe(first);
    expect(ceremony.state()).toBe('continue-needed');
    ceremony.continueInPopup();
    expect(open).toHaveBeenCalledWith('nonce-1');
    ceremony.continueInPopup();
    expect(open).toHaveBeenCalledTimes(1);
    answer({ type: 'result', nonce: 'wrong', status: 'approved' });
    answer({ type: 'other', nonce: 'nonce-1', status: 'approved' });
    answer(null);
    expect(ceremony.state()).toBe('popup-open');
    answer({ type: 'result', nonce: 'nonce-1', status: 'approved' });
    await first;
    expect(statuses).toEqual(['continue-needed', 'popup-open', 'done']);
    answer({ type: 'result', nonce: 'nonce-1', status: 'approved' });
    expect(statuses.length).toBe(3);
    await vi.advanceTimersByTimeAsync(50);
    expect(statuses.length).toBe(3);
  });

  it('shows blocked, then allows a retry that opens the window', async () => {
    const popup = { closed: false, close: vi.fn() };
    let allow = false;
    const { ceremony, statuses, answer } = setup(() => (allow ? popup : null));
    const waiting = ceremony.require();
    ceremony.continueInPopup();
    expect(ceremony.state()).toBe('blocked');
    allow = true;
    ceremony.continueInPopup();
    expect(ceremony.state()).toBe('popup-open');
    answer({ type: 'result', nonce: 'nonce-1', status: 'approved' });
    await waiting;
    expect(statuses).toEqual(['continue-needed', 'blocked', 'popup-open', 'done']);
  });

  it('reports cancelled for a closed window or a cancel answer and allows a retry', async () => {
    vi.useFakeTimers();
    const popup = { closed: false, close: vi.fn() };
    const { ceremony, statuses, answer } = setup(() => popup);
    const waiting = ceremony.require();
    ceremony.continueInPopup();
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(30);
    expect(ceremony.state()).toBe('cancelled');
    popup.closed = false;
    ceremony.continueInPopup();
    expect(ceremony.state()).toBe('popup-open');
    answer({ type: 'result', nonce: 'nonce-1', status: 'cancelled' });
    expect(ceremony.state()).toBe('cancelled');
    ceremony.continueInPopup();
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(30);
    answer({ type: 'result', nonce: 'nonce-1', status: 'approved' });
    await waiting;
    expect(statuses.filter((state) => state === 'cancelled').length).toBe(3);
  });

  it('keeps polling quiet while the window is open and times out the whole request', async () => {
    vi.useFakeTimers();
    const popup = { closed: false, close: vi.fn() };
    const { ceremony, statuses } = setup(() => popup, 1000);
    const waiting = ceremony.require().catch((error: Error) => error.message);
    ceremony.continueInPopup();
    await vi.advanceTimersByTimeAsync(500);
    expect(ceremony.state()).toBe('popup-open');
    await vi.advanceTimersByTimeAsync(600);
    expect(await waiting).toContain('too long');
    expect(popup.close).toHaveBeenCalled();
    expect(statuses.at(-1)).toBe('timeout');
    const again = ceremony.require();
    expect(ceremony.state()).toBe('continue-needed');
    ceremony.dispose();
    await expect(again).rejects.toThrow('closed');
  });

  it('times out without a pop-up and disposes cleanly with no request', async () => {
    vi.useFakeTimers();
    const { ceremony, channel } = setup(() => null, 100);
    const waiting = ceremony.require().catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(150);
    expect(await waiting).toContain('too long');
    ceremony.dispose();
    expect(channel.close).toHaveBeenCalled();
    const idle = setup(() => null);
    idle.ceremony.dispose();
    const uses = createCeremony({ open: () => null, channel: { onmessage: null, close() {} }, emit() {}, timeoutMillis: 5 });
    const outcome = uses.require().catch(() => 'rejected');
    await vi.advanceTimersByTimeAsync(10);
    expect(await outcome).toBe('rejected');
  });

  it('uses a random nonce by default', () => {
    const seen: string[] = [];
    const channel = { onmessage: null, close() {} };
    const ceremony = createCeremony({ open: (nonce) => { seen.push(nonce); return null; }, channel, emit() {}, timeoutMillis: 1000 });
    void ceremony.require().catch(() => {});
    ceremony.continueInPopup();
    expect(seen[0]).toMatch(/^[0-9a-f]{24}$/);
    ceremony.dispose();
  });
});

function render(component: unknown, props: Record<string, unknown>) {
  const target = document.createElement('div');
  document.body.append(target);
  const view = mount(component as never, { target, props });
  return { target, cleanup: () => { void unmount(view); target.remove(); } };
}

describe('vault views', () => {
  it('shows the frame states and offers Continue only where a click can retry', async () => {
    const continueInPopup = vi.fn();
    let push: (state: CeremonyState) => void = () => {};
    const { target, cleanup } = render(VaultFrame, { ceremony: { continueInPopup }, watch: (listener: (state: CeremonyState) => void) => { push = listener; } });
    try {
      await tick();
      expect(target.textContent).toContain('The vault is ready.');
      expect(target.querySelector('button')).toBeNull();
      push('continue-needed'); await tick();
      expect(target.textContent).toContain('Press Continue');
      target.querySelector('button')!.click();
      expect(continueInPopup).toHaveBeenCalledTimes(1);
      push('popup-open'); await tick();
      expect(target.querySelector('button')).toBeNull();
      push('blocked'); await tick();
      expect(target.querySelector('button')!.textContent).toContain('Try again');
      push('done'); await tick();
      expect(target.textContent).toContain('Sign-in complete.');
    } finally { cleanup(); }
  });

  it('is honestly unavailable without a runtime', async () => {
    const frame = render(VaultFrame, { ceremony: null, watch: () => {} });
    await tick();
    expect(frame.target.textContent).toContain('not available yet');
    expect(frame.target.querySelector('button')).toBeNull();
    frame.cleanup();
    const popup = render(VaultCeremony, { answer: null, nonce: 'x' });
    await tick();
    expect(popup.target.textContent).toContain('not available yet');
    expect(popup.target.querySelector('button')).toBeNull();
    popup.cleanup();
    const missing = render(VaultCeremony, { answer: () => {}, nonce: '' });
    await tick();
    expect(missing.target.textContent).toContain('without a sign-in request');
    missing.cleanup();
  });

  it('answers from the fixture pop-up with a status only', async () => {
    const answer = vi.fn();
    const { target, cleanup } = render(VaultCeremony, { answer, nonce: 'n' });
    try {
      await tick();
      expect(target.textContent).toContain('approves nothing real');
      const [approve, cancel] = [...target.querySelectorAll('button')];
      approve!.click();
      cancel!.click();
      expect(answer.mock.calls).toEqual([['approved'], ['cancelled']]);
    } finally { cleanup(); }
  });

  it('tells the member page only the ceremony status', async () => {
    const client = createDevCmsg();
    let emit: (event: CmsgEvent) => void = () => {};
    const spy = { ...client, subscribe: (handler: (event: CmsgEvent) => void) => { emit = handler; return () => {}; } };
    const { target, cleanup } = render(VaultStatus, { client: spy });
    try {
      await tick();
      expect(target.textContent).toBe('');
      emit({ type: 'groups', groups: [] }); await tick();
      expect(target.textContent).toBe('');
      emit({ type: 'ceremony', status: { state: 'popup-open' } }); await tick();
      expect(target.textContent).toContain('never sees your passkey');
      emit({ type: 'ceremony', status: { state: 'idle' } }); await tick();
      expect(target.textContent).toBe('');
    } finally { cleanup(); }
  });
});

describe('vault entry', () => {
  function fakeWindow(hash: string, origin = 'http://vault.anna.localhost:4173', embedded = true) {
    const parent = { postMessage: vi.fn() };
    const win = {
      location: { hash, origin },
      parent: undefined as unknown,
      top: undefined as unknown,
      close: vi.fn(),
      open: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    win.parent = embedded ? parent : win;
    return { win: win as unknown as Window, parent, raw: win };
  }

  it('answers the sign-in pop-up over the same-origin channel and closes', async () => {
    const received: unknown[] = [];
    const listener = new BroadcastChannel(CEREMONY_CHANNEL);
    listener.onmessage = (event) => received.push(event.data);
    const { win, raw } = fakeWindow(`${POPUP_PREFIX}abc%20def`);
    const target = document.createElement('div');
    document.body.append(target);
    await mountVault(target, win);
    target.querySelector('button')!.click();
    await vi.waitFor(() => expect(received.length).toBe(1));
    expect(received[0]).toEqual({ type: 'result', nonce: 'abc def', status: 'approved' });
    expect(raw.close).toHaveBeenCalled();
    listener.close();
  });

  it('mounts an unavailable frame when not embedded or not on a vault origin', async () => {
    for (const fake of [fakeWindow('', 'http://vault.anna.localhost:4173', false), fakeWindow('', 'http://anna.localhost:4173')]) {
      const target = document.createElement('div');
      document.body.append(target);
      await mountVault(target, fake.win);
      expect(target.textContent).toContain('not available yet');
    }
  });

  it('starts the frame with the development vault, announces to the exact member origin and opens the pop-up on a click', async () => {
    const { win, parent, raw } = fakeWindow('');
    const target = document.createElement('div');
    document.body.append(target);
    await mountVault(target, win);
    expect(parent.postMessage).toHaveBeenCalledWith({ ready: 'cmeet-dev-harness-1' }, 'http://anna.localhost:4173');
    expect(raw.addEventListener).toHaveBeenCalled();
    expect(target.textContent).toContain('The vault is ready.');
    expect(raw.open).not.toHaveBeenCalled();
  });
});
