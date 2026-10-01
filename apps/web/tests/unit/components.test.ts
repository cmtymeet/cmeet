import { describe, expect, it } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { ProfilePreview, LevelBadge } from '../../../../ui/src/index.js';
import type { ProfileSchema } from '../../../../core/src/cmsg.js';

const schema: ProfileSchema = {
  version: 1,
  fields: [
    { key: 'age', question: 'How old are you?', kind: 'number', visibility: 'public', required: true, filterable: true },
    { key: 'about', question: 'Anything else?', kind: 'short-text', visibility: 'private', required: false, filterable: false },
  ],
};

describe('profile flashcard preview', () => {
  it('shows the public front first and the private back on request', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(ProfilePreview, {
      target,
      props: {
        schema,
        values: { age: 34, about: 'Hello.' },
        frontLabel: 'Front: public profile',
        backLabel: 'Back: private profile',
      },
    });
    try {
      expect(target.textContent).toMatch(/34/);
      expect(target.textContent).not.toMatch(/Hello\./);
      const tabs = target.querySelectorAll('[role="tab"]');
      (tabs[1] as HTMLElement).click();
      await tick();
      expect(target.textContent).toMatch(/Hello\./);
    } finally {
      unmount(component);
      target.remove();
    }
  });
});

describe('group level badge', () => {
  it('names each level plainly', () => {
    for (const [level, label] of [['circle', 'Circle'], ['ingroup', 'Ingroup'], ['room', 'Public room']] as const) {
      const target = document.createElement('div');
      document.body.appendChild(target);
      const component = mount(LevelBadge, { target, props: { level } });
      try {
        expect(target.textContent).toBe(label);
      } finally {
        unmount(component);
        target.remove();
      }
    }
  });
});
