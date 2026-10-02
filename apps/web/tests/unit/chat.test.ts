import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Chat from '../../src/views/Chat.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { CmsgClient } from '../../../../core/src/cmsg.js';

function render(client: CmsgClient, peer: string) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(Chat, { target, props: { client, peer } });
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
  return (buttons.find((b) => b.textContent?.trim() === name) as HTMLButtonElement) ?? null;
}

async function fillComposer(target: HTMLElement, value: string) {
  const input = target.querySelector('#composer') as HTMLInputElement | null;
  expect(input).not.toBeNull();
  input!.value = value;
  input!.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
}

/** Answer the seeded incoming wave so member-tom has an established thread. */
async function establishTom(client: CmsgClient) {
  const [incoming] = await client.incomingWaves();
  await client.answerWave(incoming!.id, 'Hello back!');
}

describe('direct chat', () => {
  it('shows the established thread with real returned delivery states', async () => {
    const client = createDevCmsg({ messageState: 'stored' });
    await establishTom(client);
    const { target, cleanup } = render(client, 'member-tom');
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/tom-cooks/));
      expect(target.textContent).toMatch(/Status: Active/);
      expect(target.textContent).toMatch(/Received/);
      await fillComposer(target, 'See you Saturday?');
      buttonByName(target, 'Send')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/See you Saturday\?/));
      expect(target.textContent).toMatch(/Stored for delivery/);
      expect(target.textContent).not.toMatch(/seen|read by/i);
    } finally {
      cleanup();
    }
  });

  it('labels queued messages without claiming an acknowledgement', async () => {
    const client = createDevCmsg();
    await establishTom(client);
    const { target, cleanup } = render(client, 'member-tom');
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/tom-cooks/));
      await fillComposer(target, 'Offline hello');
      buttonByName(target, 'Send')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Offline hello/));
      expect(target.textContent).toMatch(/Queued on your device/);
      expect(target.textContent).toMatch(/no permanent backup/i);
    } finally {
      cleanup();
    }
  });

  it('preserves the draft when sending fails and guards double submit', async () => {
    const client = createDevCmsg({ failActions: ['sendMessage'] });
    await establishTom(client);
    const spy = vi.spyOn(client, 'sendMessage');
    const { target, cleanup } = render(client, 'member-tom');
    try {
      await vi.waitFor(() => expect(target.querySelector('#composer')).not.toBeNull());
      await fillComposer(target, 'Keep this draft');
      const button = buttonByName(target, 'Send')!;
      button.click();
      button.click();
      await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).not.toBeNull());
      expect(target.textContent).toMatch(/Fixture failure/);
      expect((target.querySelector('#composer') as HTMLInputElement).value).toBe('Keep this draft');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it('closes the conversation and requests a reopen through the API states', async () => {
    const client = createDevCmsg();
    await establishTom(client);
    const { target, cleanup } = render(client, 'member-tom');
    try {
      await vi.waitFor(() => expect(target.querySelector('#composer')).not.toBeNull());
      buttonByName(target, 'Respectfully close')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Status: Closed/));
      expect(target.textContent).toMatch(/ask the other member to reopen/);
      expect((target.querySelector('#composer') as HTMLInputElement).disabled).toBe(true);
      buttonByName(target, 'Request reopen')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Status: Reopen requested/));
      expect(target.textContent).toMatch(/waiting with the other member/);
      expect((target.querySelector('#composer') as HTMLInputElement).disabled).toBe(true);
      expect((await client.thread('member-tom')).state).toBe('reopen-pending');
    } finally {
      cleanup();
    }
  });

  it('requires explicit punish confirmation before calling the API', async () => {
    const client = createDevCmsg();
    await establishTom(client);
    const spy = vi.spyOn(client, 'punishConversation');
    const { target, cleanup } = render(client, 'member-tom');
    try {
      await vi.waitFor(() => expect(target.querySelector('#composer')).not.toBeNull());
      buttonByName(target, 'Punish')?.click();
      await tick();
      expect(target.textContent).toMatch(/costs both participants/);
      expect(spy).not.toHaveBeenCalled();
      buttonByName(target, 'Cancel')?.click();
      await tick();
      expect(spy).not.toHaveBeenCalled();
      expect(buttonByName(target, 'Confirm punish')).toBeNull();
      buttonByName(target, 'Punish')?.click();
      await tick();
      buttonByName(target, 'Confirm punish')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Status: Blocked/));
      expect(spy).toHaveBeenCalledTimes(1);
      expect((target.querySelector('#composer') as HTMLInputElement).disabled).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('blocks within the conversation and disables the composer', async () => {
    const client = createDevCmsg();
    await establishTom(client);
    const { target, cleanup } = render(client, 'member-tom');
    try {
      await vi.waitFor(() => expect(target.querySelector('#composer')).not.toBeNull());
      buttonByName(target, 'Block')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Status: Blocked/));
      expect((target.querySelector('#composer') as HTMLInputElement).disabled).toBe(true);
      expect((await client.thread('member-tom')).state).toBe('blocked');
    } finally {
      cleanup();
    }
  });

  it('renders an unavailable conversation plainly without a composer', async () => {
    const client = createDevCmsg({ failActions: ['thread'] });
    const { target, cleanup } = render(client, 'member-tom');
    try {
      await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).not.toBeNull());
      expect(target.textContent).toMatch(/Fixture failure/);
      expect(target.querySelector('#composer')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('keeps the open thread steady while other contacts change', async () => {
    const client = createDevCmsg({ messageState: 'stored' });
    await establishTom(client);
    const { target, cleanup } = render(client, 'member-tom');
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/Hello back!/));
      await client.blockMember('member-ana');
      await vi.waitFor(() => expect(target.textContent).toMatch(/Status: Active/));
      expect(target.textContent).toMatch(/Hello back!/);
      expect(target.querySelector('[role="alert"]')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('loads each peer on its own with no permanent-backup claim', async () => {
    const client = createDevCmsg({ messageState: 'stored' });
    await establishTom(client);
    const first = render(client, 'member-tom');
    try {
      await vi.waitFor(() => expect(first.target.textContent).toMatch(/tom-cooks/));
    } finally {
      first.cleanup();
    }
    const second = render(client, 'member-ana');
    try {
      await vi.waitFor(() => expect(second.target.textContent).toMatch(/ana-walks/));
      expect(second.target.textContent).toMatch(/Waiting for the introduction/);
      expect(second.target.textContent).not.toMatch(/Hello back!/);
      expect((second.target.querySelector('#composer') as HTMLInputElement).disabled).toBe(true);
    } finally {
      second.cleanup();
    }
  });
});
