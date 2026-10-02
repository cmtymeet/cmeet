import { describe, expect, it, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import CliLogin from '../../src/views/CliLogin.svelte';
import { createCliLoginPort, takeLaunch, isCliLoginHash } from '../../src/browser/cli-login.js';
import { createDevCliLogin } from '../../../../core/src/dev-cli-login.js';
import { CLI_LOGIN_PREFIX } from '../../../../core/src/cli-login.js';
import type { CliLoginPort } from '../../../../core/src/cli-login.js';

const ORIGIN = 'https://anna.cmeet.example';
const NOW = 1_000_000;

function launch(overrides: Record<string, string | null> = {}): string {
  const base: Record<string, string | null> = {
    session: 'session-one-0001', nonce: 'nonce-value-0001', origin: ORIGIN,
    callback: 'http://127.0.0.1:43111/finish', expires: String(NOW + 120_000),
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...base, ...overrides })) if (value !== null) params.set(key, value);
  return `${CLI_LOGIN_PREFIX}${params.toString()}`;
}
const fresh = (handoff?: 'done' | 'cancelled' | 'failed') => createDevCliLogin({ handoff, now: () => NOW });

describe('development CLI login runtime stand-in', () => {
  it('accepts a well-formed request for the exact origin', async () => {
    const port = fresh();
    const result = await port.inspect(launch(), ORIGIN);
    expect(result).toMatchObject({ ok: true, request: { communityOrigin: ORIGIN } });
    expect(JSON.stringify(result)).not.toMatch(/nonce|session|127\.0\.0\.1|callback/);
  });

  it('fails closed on every malformed launch and callback', async () => {
    const port = fresh();
    const bad: (string | Record<string, string | null>)[] = [
      '#/other/x',
      CLI_LOGIN_PREFIX,
      { session: 'short' }, { nonce: 'bad nonce!!' }, { expires: 'soon' }, { callback: null },
      { callback: 'not a url' },
      { callback: 'https://127.0.0.1:43111/finish' },
      { callback: 'http://localhost:43111/finish' },
      { callback: 'http://example.com:43111/finish' },
      { callback: 'http://user@127.0.0.1:43111/finish' },
      { callback: 'http://user:pw@127.0.0.1:43111/finish' },
      { callback: 'http://127.0.0.1/finish' },
      { callback: 'http://127.0.0.1:80/finish' },
      { callback: 'http://127.0.0.1:43111/other' },
      { callback: 'http://127.0.0.1:43111/finish?x=1' },
      { callback: 'http://127.0.0.1:43111/finish#x' },
    ];
    for (const item of bad) {
      const value = typeof item === 'string' ? item : launch(item);
      expect(await port.inspect(value, ORIGIN), JSON.stringify(item)).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('refuses a different origin and an expired request', async () => {
    const port = fresh();
    expect(await port.inspect(launch(), 'https://other.cmeet.example')).toEqual({ ok: false, reason: 'origin-mismatch' });
    expect(await port.inspect(launch({ origin: null }), ORIGIN)).toEqual({ ok: false, reason: 'origin-mismatch' });
    expect(await port.inspect(launch({ expires: String(NOW) }), ORIGIN)).toEqual({ ok: false, reason: 'expired' });
    const clockless = createDevCliLogin();
    expect(await clockless.inspect(launch({ expires: '1' }), ORIGIN)).toEqual({ ok: false, reason: 'expired' });
  });

  it('consumes a request once and refuses replay and a second begin', async () => {
    const port = fresh();
    expect(await port.begin()).toMatchObject({ state: 'failed', retryable: false });
    await port.inspect(launch(), ORIGIN);
    const [first, second] = await Promise.all([port.begin(), port.begin()]);
    expect(first).toEqual({ state: 'done', retryable: false });
    expect(second).toMatchObject({ state: 'failed', retryable: false });
    expect(await port.inspect(launch(), ORIGIN)).toEqual({ ok: false, reason: 'replayed' });
  });

  it('reports cancelled (retryable) and failed (final) handoffs from the runtime', async () => {
    const cancelled = fresh('cancelled');
    await cancelled.inspect(launch(), ORIGIN);
    expect(await cancelled.begin()).toMatchObject({ state: 'cancelled', retryable: true });
    expect(await cancelled.begin()).toMatchObject({ state: 'cancelled', retryable: true });
    const failed = fresh('failed');
    await failed.inspect(launch(), ORIGIN);
    expect(await failed.begin()).toMatchObject({ state: 'failed', retryable: false });
    expect(await failed.begin()).toMatchObject({ state: 'failed', retryable: false });
  });

  it('cancelling closes the request for good', async () => {
    const port = fresh();
    expect((await port.cancel()).state).toBe('cancelled');
    await port.inspect(launch(), ORIGIN);
    expect((await port.cancel()).retryable).toBe(false);
    expect(await port.inspect(launch(), ORIGIN)).toEqual({ ok: false, reason: 'replayed' });
    expect(await port.begin()).toMatchObject({ state: 'failed' });
  });
});

describe('browser seam helpers', () => {
  it('recognises only the CLI login route and strips the fragment immediately', () => {
    expect(isCliLoginHash('#/cli-login/abc')).toBe(true);
    expect(isCliLoginHash('#/forum')).toBe(false);
    const replaceState = vi.fn();
    const fake = { location: { hash: '#/cli-login/secret', pathname: '/p', search: '?a=1' }, history: { replaceState } };
    expect(takeLaunch(fake as unknown as Window)).toBe('#/cli-login/secret');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/p?a=1');
  });

  it('builds the development port with an optional handoff outcome', async () => {
    for (const search of ['', '?dev-cli-handoff=cancelled', '?dev-cli-handoff=failed', '?dev-cli-handoff=bogus']) {
      expect(await createCliLoginPort(search)).not.toBeNull();
    }
  });
});

function render(port: CliLoginPort | null, hash = launch()) {
  const target = document.createElement('div');
  document.body.append(target);
  const view = mount(CliLogin, { target, props: { port, launch: hash, pageOrigin: ORIGIN } });
  return { target, cleanup: () => { void unmount(view); target.remove(); } };
}
const press = (target: HTMLElement, name: string) =>
  [...target.querySelectorAll('button')].find((b) => b.textContent?.includes(name))!;

describe('CLI login page', () => {
  it('is honestly unavailable without a runtime port', async () => {
    const { target, cleanup } = render(null);
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('not available right now'));
      expect(target.querySelector('button')).toBeNull();
    } finally { cleanup(); }
  });

  it('names the exact origin and handoff, starts only on click and ends in done', async () => {
    const port = fresh();
    const begin = vi.spyOn(port, 'begin');
    const { target, cleanup } = render(port);
    try {
      await vi.waitFor(() => expect(target.textContent).toContain(ORIGIN));
      expect(target.textContent).toContain('the cmeet app on this computer');
      expect(target.textContent).toContain('Nothing is sent through our servers');
      expect(begin).not.toHaveBeenCalled();
      press(target, 'Continue with my passkey').click();
      press(target, 'Continue with my passkey')?.click();
      await vi.waitFor(() => expect(target.textContent).toContain('return to your terminal'));
      expect(begin).toHaveBeenCalledTimes(1);
      expect(target.querySelector('button')).toBeNull();
    } finally { cleanup(); }
  });

  it.each([
    [launch({ callback: 'https://evil.example/finish' }), 'not valid'],
    [launch({ expires: '1' }), 'expired'],
  ])('shows a refusal for %s', async (hash, text) => {
    const { target, cleanup } = render(fresh(), hash);
    try {
      await vi.waitFor(() => expect(target.textContent).toContain(text));
      expect(target.querySelector('button')).toBeNull();
    } finally { cleanup(); }
  });

  it('refuses a replayed link and a mismatched origin shown by the runtime', async () => {
    const port = fresh();
    await port.inspect(launch(), ORIGIN);
    await port.begin();
    const replay = render(port);
    try { await vi.waitFor(() => expect(replay.target.textContent).toContain('already used')); } finally { replay.cleanup(); }
    const lying = { ...fresh(), inspect: async () => ({ ok: true as const, request: { communityOrigin: 'https://other.example', handoffLabel: 'x', expiresLabel: 'y' } }) };
    const wrong = render(lying);
    try { await vi.waitFor(() => expect(wrong.target.textContent).toContain('different community address')); } finally { wrong.cleanup(); }
    const mismatch = render(fresh(), launch({ origin: 'https://other.cmeet.example' }));
    try { await vi.waitFor(() => expect(mismatch.target.textContent).toContain('different community address')); } finally { mismatch.cleanup(); }
  });

  it('offers a retry after a cancelled handoff and shows a final failure without one', async () => {
    const cancelled = render(fresh('cancelled'));
    try {
      await vi.waitFor(() => expect(press(cancelled.target, 'Continue')).toBeTruthy());
      press(cancelled.target, 'Continue').click();
      await vi.waitFor(() => expect(cancelled.target.textContent).toContain('The sign-in was cancelled.'));
      expect(press(cancelled.target, 'Try again')).toBeTruthy();
    } finally { cancelled.cleanup(); }
    const failed = render(fresh('failed'));
    try {
      await vi.waitFor(() => expect(press(failed.target, 'Continue')).toBeTruthy());
      press(failed.target, 'Continue').click();
      await vi.waitFor(() => expect(failed.target.textContent).toContain('did not receive'));
      expect(failed.target.textContent).not.toContain('Try again');
    } finally { failed.cleanup(); }
  });

  it('uses fallback texts when the runtime gives no message or throws', async () => {
    const quiet = {
      ...fresh(),
      begin: async () => ({ state: 'cancelled' as const, retryable: false }),
    };
    const first = render(quiet);
    try {
      await vi.waitFor(() => expect(press(first.target, 'Continue')).toBeTruthy());
      press(first.target, 'Continue').click();
      await vi.waitFor(() => expect(first.target.textContent).toContain('The sign-in was cancelled.'));
    } finally { first.cleanup(); }
    const silentFail = { ...fresh(), begin: async () => ({ state: 'failed' as const, retryable: false }) };
    const second = render(silentFail);
    try {
      await vi.waitFor(() => expect(press(second.target, 'Continue')).toBeTruthy());
      press(second.target, 'Continue').click();
      await vi.waitFor(() => expect(second.target.textContent).toContain('did not complete'));
    } finally { second.cleanup(); }
    const rejecting = { ...fresh(), begin: () => Promise.reject(new Error('x')) };
    const third = render(rejecting);
    try {
      await vi.waitFor(() => expect(press(third.target, 'Continue')).toBeTruthy());
      press(third.target, 'Continue').click();
      await vi.waitFor(() => expect(third.target.textContent).toContain('did not complete'));
    } finally { third.cleanup(); }
    const refusing = { ...fresh(), cancel: () => Promise.reject(new Error('y')) };
    const fourth = render(refusing);
    try {
      await vi.waitFor(() => expect(press(fourth.target, 'Cancel')).toBeTruthy());
      press(fourth.target, 'Cancel').click();
      await vi.waitFor(() => expect(fourth.target.textContent).toContain('The sign-in was cancelled.'));
    } finally { fourth.cleanup(); }
  });

  it('cancels from the page and handles an inspection failure', async () => {
    const { target, cleanup } = render(fresh());
    try {
      await vi.waitFor(() => expect(press(target, 'Cancel')).toBeTruthy());
      press(target, 'Cancel').click();
      await vi.waitFor(() => expect(target.textContent).toContain('The sign-in was cancelled.'));
    } finally { cleanup(); }
    const broken = render({ ...fresh(), inspect: () => Promise.reject(new Error('boom')) });
    try { await vi.waitFor(() => expect(broken.target.textContent).toContain('not available right now')); } finally { broken.cleanup(); }
  });

  it('ignores answers that arrive after the page is gone', async () => {
    let release: () => void = () => {};
    const slow = {
      ...fresh(),
      inspect: () => new Promise<never>((_, reject) => { release = () => reject(new Error('late')); }),
      begin: () => new Promise<never>((_, reject) => { release = () => reject(new Error('late')); }),
    };
    const gone = render(slow);
    gone.cleanup();
    release();
    const live = render({
      ...fresh(),
      begin: () => new Promise<never>((_, reject) => { release = () => reject(new Error('late')); }),
      cancel: () => new Promise<never>((_, reject) => { release = () => reject(new Error('late')); }),
    });
    await vi.waitFor(() => expect(press(live.target, 'Continue')).toBeTruthy());
    press(live.target, 'Continue').click();
    live.cleanup();
    release();
    await Promise.resolve();
    const another = render({
      ...fresh(),
      cancel: () => new Promise<never>((_, reject) => { release = () => reject(new Error('late')); }),
    });
    await vi.waitFor(() => expect(press(another.target, 'Cancel')).toBeTruthy());
    press(another.target, 'Cancel').click();
    another.cleanup();
    release();
    await Promise.resolve();
  });
});
