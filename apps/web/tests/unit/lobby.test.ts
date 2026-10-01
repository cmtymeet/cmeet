import { describe, expect, it } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Lobby from '../../src/views/Lobby.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { CmsgClient, LobbyState } from '../../../../core/src/cmsg.js';

const JOIN = { voucher: 'VOUCHER-TEST-123', handle: 'lobby-member' };

async function waitFor(assert: () => void, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      assert();
      return;
    } catch (e) {
      if (Date.now() - start > timeoutMs) throw e;
      await new Promise((resolve) => setTimeout(resolve, 25));
      await tick();
    }
  }
}

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

  it('completes an actionable gate and surfaces refusal with focus', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const actionGate = {
      id: 'email-code',
      label: 'Email check',
      detail: 'Enter the code sent to you.',
      state: 'action-needed' as const,
      action: { label: 'Send code', inputLabel: 'Code' },
    };
    const waitingGate = {
      id: 'review',
      label: 'Manual review',
      detail: 'Waiting on the provider.',
      state: 'waiting' as const,
    };
    let stored = [waitingGate, actionGate];
    let refused = false;
    const injected = client as CmsgClient & {
      completeGate: (id: string, input: string) => Promise<LobbyState>;
    };
    injected.completeGate = async (id: string, input: string): Promise<LobbyState> => {
      if (id !== 'email-code') throw new Error('Unknown step.');
      if (input !== '123456') {
        refused = true;
        throw new Error('That code was not accepted.');
      }
      stored = [{ ...actionGate, state: 'complete' as const }, waitingGate];
      const base = await client.lobby();
      return { ...base, gates: [...stored] };
    };
    const withGates = {
      ...client,
      completeGate: injected.completeGate,
      lobby: async (): Promise<LobbyState> => {
        const base = await client.lobby();
        return { ...base, gates: [...stored] };
      },
    } as CmsgClient;
    const { target, cleanup } = render(withGates);
    try {
      await waitFor(() => {
        expect(target.textContent).toMatch(/Waiting/);
      });
      // Waiting is distinct from action needed, never conflated.
      expect(target.textContent).toMatch(/Action needed/);
      const input = target.querySelector('#gate-input-email-code') as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(target.textContent).toMatch(/Send code/);

      input!.focus();
      input!.value = 'wrong';
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      target
        .querySelector('form.gate-form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await waitFor(() => {
        expect(target.querySelector('#lobby-action-error [role="alert"]')).not.toBeNull();
      });
      expect(target.textContent).toMatch(/not accepted/);
      expect(refused).toBe(true);
      expect(document.activeElement?.id).toBe('lobby-action-error');

      const retry = target.querySelector('#gate-input-email-code') as HTMLInputElement | null;
      retry!.value = '123456';
      retry!.dispatchEvent(new Event('input', { bubbles: true }));
      await tick();
      target
        .querySelector('form.gate-form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await waitFor(() => {
        expect(target.querySelector('#lobby-action-error')).toBeNull();
      });
    } finally {
      cleanup();
    }
  });
});
