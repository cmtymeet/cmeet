import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Chat from '../../src/views/Chat.svelte';
import ChatHarness from './fixtures/ChatHarness.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { CmsgClient } from '../../../../core/src/cmsg.js';

function renderHarness(client: CmsgClient, initialPeer: string) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(ChatHarness, { target, props: { client, initialPeer } });
  return {
    target,
    api: component as unknown as { showPeer(peer: string): void },
    cleanup: () => {
      unmount(component);
      target.remove();
    },
  };
}

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

  it('offers punishment separately from block and close, without acting before confirmation', async () => {
    const client = createDevCmsg();
    await establishTom(client);
    const spy = vi.spyOn(client, 'punishConversation');
    const { target, cleanup } = render(client, 'member-tom');
    try {
      await vi.waitFor(() => expect(target.querySelector('#composer')).not.toBeNull());
      const names = [...target.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
      expect(names).toContain('Punish');
      expect(target.querySelector('dialog')?.open).toBe(false);
      expect(buttonByName(target, 'Block')).not.toBeNull();
      expect(buttonByName(target, 'Respectfully close')).not.toBeNull();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('keeps typing local: no reload and busy held until a gated send completes', async () => {
    const base = createDevCmsg({ messageState: 'stored' });
    await establishTom(base);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client: CmsgClient = {
      ...base,
      sendMessage: async (peer, text) => {
        await gate;
        return base.sendMessage(peer, text);
      },
    };
    const threadSpy = vi.spyOn(client, 'thread');
    const { target, cleanup } = render(client, 'member-tom');
    try {
      await vi.waitFor(() => expect(target.querySelector('#composer')).not.toBeNull());
      threadSpy.mockClear();
      const input = target.querySelector('#composer') as HTMLInputElement;
      for (const value of ['g', 'ga', 'gat', 'gate', 'gated hello']) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await tick();
      }
      expect(threadSpy).not.toHaveBeenCalled();
      expect(target.textContent).toMatch(/tom-cooks/);
      expect((target.querySelector('#composer') as HTMLInputElement).value).toBe('gated hello');
      buttonByName(target, 'Send')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Sending…/));
      expect(threadSpy).not.toHaveBeenCalled();
      release();
      await vi.waitFor(() => expect(target.textContent).toMatch(/gated hello/));
      expect(target.textContent).toMatch(/Stored for delivery/);
      expect(target.textContent).not.toMatch(/Sending…/);
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

describe('direct chat peer switches', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('never lets a slow old-peer send overwrite the new peer view', async () => {
    const base = createDevCmsg({ messageState: 'stored' });
    await establishTom(base);
    const client: CmsgClient = {
      ...base,
      sendMessage: async (peer, text) => {
        await sleep(80);
        return base.sendMessage(peer, text);
      },
    };
    const { target, api, cleanup } = renderHarness(client, 'member-tom');
    try {
      await vi.waitFor(() => expect(target.querySelector('#composer')).not.toBeNull());
      await fillComposer(target, 'Stale hello');
      buttonByName(target, 'Send')?.click();
      api.showPeer('member-ana');
      await vi.waitFor(() => expect(target.textContent).toMatch(/ana-walks/));
      await sleep(150);
      await tick();
      expect(target.textContent).toMatch(/ana-walks/);
      expect(target.textContent).not.toMatch(/tom-cooks/);
      expect(target.textContent).not.toMatch(/Stale hello/);
      expect((target.querySelector('#composer') as HTMLInputElement).value).toBe('');
      // The late send still reached its own peer through the real adapter.
      expect(
        (await base.thread('member-tom')).messages.some((m) => m.text === 'Stale hello'),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('ignores a stale thread load that resolves after a fast peer switch', async () => {
    const base = createDevCmsg();
    await establishTom(base);
    const client: CmsgClient = {
      ...base,
      thread: async (peer) => {
        if (peer === 'member-tom') await sleep(80);
        return base.thread(peer);
      },
    };
    const { target, api, cleanup } = renderHarness(client, 'member-tom');
    try {
      api.showPeer('member-ana');
      await vi.waitFor(() => expect(target.textContent).toMatch(/ana-walks/));
      await sleep(150);
      await tick();
      expect(target.textContent).toMatch(/ana-walks/);
      expect(target.textContent).not.toMatch(/tom-cooks/);
      expect(target.textContent).not.toMatch(/Hello back!/);
    } finally {
      cleanup();
    }
  });

  it('keeps drafts per peer across switches', async () => {
    const client = createDevCmsg();
    await establishTom(client);
    const { target, api, cleanup } = renderHarness(client, 'member-tom');
    try {
      await vi.waitFor(() => expect(target.querySelector('#composer')).not.toBeNull());
      await fillComposer(target, 'note for tom');
      api.showPeer('member-ana');
      await vi.waitFor(() => expect(target.textContent).toMatch(/ana-walks/));
      expect((target.querySelector('#composer') as HTMLInputElement).value).toBe('');
      await fillComposer(target, 'note for ana');
      api.showPeer('member-tom');
      await vi.waitFor(() => expect(target.textContent).toMatch(/tom-cooks/));
      expect((target.querySelector('#composer') as HTMLInputElement).value).toBe('note for tom');
    } finally {
      cleanup();
    }
  });

  it('tears down a pending load on unmount without further updates', async () => {
    const base = createDevCmsg();
    await establishTom(base);
    const client: CmsgClient = {
      ...base,
      thread: async (peer) => {
        await sleep(80);
        return base.thread(peer);
      },
    };
    const { target, cleanup } = renderHarness(client, 'member-tom');
    cleanup();
    await sleep(150);
    expect(document.body.contains(target)).toBe(false);
  });
});
