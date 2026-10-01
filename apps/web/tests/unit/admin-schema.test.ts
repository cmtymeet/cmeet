import { describe, expect, it } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import AdminSchema from '../../src/views/AdminSchema.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { CmsgClient } from '../../../../core/src/cmsg.js';

type TestClient = CmsgClient & { signInRole?: (role: 'admin' | 'root') => Promise<void> };

function render(client: CmsgClient) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(AdminSchema, { target, props: { client } });
  return {
    target,
    cleanup: () => {
      unmount(component);
      target.remove();
    },
  };
}

async function waitFor(fn: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await tick();
    if (fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for UI update.');
  }
}

function setInput(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function setSelect(el: HTMLSelectElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function click(el: HTMLElement | null) {
  expect(el).not.toBeNull();
  (el as HTMLElement).click();
}

describe('admin schema editor against the real development adapter', () => {
  it('lists real questions, edits labels and saves the API impact verbatim', async () => {
    const client = createDevCmsg();
    const { target, cleanup } = render(client);
    try {
      await waitFor(() => target.querySelectorAll('.schema-row').length > 0);
      expect(target.textContent).toMatch(/How old are you\?/);

      // Edit a question label; only typed input is collected, no logic in the view.
      const labelInput = target.querySelector('#question-age') as HTMLInputElement;
      expect(labelInput).not.toBeNull();
      setInput(labelInput, 'What age are you?');
      await tick();
      expect(target.textContent).toMatch(/What age are you\?/);

      // Toggle required off via the accessible checkbox.
      const required = target.querySelector('#required-age') as HTMLInputElement;
      expect(required?.checked).toBe(true);
      required.checked = false;
      required.dispatchEvent(new Event('change', { bubbles: true }));
      await tick();
      expect((target.querySelector('#required-age') as HTMLInputElement).checked).toBe(false);

      click(
        [...target.querySelectorAll('button')].find((b) => b.textContent?.includes('Save schema')) ?? null,
      );
      await waitFor(() => /Profiles needing changes: 2/.test(target.textContent ?? ''));
      // The API note is shown verbatim; the view computes no impact itself.
      expect(target.textContent).toMatch(/Hidden or removed public fields stop matching at once/);
    } finally {
      cleanup();
    }
  });

  it('adds and removes draft questions, and labels edge-disabled move buttons', async () => {
    const client = createDevCmsg();
    const { target, cleanup } = render(client);
    try {
      await waitFor(() => target.querySelectorAll('.schema-row').length > 0);
      const before = target.querySelectorAll('.schema-row').length;

      const buttons = [...target.querySelectorAll('button')];
      const add = buttons.find((b) => b.textContent?.includes('Add question'));
      click(add ?? null);
      await waitFor(() => target.querySelectorAll('.schema-row').length === before + 1);
      expect(target.textContent).toMatch(/New question/);

      // First row cannot move up; last row cannot move down.
      const rows = [...target.querySelectorAll('.schema-row')];
      const firstUp = rows[0]?.querySelector('button') as HTMLButtonElement | null;
      expect(firstUp?.textContent).toMatch(/Move up/);
      expect(firstUp?.disabled).toBe(true);
      const lastRowButtons = rows[rows.length - 1]?.querySelectorAll('button');
      const lastDown = (lastRowButtons?.[1] ?? null) as HTMLButtonElement | null;
      expect(lastDown?.textContent).toMatch(/Move down/);
      expect(lastDown?.disabled).toBe(true);

      // Labelled move down on the first row swaps the order.
      const firstText = rows[0]?.textContent;
      const firstDown = rows[0]?.querySelectorAll('button')?.[1] as HTMLButtonElement | undefined;
      expect(firstDown?.disabled).toBe(false);
      firstDown?.click();
      await tick();
      const after = [...target.querySelectorAll('.schema-row')];
      expect(after[1]?.textContent).toBe(firstText);

      // Remove the draft question again.
      const removeButtons = [...target.querySelectorAll('button')].filter((b) =>
        b.textContent?.includes('Remove question'),
      );
      removeButtons[removeButtons.length - 1]?.click();
      await tick();
      expect(target.querySelectorAll('.schema-row').length).toBe(before);
    } finally {
      cleanup();
    }
  });

  it('edits choices, bounds and visibility, and previews typed sample answers from empty', async () => {
    const client = createDevCmsg();
    const { target, cleanup } = render(client);
    try {
      await waitFor(() => target.querySelector('#choices-neighbourhood') !== null);
      // Preview starts empty: no personal fixture defaults.
      expect(target.textContent).not.toMatch(/34/);

      // Extend the choice list; the sample select follows.
      const choices = target.querySelector('#choices-neighbourhood') as HTMLInputElement;
      setInput(choices, 'North, East, Harbour');
      await tick();
      const sampleSelect = target.querySelector('#sample-neighbourhood') as HTMLSelectElement;
      expect(sampleSelect).not.toBeNull();
      setSelect(sampleSelect, 'Harbour');
      await tick();
      expect(target.textContent).toMatch(/Harbour/);

      // Tighten a numeric bound; typed input only.
      const min = target.querySelector('#min-age') as HTMLInputElement;
      setInput(min, '21');
      await tick();
      expect((target.querySelector('#min-age') as HTMLInputElement).value).toBe('21');

      // Flip visibility; the preview moves the field between front and back.
      const vis = target.querySelector('#vis-about') as HTMLSelectElement;
      expect(vis).not.toBeNull();
      setSelect(vis, 'public');
      await tick();
      const sampleAbout = target.querySelector('#sample-about') as HTMLInputElement | HTMLTextAreaElement;
      setInput(sampleAbout, 'Hello from the test.');
      await tick();
      expect(target.textContent).toMatch(/Hello from the test\./);
    } finally {
      cleanup();
    }
  });

  it('signs in as admin explicitly and refuses cleanly at the adapter boundary', async () => {
    const real = createDevCmsg();
    const refusing: TestClient = {
      ...real,
      signInRole: async () => {
        throw new Error('Admin sign-in was refused for this device.');
      },
    };
    const { target, cleanup } = render(refusing);
    try {
      await waitFor(() => /Sign in as admin/.test(target.textContent ?? ''));
      expect(target.querySelectorAll('.schema-row').length).toBe(0);
      const signIn = [...target.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Sign in as admin'),
      );
      click(signIn ?? null);
      await waitFor(() => /Admin sign-in was refused/.test(target.textContent ?? ''));
      // Refusal stays on the sign-in screen; no schema is shown.
      expect(target.querySelectorAll('.schema-row').length).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('loads the editor after an explicit admin sign-in', async () => {
    const real = createDevCmsg();
    let signed = false;
    const gated: TestClient = {
      ...real,
      signInRole: async () => {
        signed = true;
      },
    };
    const { target, cleanup } = render(gated);
    try {
      await waitFor(() => /Sign in as admin/.test(target.textContent ?? ''));
      const signIn = [...target.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Sign in as admin'),
      );
      click(signIn ?? null);
      await waitFor(() => target.querySelectorAll('.schema-row').length > 0);
      expect(signed).toBe(true);
      expect(target.textContent).toMatch(/How old are you\?/);
    } finally {
      cleanup();
    }
  });
});
