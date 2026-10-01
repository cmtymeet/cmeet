import { describe, expect, it } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { ProfilePreview } from '../../../../ui/src/index.js';
import type { ProfileSchema } from '../../../../core/src/cmsg.js';

const schema: ProfileSchema = {
  version: 1,
  fields: [
    { key: 'age', question: 'How old are you?', kind: 'number', visibility: 'public', required: true, filterable: true },
    { key: 'about', question: 'Anything else?', kind: 'short-text', visibility: 'private', required: false, filterable: false },
  ],
};

function press(tab: HTMLElement, key: string): void {
  tab.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('profile preview keyboard tabs', () => {
  it('selects the private side with ArrowRight and moves focus with roving tabindex', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(ProfilePreview, {
      target,
      props: { schema, values: { age: 34, about: 'Hello.' } },
    });
    try {
      const tabs = () => target.querySelectorAll<HTMLElement>('[role="tab"]');
      expect(tabs()).toHaveLength(2);
      expect(tabs()[0].getAttribute('tabindex')).toBe('0');
      expect(tabs()[1].getAttribute('tabindex')).toBe('-1');
      (tabs()[0] as HTMLElement).focus();
      press(tabs()[0], 'ArrowRight');
      await tick();
      expect(target.textContent).toMatch(/Hello\./);
      expect(document.activeElement).toBe(tabs()[1]);
      expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
      expect(tabs()[1].getAttribute('tabindex')).toBe('0');
      expect(tabs()[0].getAttribute('tabindex')).toBe('-1');
    } finally {
      unmount(component);
      target.remove();
    }
  });

  it('wraps arrow keys around the ends', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(ProfilePreview, {
      target,
      props: { schema, values: { age: 34, about: 'Hello.' } },
    });
    try {
      const tabs = () => target.querySelectorAll<HTMLElement>('[role="tab"]');
      (tabs()[0] as HTMLElement).focus();
      press(tabs()[0], 'ArrowLeft');
      await tick();
      expect(target.textContent).toMatch(/Hello\./);
      expect(document.activeElement).toBe(tabs()[1]);
      press(tabs()[1], 'ArrowRight');
      await tick();
      expect(target.textContent).toMatch(/34/);
      expect(target.textContent).not.toMatch(/Hello\./);
      expect(document.activeElement).toBe(tabs()[0]);
    } finally {
      unmount(component);
      target.remove();
    }
  });

  it('supports Home and End', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(ProfilePreview, {
      target,
      props: { schema, values: { age: 34, about: 'Hello.' } },
    });
    try {
      const tabs = () => target.querySelectorAll<HTMLElement>('[role="tab"]');
      (tabs()[0] as HTMLElement).focus();
      press(tabs()[0], 'End');
      await tick();
      expect(target.textContent).toMatch(/Hello\./);
      expect(document.activeElement).toBe(tabs()[1]);
      press(tabs()[1], 'Home');
      await tick();
      expect(target.textContent).toMatch(/34/);
      expect(target.textContent).not.toMatch(/Hello\./);
      expect(document.activeElement).toBe(tabs()[0]);
    } finally {
      unmount(component);
      target.remove();
    }
  });

  it('ignores unrelated keys', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(ProfilePreview, {
      target,
      props: { schema, values: { age: 34, about: 'Hello.' } },
    });
    try {
      const tabs = () => target.querySelectorAll<HTMLElement>('[role="tab"]');
      (tabs()[0] as HTMLElement).focus();
      press(tabs()[0], 'a');
      await tick();
      expect(target.textContent).toMatch(/34/);
      expect(target.textContent).not.toMatch(/Hello\./);
      expect(document.activeElement).toBe(tabs()[0]);
      expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    } finally {
      unmount(component);
      target.remove();
    }
  });

  it('does not submit a surrounding form', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const form = document.createElement('form');
    target.appendChild(form);
    const host = document.createElement('div');
    form.appendChild(host);
    let submits = 0;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submits += 1;
    });
    const component = mount(ProfilePreview, {
      target: host,
      props: { schema, values: { age: 34, about: 'Hello.' } },
    });
    try {
      const tabs = host.querySelectorAll<HTMLElement>('[role="tab"]');
      expect(tabs).toHaveLength(2);
      for (const tab of tabs) expect(tab.getAttribute('type')).toBe('button');
      (tabs[1] as HTMLElement).click();
      await tick();
      expect(host.textContent).toMatch(/Hello\./);
      expect(submits).toBe(0);
    } finally {
      unmount(component);
      target.remove();
    }
  });
});
