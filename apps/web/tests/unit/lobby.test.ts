import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Lobby from '../../src/views/Lobby.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { CmsgClient, LobbyState } from '../../../../core/src/cmsg.js';

const JOIN = { voucher: 'VOUCHER-TEST-123', handle: 'lobby-member' };

const waitFor = vi.waitFor;

function render(client: CmsgClient) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(Lobby, { target, props: { client } });
  return {
    target,
    cleanup: () => {
      unmount(component);
      target.remove();
    },
  };
}

describe('lobby journey against the development adapter', () => {
  it('shows active gates with distinct states, warnings and a disabled forum entry', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const { target, cleanup } = render(client);
    try {
      await waitFor(() => {
        expect(target.textContent).toMatch(/lobby-member/);
      });
      expect(target.querySelector('h2')?.textContent).toMatch(/Active requirements/);
      // The development adapter seeds one complete and one action-needed gate.
      expect(target.textContent).toMatch(/Complete/);
      expect(target.textContent).toMatch(/Action needed/);
      expect(target.textContent).toMatch(/cannot return/);
      expect(target.textContent).toMatch(/synced passkey/);
      const enter = target.querySelector('button');
      expect(enter?.textContent).toMatch(/Enter forum when admitted/);
      expect(enter?.disabled).toBe(true);
      // Profile entry stays separate from the gates; devices link out.
      expect(target.querySelector('a[href="#/profile"]')?.textContent).toMatch(/Complete profile/);
      expect(target.querySelector('a[href="#/devices"]')?.textContent).toMatch(/Manage devices/);
    } finally {
      cleanup();
    }
  });

  it('admits through the backend event once the profile is published', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const { target, cleanup } = render(client);
    try {
      await waitFor(() => {
        expect(target.textContent).toMatch(/Action needed/);
      });
      // The real adapter emits a lobby event on publish; the view resumes from it.
      await client.publishProfile({ age: 34, neighbourhood: 'North', weekend: 'Hiking' });
      await waitFor(() => {
        const buttons = [...target.querySelectorAll('button')];
        const enter = buttons.find((b) => b.textContent?.includes('Enter forum'));
        expect(enter?.disabled).toBe(false);
      });
      expect(target.querySelector('a[href="#/profile"]')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('reports a refused lobby load and unsubscribes on unmount', async () => {
    const client = createDevCmsg();
    let stopped = false;
    const failing = {
      ...client,
      lobby: async (): Promise<LobbyState> => {
        throw new Error('Join with a voucher first.');
      },
      subscribe: ((handler: Parameters<CmsgClient['subscribe']>[0]) => {
        const stop = client.subscribe(handler);
        return () => {
          stopped = true;
          stop();
        };
      }) as CmsgClient['subscribe'],
    } as CmsgClient;
    const { target, cleanup } = render(failing);
    try {
      await waitFor(() => {
        expect(target.querySelector('[role="alert"]')).not.toBeNull();
      });
      expect(target.textContent).toMatch(/Join with a voucher first/);
      expect(target.querySelector('button')?.textContent).toMatch(/Try again/);
    } finally {
      cleanup();
    }
    expect(stopped).toBe(true);
  });

  it('completes an actionable gate and focuses a refused answer', async () => {
    const client = createDevCmsg({ gateState: 'action-needed' });
    await client.joinWithVoucher(JOIN);
    const { target, cleanup } = render(client);
    try {
      await waitFor(() => expect(target.querySelector('input')).not.toBeNull());
      const input = target.querySelector('input')!;
      input.value = 'wrong'; input.dispatchEvent(new Event('input', { bubbles: true }));
      await tick();
      target.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await waitFor(() => expect(document.activeElement?.id).toBe('lobby-action-error'));
      expect(target.textContent).toContain('not accepted');
      input.value = JOIN.voucher; input.dispatchEvent(new Event('input', { bubbles: true }));
      await tick();
      target.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await waitFor(() => expect(target.querySelector('form')).toBeNull());
      expect((await client.lobby()).gates[0]?.state).toBe('complete');
    } finally { cleanup(); }
  });

  it('shows a waiting gate without inventing a completion action', async () => {
    const client = createDevCmsg({ gateState: 'waiting' });
    await client.joinWithVoucher(JOIN);
    await client.publishProfile({ age: 34, neighbourhood: 'North' });
    const { target, cleanup } = render(client);
    try {
      await waitFor(() => expect(target.textContent).toContain('Waiting'));
      expect(target.querySelector('form')).toBeNull();
      expect(target.querySelector('button')?.disabled).toBe(true);
    } finally { cleanup(); }
  });
});
