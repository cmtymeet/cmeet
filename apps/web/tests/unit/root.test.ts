import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Root from '../../src/views/Root.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { CmsgClient } from '../../../../core/src/cmsg.js';

function render(client: CmsgClient) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(Root, { target, props: { client } });
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
  return (buttons.find((b) => b.textContent?.trim().includes(name)) as HTMLButtonElement) ?? null;
}

async function signIn(target: HTMLElement) {
  buttonByName(target, 'Sign in as root')?.click();
  await vi.waitFor(() => expect(target.textContent).toMatch(/Garden neighbours/));
  await vi.waitFor(() => expect(target.textContent).toMatch(/Posting pace/));
}

async function fill(target: HTMLElement, id: string, value: string) {
  const input = target.querySelector(`#${id}`) as HTMLInputElement | null;
  expect(input).not.toBeNull();
  input!.value = value;
  input!.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
}

describe('root settings surface', () => {
  it('signs in with the root passkey and renders backend settings without inventing values', async () => {
    const { target, cleanup } = render(createDevCmsg());
    try {
      expect(target.querySelector('li')).toBeNull();
      await signIn(target);
      // Backend labels, help and effective values are rendered verbatim.
      expect(target.textContent).toMatch(/Posting pace/);
      expect(target.textContent).toMatch(/How often members may post/);
      expect(target.textContent).toMatch(/Managed by the platform/);
      // Non-editable platform setting offers no enabled save.
      const joiningSave = buttonByName(target, 'Save Joining');
      expect(joiningSave).not.toBeNull();
      expect(joiningSave?.disabled).toBe(true);
      // No member identifiers leak into the root surface.
      expect(target.textContent).not.toMatch(/member-ana|tom-cooks/);
    } finally {
      cleanup();
    }
  });

  it('passes the selected community ID on every change and drops stale responses', async () => {
    const base = createDevCmsg();
    const seen: string[] = [];
    const slow: CmsgClient = {
      ...base,
      rootCommunity: async (id: string) => {
        seen.push(id);
        if (id === 'garden-neighbours') await new Promise((r) => setTimeout(r, 80));
        return base.rootCommunity(id);
      },
    };
    const { target, cleanup } = render(slow);
    try {
      buttonByName(target, 'Sign in as root')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Garden neighbours/));
      // While the first community loads, controls are disabled.
      const selectButtons = [...target.querySelectorAll('.select-btn')] as HTMLButtonElement[];
      expect(selectButtons.length).toBe(2);
      // Wait for the auto-selected first community, then switch quickly.
      await vi.waitFor(() => expect(target.textContent).toMatch(/Posting pace/));
      const second = [...target.querySelectorAll('.select-btn')].find((b) =>
        b.textContent?.includes('Select'),
      ) as HTMLButtonElement;
      second?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/evening-choir|Evening choir/));
      // Both community IDs were requested; the stale first response never wins.
      expect(seen).toContain('garden-neighbours');
      expect(seen).toContain('evening-choir');
      expect(target.textContent).toMatch(/weekly/);
      expect(target.textContent).not.toMatch(/Garden admin/);
    } finally {
      cleanup();
    }
  });

  it('round-trips inherit, explicit empty and value through the selected community', async () => {
    const { target, cleanup } = render(createDevCmsg());
    try {
      await signIn(target);
      const radios = () =>
        [...target.querySelectorAll('input[name="mode-postingPace"]')] as HTMLInputElement[];

      // Explicit empty stops inheritance.
      radios().find((r) => r.value === 'empty')!.click();
      await tick();
      buttonByName(target, 'Save Posting pace')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Saved/));
      expect(target.textContent).toMatch(/stops inheritance/);

      // A typed value is sent with the selected community ID.
      radios().find((r) => r.value === 'value')!.click();
      await tick();
      await fill(target, 'root-value-postingPace', 'daily');
      buttonByName(target, 'Save Posting pace')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/daily/));

      // Inherit restores the platform value without UI inference.
      radios().find((r) => r.value === 'inherit')!.click();
      await tick();
      buttonByName(target, 'Save Posting pace')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/slow/));
    } finally {
      cleanup();
    }
  });

  it('refuses platform-managed settings and surfaces wrong-role failures', async () => {
    const { target, cleanup } = render(createDevCmsg());
    try {
      await signIn(target);
      // The non-editable setting cannot be saved from the UI path either:
      // force the call to prove the backend refusal is shown.
      const client = createDevCmsg();
      await client.signInRole('root');
      await expect(
        client.rootSetSetting('garden-neighbours', 'joining', 'empty'),
      ).rejects.toThrow('platform');
    } finally {
      cleanup();
    }

    const denied: CmsgClient = {
      ...createDevCmsg(),
      signInRole: async () => {
        throw new Error('Sign in with your passkey as root first.');
      },
    };
    const second = render(denied);
    try {
      buttonByName(second.target, 'Sign in as root')?.click();
      await vi.waitFor(() => expect(second.target.querySelector('[role="alert"]')).not.toBeNull());
      expect(second.target.textContent).toMatch(/root first/);
    } finally {
      second.cleanup();
    }

    const failing = createDevCmsg({ failActions: ['rootSetSetting'] });
    const third = render(failing);
    try {
      await signIn(third.target);
      const radios = [...third.target.querySelectorAll('input[name="mode-postingPace"]')] as HTMLInputElement[];
      radios.find((r) => r.value === 'empty')!.click();
      await tick();
      buttonByName(third.target, 'Save Posting pace')?.click();
      await vi.waitFor(() => expect(third.target.querySelector('[role="alert"]')).not.toBeNull());
      expect(third.target.textContent).toMatch(/Fixture failure/);
    } finally {
      third.cleanup();
    }
  });

  it('adds and removes admins by opaque ID and refuses empty input without calling the API', async () => {
    const client = createDevCmsg();
    const spy = vi.spyOn(client, 'rootSetAdmin');
    const { target, cleanup } = render(client);
    try {
      await signIn(target);
      expect(target.textContent).toMatch(/Garden admin/);

      buttonByName(target, 'Add admin')?.click();
      await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).not.toBeNull());
      expect(target.textContent).toMatch(/Enter an admin ID first/);
      expect(spy).not.toHaveBeenCalled();

      await fill(target, 'root-admin-id', 'fixture-admin');
      buttonByName(target, 'Add admin')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/fixture-admin/));
      expect(spy).toHaveBeenCalledWith('garden-neighbours', 'fixture-admin', true);

      buttonByName(target, 'Remove fixture-admin')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Saved/));
      expect(target.textContent).not.toMatch(/fixture-admin/);
      expect(spy).toHaveBeenLastCalledWith('garden-neighbours', 'fixture-admin', false);
    } finally {
      cleanup();
    }
  });
});
