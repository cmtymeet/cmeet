import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { Session, parseHash, routeHref } from '../../src/session.svelte.js';
import App from '../../src/App.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';

describe('shell presentation', () => {
  it('handles malformed routes and round-trips opaque identifiers', () => {
    expect(parseHash('#/chat/%E0%A4')).toEqual({ name: 'arrival' });
    expect(parseHash('#/groups/%')).toEqual({ name: 'arrival' });
    const route = { name: 'chat' as const, peer: 'peer /?#' };
    expect(parseHash(routeHref(route))).toEqual(route);
    expect(parseHash('#/unknown')).toEqual({ name: 'arrival' });
  });

  it('shows connection failure through the session and stops subscriptions', async () => {
    const client = createDevCmsg({ failActions: ['connect'] });
    const session = new Session(client);
    await session.start();
    expect(session.failed).toBe(true);
    expect(session.snapshot.connection.message).toContain('Fixture failure');
    session.stop();
    await client.joinWithVoucher({ voucher: 'VOUCHER-TEST-123', handle: 'shell-member' });
    expect(session.snapshot.lobby).toBeNull();
  });

  it('ignores completion after teardown and a superseded network attempt', async () => {
    const client = createDevCmsg({ connectDelayMs: 20 });
    const session = new Session(client);
    const pending = session.start();
    await tick();
    session.stop();
    await pending;
    expect(session.ready).toBe(false);
    await session.start();
    expect(session.ready).toBe(true);
    session.stop();
  });

  it('projects admission and keeps portal links out of ordinary navigation', async () => {
    window.location.hash = '#/forum';
    const client = createDevCmsg({ connectDelayMs: 1 });
    const session = new Session(client);
    const target = document.createElement('div'); document.body.append(target);
    const app = mount(App, { target, props: { session } });
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('Good conversations'));
      await client.joinWithVoucher({ voucher: 'VOUCHER-TEST-123', handle: 'shell-member' });
      session.markJoined();
      await vi.waitFor(() => expect(target.querySelector('h1')?.textContent).toBe('Lobby'));
      expect(target.querySelector('nav a[href="#/forum"]')).toBeNull();
      await client.publishProfile({ age: 34, neighbourhood: 'North' });
      await vi.waitFor(() => expect(target.querySelector('h1')?.textContent).toBe('Discover'));
      expect(target.querySelector('nav a[href="#/admin"]')).toBeNull();
      expect(target.querySelector('nav a[href="#/root"]')).toBeNull();
      target.querySelector<HTMLAnchorElement>('.skip-link')!.click();
      expect(document.activeElement?.id).toBe('content');
      expect(window.location.hash).toBe('#/forum');
    } finally { await unmount(app); target.remove(); window.location.hash = ''; }
  });
});
