import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Arrival from '../../src/views/Arrival.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { CmsgClient } from '../../../../core/src/cmsg.js';

function render(client: CmsgClient, onjoined: () => void = () => {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(Arrival, { target, props: { session: client, onjoined } });
  return {
    target,
    cleanup: () => {
      unmount(component);
      target.remove();
    },
  };
}

function buttonByName(target: HTMLElement, name: string): HTMLButtonElement | null {
  const buttons = [...target.querySelectorAll('button')];
  return (buttons.find((b) => b.textContent?.includes(name)) as HTMLButtonElement) ?? null;
}

async function openOptions(target: HTMLElement) {
  buttonByName(target, 'Sign in / register')?.click();
  await tick();
}

async function fill(target: HTMLElement, id: string, value: string) {
  const input = target.querySelector(`#${id}`) as HTMLInputElement | null;
  expect(input).not.toBeNull();
  input!.value = value;
  input!.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
}

describe('arrival landing', () => {
  it('shows only one combined action first, then both paths', async () => {
    const { target, cleanup } = render(createDevCmsg());
    try {
      expect(target.textContent).toMatch(/Sign in \/ register/);
      expect(target.querySelector('#voucher')).toBeNull();
      expect(target.querySelector('#handle')).toBeNull();
      await openOptions(target);
      expect(target.querySelector('#voucher')).not.toBeNull();
      expect(target.querySelector('#handle')).not.toBeNull();
      expect(buttonByName(target, 'Sign in with passkey')).not.toBeNull();
      expect(buttonByName(target, 'Continue to join')).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('refuses empty inputs without calling the adapter', async () => {
    const client = createDevCmsg();
    const spy = vi.spyOn(client, 'joinWithVoucher');
    const { target, cleanup } = render(client);
    try {
      await openOptions(target);
      buttonByName(target, 'Continue to join')?.click();
      await tick();
      expect(target.textContent).toMatch(/Enter your invitation voucher/);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('shows adapter errors for bad vouchers and joins on good ones', async () => {
    const onjoined = vi.fn();
    const { target, cleanup } = render(createDevCmsg(), onjoined);
    try {
      await openOptions(target);
      await fill(target, 'voucher', 'not-a-voucher');
      await fill(target, 'handle', 'new-member');
      buttonByName(target, 'Continue to join')?.click();
      await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).not.toBeNull());
      expect(target.textContent).toMatch(/not accepted/);
      expect(onjoined).not.toHaveBeenCalled();

      await fill(target, 'voucher', 'VOUCHER-TEST-123');
      buttonByName(target, 'Continue to join')?.click();
      await vi.waitFor(() => expect(onjoined).toHaveBeenCalled());
    } finally {
      cleanup();
    }
  });

  it('guards against double submit while busy', async () => {
    const onjoined = vi.fn();
    const { target, cleanup } = render(createDevCmsg(), onjoined);
    try {
      await openOptions(target);
      await fill(target, 'voucher', 'VOUCHER-TEST-123');
      await fill(target, 'handle', 'busy-member');
      const button = buttonByName(target, 'Continue to join')!;
      button.click();
      button.click();
      await vi.waitFor(() => expect(onjoined).toHaveBeenCalledTimes(1));
    } finally {
      cleanup();
    }
  });

  it('signs a returning member in with the passkey path only', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher({ voucher: 'VOUCHER-TEST-123', handle: 'returning-member' });
    const onjoined = vi.fn();
    const { target, cleanup } = render(client, onjoined);
    try {
      await openOptions(target);
      buttonByName(target, 'Sign in with passkey')?.click();
      await vi.waitFor(() => expect(onjoined).toHaveBeenCalledTimes(1));
    } finally {
      cleanup();
    }
  });

  it('reports a meaningful error when no member exists on this device', async () => {
    const { target, cleanup } = render(createDevCmsg());
    try {
      await openOptions(target);
      buttonByName(target, 'Sign in with passkey')?.click();
      await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).not.toBeNull());
      expect(target.textContent).toMatch(/Join with a voucher first/);
    } finally {
      cleanup();
    }
  });

  it('surfaces injected adapter failures without another auth mechanism', async () => {
    const failing: CmsgClient = {
      ...createDevCmsg(),
      joinWithVoucher: async () => {
        throw new Error('The invitation service is unavailable. Try again later.');
      },
      signIn: async () => {
        throw new Error('The invitation service is unavailable. Try again later.');
      },
    };
    const { target, cleanup } = render(failing);
    try {
      await openOptions(target);
      await fill(target, 'voucher', 'VOUCHER-TEST-123');
      await fill(target, 'handle', 'new-member');
      buttonByName(target, 'Continue to join')?.click();
      await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).not.toBeNull());
      expect(target.textContent).toMatch(/unavailable/);
      const buttons = [...target.querySelectorAll('button')].map((b) => b.textContent ?? '');
      expect(buttons.join(' ')).not.toMatch(/email|code|recovery/i);
    } finally {
      cleanup();
    }
  });
});
