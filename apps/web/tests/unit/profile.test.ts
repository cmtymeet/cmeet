import { describe, expect, it, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import ProfileEditor from '../../src/views/ProfileEditor.svelte';
import { createDevCmsg } from '../../../core/src/dev-adapter.js';
import type { CmsgClient, ProfileSchema } from '../../../core/src/cmsg.js';

// Tests mount the real ProfileEditor against the real development adapter.
// Only the adapter boundary is wrapped: extra schema kinds and injected
// failures. Fixture validation, publishing and rule storage stay genuine.

async function mountEditor(client: CmsgClient) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(ProfileEditor, { target, props: { client } });
  await vi.waitFor(
    () => {
      if (!target.querySelector('#profile-age')) throw new Error('profile not loaded yet');
    },
    { timeout: 5000 },
  );
  return {
    target,
    cleanup: () => {
      unmount(component);
      target.remove();
    },
  };
}

function setInput(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function setSelect(element: HTMLSelectElement, value: string) {
  element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function query<T extends Element>(target: HTMLElement, selector: string): T {
  const found = target.querySelector<T>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

/** Real adapter plus optional yes-no, location and long-text questions. */
async function clientWithAllKinds(): Promise<CmsgClient> {
  const base = createDevCmsg();
  const seed = await base.schema();
  const extended: ProfileSchema = structuredClone(seed);
  extended.fields.push(
    {
      key: 'member',
      question: 'Are you a member?',
      kind: 'yes-no',
      visibility: 'public',
      required: false,
      filterable: true,
    },
    {
      key: 'base',
      question: 'Where is your base?',
      kind: 'location',
      visibility: 'private',
      required: false,
      filterable: true,
    },
    {
      key: 'bio',
      question: 'Tell us more.',
      kind: 'long-text',
      visibility: 'private',
      required: false,
      filterable: false,
    },
  );
  return { ...base, schema: async () => structuredClone(extended) };
}

describe('profile editor with every schema kind', () => {
  it('starts empty and never coerces a blank number to 0 or an unanswered yes/no to false', async () => {
    const client = await clientWithAllKinds();
    const { target, cleanup } = await mountEditor(client);
    try {
      expect(query<HTMLInputElement>(target, '#profile-age').value).toBe('');
      expect(query<HTMLSelectElement>(target, '#profile-member').value).toBe('');
      expect(query<HTMLInputElement>(target, '#profile-base-lat').value).toBe('');
      expect(query<HTMLInputElement>(target, '#profile-base-lon').value).toBe('');

      // Answer only the seed-required questions; leave yes/no and location
      // untouched, then publish through genuine client validation.
      setInput(query<HTMLInputElement>(target, '#profile-age'), '34');
      setSelect(query<HTMLSelectElement>(target, '#profile-neighbourhood'), 'North');
      query<HTMLButtonElement>(target, 'button[type="submit"]').click();
      await vi.waitFor(
        () => {
          if (!target.textContent?.includes('Profile published and checked.')) {
            throw new Error('waiting for publish');
          }
        },
        { timeout: 5000 },
      );

      const stored = await client.ownProfile();
      expect(stored.values.age).toBe(34);
      expect('member' in stored.values).toBe(false);
      expect('base' in stored.values).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('edits all kinds and publishes separate number bounds plus a collected distance', async () => {
    const client = await clientWithAllKinds();
    const { target, cleanup } = await mountEditor(client);
    try {
      setInput(query<HTMLInputElement>(target, '#profile-age'), '34');
      setSelect(query<HTMLSelectElement>(target, '#profile-neighbourhood'), 'North');
      setSelect(query<HTMLSelectElement>(target, '#profile-member'), 'Yes');
      setInput(query<HTMLInputElement>(target, '#profile-base-lat'), '47.37');
      setInput(query<HTMLInputElement>(target, '#profile-base-lon'), '8.54');
      setInput(query<HTMLTextAreaElement>(target, '#profile-bio'), 'Weekend hiker.');

      // Number bounds are two labelled controls, not one combined range.
      setInput(query<HTMLInputElement>(target, '#rule-age-min'), '25');
      setInput(query<HTMLInputElement>(target, '#rule-age-max'), '45');
      setInput(query<HTMLInputElement>(target, '#rule-neighbourhood'), 'North, East');
      setSelect(query<HTMLSelectElement>(target, '#rule-member'), 'Yes');
      setInput(query<HTMLInputElement>(target, '#rule-base-distance'), '10');

      query<HTMLButtonElement>(target, 'button[type="submit"]').click();
      await vi.waitFor(
        () => {
          if (!target.textContent?.includes('Profile published and checked.')) {
            throw new Error('waiting for publish');
          }
        },
        { timeout: 5000 },
      );

      const stored = await client.ownProfile();
      expect(stored.values.age).toBe(34);
      expect(stored.values.member).toBe(true);
      expect(stored.values.base).toEqual({ latitude: 47.37, longitude: 8.54 });
      expect(stored.values.bio).toBe('Weekend hiker.');

      const rules = await client.ownRules();
      const ageRule = rules.find((rule) => rule.field === 'age');
      expect(ageRule?.min).toBe(25);
      expect(ageRule?.max).toBe(45);
      const distanceRule = (rules as Array<{ field: string; maxDistanceKm?: number }>).find(
        (rule) => rule.field === 'base',
      );
      expect(distanceRule?.maxDistanceKm).toBe(10);
      const memberRule = rules.find((rule) => rule.field === 'member');
      expect(memberRule?.equals).toEqual([true]);
    } finally {
      cleanup();
    }
  });

  it('keeps client field errors with aria-invalid and focuses the first error', async () => {
    const client = createDevCmsg();
    const { target, cleanup } = await mountEditor(client);
    try {
      query<HTMLButtonElement>(target, 'button[type="submit"]').click();
      await vi.waitFor(
        () => {
          const age = query<HTMLInputElement>(target, '#profile-age');
          if (age.getAttribute('aria-invalid') !== 'true') throw new Error('waiting for field error');
        },
        { timeout: 5000 },
      );
      const age = query<HTMLInputElement>(target, '#profile-age');
      expect(age.getAttribute('aria-invalid')).toBe('true');
      expect(target.textContent).toMatch(/How old are you/);
      expect(document.activeElement?.id).toBe('profile-age');
    } finally {
      cleanup();
    }
  });

  it('stays honest when publishing fails and keeps the typed answers', async () => {
    const base = createDevCmsg();
    const failing: CmsgClient = {
      ...base,
      publishProfile: async () => {
        throw new Error('Saving did not work. Try again.');
      },
    };
    const { target, cleanup } = await mountEditor(failing);
    try {
      setInput(query<HTMLInputElement>(target, '#profile-age'), '34');
      setSelect(query<HTMLSelectElement>(target, '#profile-neighbourhood'), 'North');
      query<HTMLButtonElement>(target, 'button[type="submit"]').click();
      await vi.waitFor(
        () => {
          if (!target.textContent?.includes('Saving did not work. Try again.')) {
            throw new Error('waiting for save failure');
          }
        },
        { timeout: 5000 },
      );
      expect(target.textContent).not.toMatch(/Profile published and checked/);
      // The member's work is preserved instead of cleared.
      expect(query<HTMLInputElement>(target, '#profile-age').value).toBe('34');
    } finally {
      cleanup();
    }
  });

  it('previews the public front without the private back', async () => {
    const client = createDevCmsg();
    const { target, cleanup } = await mountEditor(client);
    try {
      setInput(query<HTMLInputElement>(target, '#profile-age'), '34');
      setSelect(query<HTMLSelectElement>(target, '#profile-neighbourhood'), 'North');
      setInput(query<HTMLTextAreaElement>(target, '#profile-about'), 'Quiet hiker.');
      const tabs = target.querySelectorAll('[role="tab"]');
      expect(tabs.length).toBeGreaterThanOrEqual(2);
      expect(target.textContent).toMatch(/34/);
      expect(target.textContent).not.toMatch(/Quiet hiker/);
      (tabs[1] as HTMLElement).click();
      await vi.waitFor(
        () => {
          if (!target.textContent?.includes('Quiet hiker')) throw new Error('waiting for private back');
        },
        { timeout: 5000 },
      );
    } finally {
      cleanup();
    }
  });
});
