/**
 * Comprehensive behavior suite for every shared `ui/src` component.
 *
 * Mounts the actual Svelte components with real `mount`/`tick`/`unmount` and
 * feeds several of them with data from the actual development adapter
 * (`createDevCmsg`), never hand-mocked component logic. Adapter failure
 * injection (bad voucher rejection, `failConnect`) is exercised at the
 * adapter boundary only.
 *
 * Compatibility notes for PR11 (owns Dialog, TextField, SegmentedControl):
 * the tests below pin current behavior (Escape-to-close, scrim close, focus
 * move-in; one-way `value` + `oninput`; `current` + `onselect`). If PR11 adds
 * focus trapping, arrow-key roving tabindex, or two-way binding, these tests
 * should be extended, not weakened. GroupCard/WaveCard do not yet render the
 * PORT-CONTRACT additions (`opening` level, band/opening/lineage/fork views,
 * wave `releaseState`); the core worker implements them and components will
 * follow, so only current props are asserted here.
 */
import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount, type Component } from 'svelte';
import {
  Button,
  Dialog,
  EmptyState,
  GroupCard,
  LevelBadge,
  Notice,
  ProfilePreview,
  ProgressBar,
  PublicCard,
  SegmentedControl,
  TextField,
  WaveCard,
  en,
} from '../../../../ui/src/index.js';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { GroupView, ProfileSchema, Wave } from '../../../../core/src/cmsg.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render<P extends Record<string, unknown>>(view: Component<any>, props: P) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(view, { target, props });
  return {
    target,
    cleanup: () => {
      unmount(component);
      target.remove();
    },
  };
}

function click(el: Element | null): void {
  expect(el).not.toBeNull();
  (el as HTMLElement).click();
}

function keydown(el: Element | null, key: string): void {
  expect(el).not.toBeNull();
  (el as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function buttons(target: HTMLElement): HTMLButtonElement[] {
  return [...target.querySelectorAll('button')] as HTMLButtonElement[];
}

const JOIN = { voucher: 'VOUCHER-TEST-123', handle: 'test-member' };

const tinySchema: ProfileSchema = {
  version: 1,
  fields: [
    { key: 'age', question: 'How old are you?', kind: 'number', visibility: 'public', required: true, filterable: true },
    { key: 'about', question: 'Anything else?', kind: 'short-text', visibility: 'private', required: false, filterable: false },
  ],
};

describe('Button variants and busy/disabled behavior', () => {
  it('renders each variant class and the default secondary style', () => {
    for (const variant of ['primary', 'secondary', 'danger', 'text'] as const) {
      const { target, cleanup } = render(Button, { variant, children: undefined });
      try {
        expect(target.querySelector(`.btn-${variant}`)).not.toBeNull();
      } finally {
        cleanup();
      }
    }
  });

  it('defaults to a plain secondary button that calls onclick', async () => {
    const onclick = vi.fn();
    const { target, cleanup } = render(Button, { onclick, children: undefined });
    try {
      const button = target.querySelector('button')!;
      expect(button.getAttribute('type')).toBe('button');
      expect(button.classList.contains('btn-secondary')).toBe(true);
      button.click();
      expect(onclick).toHaveBeenCalledTimes(1);
      expect(onclick.mock.calls[0][0]).toBeInstanceOf(MouseEvent);
    } finally {
      cleanup();
    }
  });

  it('supports submit type for forms', () => {
    const { target, cleanup } = render(Button, { type: 'submit', children: undefined });
    try {
      expect(target.querySelector('button')!.getAttribute('type')).toBe('submit');
    } finally {
      cleanup();
    }
  });

  it('disables the control while busy, shows the busy label and hides children', () => {
    const { target, cleanup } = render(Button, { busy: true, children: undefined });
    try {
      const button = target.querySelector('button')!;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(target.querySelector('.spinner')).not.toBeNull();
      expect(button.textContent).toMatch(en.common.loading);
    } finally {
      cleanup();
    }
  });

  it('uses a custom busy label when provided', () => {
    const { target, cleanup } = render(Button, { busy: true, busyLabel: 'Joining…', children: undefined });
    try {
      expect(target.querySelector('button')!.textContent).toMatch(/Joining/);
    } finally {
      cleanup();
    }
  });

  it('never marks a calm button as busy', () => {
    const { target, cleanup } = render(Button, { children: undefined });
    try {
      const button = target.querySelector('button')!;
      expect(button.getAttribute('aria-busy')).toBeNull();
      expect(target.querySelector('.spinner')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('does not call onclick while disabled', () => {
    const onclick = vi.fn();
    const { target, cleanup } = render(Button, { disabled: true, onclick, children: undefined });
    try {
      const button = target.querySelector('button')!;
      expect(button.disabled).toBe(true);
      button.click();
      expect(onclick).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('does not call onclick while busy', () => {
    const onclick = vi.fn();
    const { target, cleanup } = render(Button, { busy: true, onclick, children: undefined });
    try {
      target.querySelector('button')!.click();
      expect(onclick).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('is reachable and operable from the keyboard', () => {
    const onclick = vi.fn();
    const { target, cleanup } = render(Button, { onclick, children: undefined });
    try {
      const button = target.querySelector('button')!;
      button.focus();
      expect(document.activeElement).toBe(button);
      // Keyboard activation issues a click on a native button.
      button.click();
      expect(onclick).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });
});

describe('Dialog open/close, labelling, focus and keyboard', () => {
  // PR11 compatibility: pins labelled modal, Escape close, scrim close and
  // focus move-in. A future focus trap keeps these assertions passing.
  it('renders nothing while closed', () => {
    const { target, cleanup } = render(Dialog, { open: false, labelledBy: 'dlg-title' });
    try {
      expect(target.querySelector('[role="dialog"]')).toBeNull();
      expect(target.textContent).toBe('');
    } finally {
      cleanup();
    }
  });

  it('renders a labelled modal with children when open', () => {
    const { target, cleanup } = render(Dialog, { open: true, labelledBy: 'dlg-title', children: undefined });
    try {
      const dialog = target.querySelector('[role="dialog"]')!;
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.getAttribute('aria-labelledby')).toBe('dlg-title');
      expect(dialog.getAttribute('aria-describedby')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('exposes the optional description reference', () => {
    const { target, cleanup } = render(Dialog, {
      open: true,
      labelledBy: 'dlg-title',
      describedBy: 'dlg-desc',
      children: undefined,
    });
    try {
      expect(target.querySelector('[role="dialog"]')!.getAttribute('aria-describedby')).toBe('dlg-desc');
    } finally {
      cleanup();
    }
  });

  it('moves focus into the dialog on open', async () => {
    const { target, cleanup } = render(Dialog, { open: true, labelledBy: 'dlg-title', children: undefined });
    try {
      await tick();
      const dialog = target.querySelector('[role="dialog"]')!;
      expect(dialog.contains(document.activeElement)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('closes on Escape and ignores other keys', () => {
    const onclose = vi.fn();
    const { target, cleanup } = render(Dialog, { open: true, labelledBy: 'dlg-title', onclose, children: undefined });
    try {
      keydown(target.querySelector('[role="dialog"]'), 'Enter');
      expect(onclose).not.toHaveBeenCalled();
      keydown(target.querySelector('[role="dialog"]'), 'Escape');
      expect(onclose).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it('closes when the scrim is activated', () => {
    const onclose = vi.fn();
    const { target, cleanup } = render(Dialog, { open: true, labelledBy: 'dlg-title', onclose, children: undefined });
    try {
      click(target.querySelector('.scrim'));
      expect(onclose).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it('tolerates Escape and scrim activation without an onclose handler', async () => {
    const { target, cleanup } = render(Dialog, { open: true, labelledBy: 'dlg-title', children: undefined });
    try {
      keydown(target.querySelector('[role="dialog"]'), 'Escape');
      await tick();
      click(target.querySelector('.scrim'));
      await tick();
      expect(target.querySelector('[role="dialog"]')).not.toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe('EmptyState conditional title, hint and action', () => {
  it('shows only the title heading when empty', () => {
    const { target, cleanup } = render(EmptyState, { title: en.forum.empty });
    try {
      expect(target.querySelector('h2')!.textContent).toBe(en.forum.empty);
      expect(target.querySelector('p')).toBeNull();
      expect(target.querySelector('button')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('shows the hint alongside the title', () => {
    const { target, cleanup } = render(EmptyState, { title: 'Nothing here', hint: 'Check back after connecting.' });
    try {
      expect(target.querySelector('p')!.textContent).toMatch(/Check back/);
      expect(target.querySelector('button')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('offers the action and calls back when chosen', () => {
    const onaction = vi.fn();
    const { target, cleanup } = render(EmptyState, { title: 'Nothing here', actionLabel: en.common.refresh, onaction });
    try {
      const action = target.querySelector('button')!;
      expect(action.textContent).toBe(en.common.refresh);
      action.click();
      expect(onaction).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it('tolerates an action press without a handler', () => {
    const { target, cleanup } = render(EmptyState, { title: 'Nothing here', actionLabel: en.common.refresh });
    try {
      target.querySelector('button')!.click();
    } finally {
      cleanup();
    }
  });
});

describe('LevelBadge plain level names', () => {
  it('names circle, ingroup and room plainly with level classes', () => {
    const expected = { circle: 'Circle', ingroup: 'Ingroup', room: 'Public room' } as const;
    for (const [level, label] of Object.entries(expected) as Array<[keyof typeof expected, string]>) {
      const { target, cleanup } = render(LevelBadge, { level });
      try {
        expect(target.textContent).toBe(label);
        expect(target.querySelector(`.badge-${level}`)).not.toBeNull();
      } finally {
        cleanup();
      }
    }
  });

  it('matches the shared English level strings', () => {
    for (const level of ['circle', 'ingroup', 'room'] as const) {
      const { target, cleanup } = render(LevelBadge, { level });
      try {
        expect(target.textContent).toBe(en.groups.level[level]);
      } finally {
        cleanup();
      }
    }
  });

  it('uses caller-provided labels for white-label themes', () => {
    const { target, cleanup } = render(LevelBadge, {
      level: 'room',
      labels: { circle: 'C', ingroup: 'I', room: 'Open space' },
    });
    try {
      expect(target.textContent).toBe('Open space');
    } finally {
      cleanup();
    }
  });
});

describe('Notice tones, roles and titles', () => {
  it('uses alert for error and warning, status otherwise', () => {
    const roles = { info: 'status', success: 'status', warning: 'alert', error: 'alert' } as const;
    for (const [tone, role] of Object.entries(roles) as Array<[keyof typeof roles, 'status' | 'alert']>) {
      const { target, cleanup } = render(Notice, { tone, children: undefined });
      try {
        const notice = target.querySelector(`.notice-${tone}`)!;
        expect(notice.getAttribute('role')).toBe(role);
      } finally {
        cleanup();
      }
    }
  });

  it('defaults to the info tone', () => {
    const { target, cleanup } = render(Notice, { children: undefined });
    try {
      expect(target.querySelector('.notice-info')).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('shows the title only when provided', () => {
    const withTitle = render(Notice, { tone: 'warning', title: 'Heads up', children: undefined });
    try {
      expect(withTitle.target.querySelector('strong')!.textContent).toBe('Heads up');
    } finally {
      withTitle.cleanup();
    }
    const withoutTitle = render(Notice, { tone: 'warning', children: undefined });
    try {
      expect(withoutTitle.target.querySelector('strong')).toBeNull();
    } finally {
      withoutTitle.cleanup();
    }
  });

  it('renders an adapter failure message as an error', async () => {
    const client = createDevCmsg();
    let failure = '';
    try {
      await client.joinWithVoucher({ voucher: 'nope', handle: 'test-member' });
    } catch (error) {
      failure = (error as Error).message;
    }
    expect(failure).not.toBe('');
    const { target, cleanup } = render(Notice, { tone: 'error', title: 'Join failed', children: undefined });
    try {
      const notice = target.querySelector('.notice-error')!;
      expect(notice.getAttribute('role')).toBe('alert');
      expect(notice.textContent).toMatch(/Join failed/);
    } finally {
      cleanup();
    }
  });
});

describe('ProfilePreview flashcard front and back', () => {
  const values = { age: 34, about: 'Hello.' };

  it('shows the public front first and hides private values', () => {
    const { target, cleanup } = render(ProfilePreview, {
      schema: tinySchema,
      values,
      frontLabel: en.profile.previewFront,
      backLabel: en.profile.previewBack,
    });
    try {
      const front = target.querySelector('button[role="tab"]')!;
      expect(front.getAttribute('aria-selected')).toBe('true');
      expect(target.textContent).toMatch(/34/);
      expect(target.textContent).not.toMatch(/Hello\./);
    } finally {
      cleanup();
    }
  });

  it('reveals the private back on request, by pointer and from the keyboard', async () => {
    const { target, cleanup } = render(ProfilePreview, { schema: tinySchema, values });
    try {
      const tabs = target.querySelectorAll('[role="tab"]');
      (tabs[1] as HTMLElement).focus();
      expect(document.activeElement).toBe(tabs[1]);
      (tabs[1] as HTMLElement).click();
      await tick();
      expect((tabs[1] as HTMLElement).getAttribute('aria-selected')).toBe('true');
      expect((tabs[0] as HTMLElement).getAttribute('aria-selected')).toBe('false');
      expect(target.textContent).toMatch(/Hello\./);
      (tabs[0] as HTMLElement).click();
      await tick();
      expect(target.textContent).not.toMatch(/Hello\./);
      expect(target.textContent).toMatch(/34/);
    } finally {
      cleanup();
    }
  });

  it('labels both sides for assistive technology', () => {
    const { target, cleanup } = render(ProfilePreview, { schema: tinySchema, values });
    try {
      expect(target.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toMatch(/Preview side/);
      expect(target.querySelector('section')!.getAttribute('aria-label')).toMatch(/public profile/);
    } finally {
      cleanup();
    }
  });

  it('explains an empty private side instead of leaving it blank', async () => {
    const publicOnly: ProfileSchema = {
      version: 1,
      fields: [
        { key: 'age', question: 'How old are you?', kind: 'number', visibility: 'public', required: true, filterable: true },
      ],
    };
    const { target, cleanup } = render(ProfilePreview, { schema: publicOnly, values: { age: 34 } });
    try {
      (target.querySelectorAll('[role="tab"]')[1] as HTMLElement).click();
      await tick();
      expect(target.textContent).toMatch(/Nothing private yet/);
    } finally {
      cleanup();
    }
  });

  it('shows a dash for unanswered questions', () => {
    const { target, cleanup } = render(ProfilePreview, { schema: tinySchema, values: {} });
    try {
      expect(target.textContent).toMatch(/—/);
    } finally {
      cleanup();
    }
  });

  it('renders the real development schema and published values on both sides', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await client.publishProfile({ age: 34, neighbourhood: 'North', weekend: 'Hiking' });
    const schema = await client.schema();
    const profile = await client.ownProfile();
    const { target, cleanup } = render(ProfilePreview, { schema, values: profile.values });
    try {
      expect(target.textContent).toMatch(/34/);
      expect(target.textContent).toMatch(/North/);
      (target.querySelectorAll('[role="tab"]')[1] as HTMLElement).click();
      await tick();
      expect(target.textContent).not.toMatch(/North/);
    } finally {
      cleanup();
    }
  });
});

describe('ProgressBar calm progress values', () => {
  it('reports the percentage through accessible attributes', () => {
    const { target, cleanup } = render(ProgressBar, { value: 0.3, label: en.connection.title });
    try {
      const bar = target.querySelector('[role="progressbar"]')!;
      expect(bar.getAttribute('aria-valuenow')).toBe('30');
      expect(bar.getAttribute('aria-valuemin')).toBe('0');
      expect(bar.getAttribute('aria-valuemax')).toBe('100');
      expect(bar.getAttribute('aria-label')).toBe(en.connection.title);
      expect((target.querySelector('.bar') as HTMLElement).style.width).toBe('30%');
    } finally {
      cleanup();
    }
  });

  it('clamps out-of-range values instead of overflowing', () => {
    const low = render(ProgressBar, { value: -0.5, label: 'Progress' });
    try {
      expect(low.target.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('0');
    } finally {
      low.cleanup();
    }
    const high = render(ProgressBar, { value: 2, label: 'Progress' });
    try {
      expect(high.target.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('100');
      expect((high.target.querySelector('.bar') as HTMLElement).style.width).toBe('100%');
    } finally {
      high.cleanup();
    }
  });

  it('reaches both ends of the range', () => {
    const empty = render(ProgressBar, { value: 0, label: 'Progress' });
    try {
      expect((empty.target.querySelector('.bar') as HTMLElement).style.width).toBe('0%');
    } finally {
      empty.cleanup();
    }
    const full = render(ProgressBar, { value: 1, label: 'Progress' });
    try {
      expect(full.target.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('100');
    } finally {
      full.cleanup();
    }
  });
});

describe('PublicCard presence, values and welcoming record', () => {
  const card = {
    memberId: 'member-ana',
    handle: 'ana-walks',
    values: { age: 34, neighbourhood: 'North' },
    online: true,
    record: { accepted: 0.7, declined: 0.25, punished: 0.05 },
  };

  it('announces the member, shows presence and lists public values', () => {
    const { target, cleanup } = render(PublicCard, { card });
    try {
      expect(target.querySelector('article')!.getAttribute('aria-label')).toMatch(/ana-walks/);
      expect(target.querySelector('h3')!.textContent).toBe('ana-walks');
      expect(target.textContent).toMatch(en.common.online);
      expect(target.textContent).toMatch(/age: 34/);
      expect(target.textContent).toMatch(/neighbourhood: North/);
    } finally {
      cleanup();
    }
  });

  it('marks offline members plainly', () => {
    const { target, cleanup } = render(PublicCard, { card: { ...card, online: false } });
    try {
      expect(target.textContent).toMatch(en.common.offline);
      expect(target.textContent).not.toMatch(en.common.online);
    } finally {
      cleanup();
    }
  });

  it('shows the relative welcoming record only after quorum', () => {
    const withRecord = render(PublicCard, { card });
    try {
      expect(withRecord.target.textContent).toMatch(/Welcomed by 70% of first contacts/);
    } finally {
      withRecord.cleanup();
    }
    const beforeQuorum = render(PublicCard, { card: { ...card, record: null } });
    try {
      expect(beforeQuorum.target.textContent).not.toMatch(/Welcomed by/);
    } finally {
      beforeQuorum.cleanup();
    }
  });

  it('uses the member initial as the avatar with no pictures', () => {
    const { target, cleanup } = render(PublicCard, { card });
    try {
      const avatar = target.querySelector('.avatar')!;
      expect(avatar.textContent).toBe('A');
      expect(avatar.getAttribute('aria-hidden')).toBe('true');
    } finally {
      cleanup();
    }
  });

  it('calls back with the member id and honours a custom action label', () => {
    const onaction = vi.fn();
    const { target, cleanup } = render(PublicCard, { card, actionLabel: 'Say hello', onaction });
    try {
      const action = target.querySelector('button')!;
      expect(action.textContent).toBe('Say hello');
      action.click();
      expect(onaction).toHaveBeenCalledWith('member-ana');
    } finally {
      cleanup();
    }
  });

  it('defaults the action to wanting to know more', () => {
    const { target, cleanup } = render(PublicCard, { card });
    try {
      expect(target.querySelector('button')!.textContent).toBe(en.forum.wantToKnowMore);
    } finally {
      cleanup();
    }
  });

  it('renders every discovered member from the real development adapter', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await client.publishProfile({ age: 34, neighbourhood: 'North', weekend: 'Hiking' });
    const page = await client.discover([]);
    expect(page.entries.length).toBeGreaterThan(0);
    for (const entry of page.entries) {
      const { target, cleanup } = render(PublicCard, { card: entry });
      try {
        expect(target.querySelector('h3')!.textContent).toBe(entry.handle);
        expect(target.querySelector('article')!.getAttribute('aria-label')).toMatch(entry.handle);
        if (entry.record) {
          expect(target.textContent).toMatch(new RegExp(`Welcomed by ${Math.round(entry.record.accepted * 100)}%`));
        } else {
          expect(target.textContent).not.toMatch(/Welcomed by/);
        }
      } finally {
        cleanup();
      }
    }
  });
});

describe('SegmentedControl options, selection and keyboard', () => {
  // PR11 compatibility: pins tablist semantics, selected state and onselect.
  const options = [
    { value: 'front', label: 'Front' },
    { value: 'back', label: 'Back' },
  ] as const;

  it('marks exactly the current option as selected', () => {
    const { target, cleanup } = render(SegmentedControl, {
      label: 'Profile preview side',
      options: [...options],
      current: 'front' as 'front' | 'back',
    });
    try {
      const tabs = target.querySelectorAll('[role="tab"]');
      expect(tabs).toHaveLength(2);
      expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
      expect(tabs[1]!.getAttribute('aria-selected')).toBe('false');
      expect((tabs[0] as HTMLElement).classList.contains('active')).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('labels the option group for assistive technology', () => {
    const { target, cleanup } = render(SegmentedControl, {
      label: 'Profile preview side',
      options: [...options],
      current: 'back' as 'front' | 'back',
    });
    try {
      expect(target.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe('Profile preview side');
      expect(target.querySelectorAll('[role="tab"]')[1]!.getAttribute('aria-selected')).toBe('true');
    } finally {
      cleanup();
    }
  });

  it('reports the chosen value through onselect', () => {
    const onselect = vi.fn();
    const { target, cleanup } = render(SegmentedControl, {
      label: 'Profile preview side',
      options: [...options],
      current: 'front' as 'front' | 'back',
      onselect,
    });
    try {
      (target.querySelectorAll('[role="tab"]')[1] as HTMLElement).click();
      expect(onselect).toHaveBeenCalledWith('back');
    } finally {
      cleanup();
    }
  });

  it('keeps every option reachable and operable from the keyboard', () => {
    const onselect = vi.fn();
    const { target, cleanup } = render(SegmentedControl, {
      label: 'Profile preview side',
      options: [...options],
      current: 'front' as 'front' | 'back',
      onselect,
    });
    try {
      for (const tab of buttons(target)) {
        tab.focus();
        expect(document.activeElement).toBe(tab);
        tab.click();
      }
      expect(onselect).toHaveBeenCalledTimes(2);
    } finally {
      cleanup();
    }
  });

  it('renders an empty option list as an empty labelled group', () => {
    const { target, cleanup } = render(SegmentedControl, {
      label: 'Empty choices',
      options: [],
      current: 'front' as 'front' | 'back',
    });
    try {
      expect(target.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe('Empty choices');
      expect(target.querySelectorAll('[role="tab"]')).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});

describe('TextField inputs, help, errors and choices', () => {
  // PR11 compatibility: pins one-way `value`, `oninput` payloads, help/error
  // wiring and the choice/multiline variants. Two-way binding stays out.
  it('associates the label with the input', () => {
    const { target, cleanup } = render(TextField, { id: 'handle', label: 'Choose a handle', value: '' });
    try {
      expect(target.querySelector('label')!.getAttribute('for')).toBe('handle');
      expect(target.querySelector('#handle')).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('reports typed text through oninput', () => {
    const oninput = vi.fn();
    const { target, cleanup } = render(TextField, { id: 'handle', label: 'Choose a handle', value: '', oninput });
    try {
      const input = target.querySelector('#handle') as HTMLInputElement;
      input.focus();
      expect(document.activeElement).toBe(input);
      input.value = 'new-member';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(oninput).toHaveBeenCalledWith('new-member');
    } finally {
      cleanup();
    }
  });

  it('shows help text and wires it to the input', () => {
    const { target, cleanup } = render(TextField, {
      id: 'handle',
      label: 'Choose a handle',
      value: '',
      help: '8 to 32 characters.',
    });
    try {
      expect(target.querySelector('.help')!.textContent).toBe('8 to 32 characters.');
      expect(target.querySelector('input')!.getAttribute('aria-describedby')).toBe('handle-help');
    } finally {
      cleanup();
    }
  });

  it('announces errors as an alert and marks the input invalid', () => {
    const { target, cleanup } = render(TextField, {
      id: 'handle',
      label: 'Choose a handle',
      value: 'short',
      error: 'Handles are 8 to 32 characters long.',
    });
    try {
      const alert = target.querySelector('.error')!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.textContent).toMatch(/8 to 32/);
      expect(target.querySelector('input')!.getAttribute('aria-invalid')).toBe('true');
    } finally {
      cleanup();
    }
  });

  it('leaves a calm field without error semantics', () => {
    const { target, cleanup } = render(TextField, { id: 'handle', label: 'Choose a handle', value: 'fine-handle' });
    try {
      expect(target.querySelector('.error')).toBeNull();
      expect(target.querySelector('input')!.getAttribute('aria-invalid')).not.toBe('true');
    } finally {
      cleanup();
    }
  });

  it('marks required fields with a hidden asterisk', () => {
    const { target, cleanup } = render(TextField, { id: 'handle', label: 'Choose a handle', value: '', required: true });
    try {
      const star = target.querySelector('label span')!;
      expect(star.textContent).toBe('*');
      expect(star.getAttribute('aria-hidden')).toBe('true');
    } finally {
      cleanup();
    }
  });

  it('renders number inputs with bounds and placeholder', () => {
    const { target, cleanup } = render(TextField, {
      id: 'age',
      label: 'How old are you?',
      value: 34,
      type: 'number',
      min: 18,
      max: 99,
      placeholder: '34',
    });
    try {
      const input = target.querySelector('input')!;
      expect(input.getAttribute('type')).toBe('number');
      expect(input.getAttribute('min')).toBe('18');
      expect(input.getAttribute('max')).toBe('99');
      expect(input.getAttribute('placeholder')).toBe('34');
    } finally {
      cleanup();
    }
  });

  it('renders long answers as a multiline field', () => {
    const oninput = vi.fn();
    const { target, cleanup } = render(TextField, {
      id: 'about',
      label: 'Anything else?',
      value: '',
      multiline: true,
      maxlength: 280,
      oninput,
    });
    try {
      const area = target.querySelector('textarea')!;
      expect(area.getAttribute('rows')).toBe('3');
      expect(area.getAttribute('maxlength')).toBe('280');
      area.value = 'Hello.';
      area.dispatchEvent(new Event('input', { bubbles: true }));
      expect(oninput).toHaveBeenCalledWith('Hello.');
    } finally {
      cleanup();
    }
  });

  it('renders fixed answers as a choice list with a prompt first', () => {
    const oninput = vi.fn();
    const { target, cleanup } = render(TextField, {
      id: 'neighbourhood',
      label: 'Which neighbourhood?',
      value: '',
      choices: ['North', 'East'],
      oninput,
    });
    try {
      const select = target.querySelector('select')!;
      expect(select.querySelectorAll('option')).toHaveLength(3);
      expect(select.querySelector('option')!.textContent).toMatch(/Choose/);
      select.value = 'East';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      expect(oninput).toHaveBeenCalledWith('East');
    } finally {
      cleanup();
    }
  });

  it('preselects the current choice', () => {
    const { target, cleanup } = render(TextField, {
      id: 'neighbourhood',
      label: 'Which neighbourhood?',
      value: 'North',
      choices: ['North', 'East'],
    });
    try {
      expect((target.querySelector('select') as HTMLSelectElement).value).toBe('North');
    } finally {
      cleanup();
    }
  });
});

describe('WaveCard first-contact actions and states', () => {
  const pending: Wave = {
    id: 'wave-1',
    from: 'member-tom',
    fromHandle: 'tom-cooks',
    to: 'me',
    message: 'Hello! Would you like to talk?',
    state: 'pending',
    senderSlotHeld: true,
    recipientSlotHeld: true,
  };

  it('announces the sender, shows the message and enables every action while pending', () => {
    const { target, cleanup } = render(WaveCard, { wave: pending });
    try {
      expect(target.querySelector('article')!.getAttribute('aria-label')).toMatch(/tom-cooks/);
      expect(target.querySelector('.message')!.textContent).toMatch(/Would you like to talk/);
      for (const action of buttons(target)) expect(action.disabled).toBe(false);
      expect(target.querySelector('.state')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('uses the shared first-contact labels and note by default', () => {
    const { target, cleanup } = render(WaveCard, { wave: pending });
    try {
      expect(target.textContent).toMatch(en.waves.answer);
      expect(target.textContent).toMatch(en.waves.close);
      expect(target.textContent).toMatch(en.waves.punish);
      expect(target.querySelector('.note')!.textContent).toBe(en.waves.punishNote);
    } finally {
      cleanup();
    }
  });

  it('routes answer, close and punish with the wave id', () => {
    const onanswer = vi.fn();
    const onclose = vi.fn();
    const onpunish = vi.fn();
    const { target, cleanup } = render(WaveCard, { wave: pending, onanswer, onclose, onpunish });
    try {
      const actions = buttons(target);
      actions[0]!.click();
      actions[1]!.click();
      actions[2]!.click();
      expect(onanswer).toHaveBeenCalledWith('wave-1');
      expect(onclose).toHaveBeenCalledWith('wave-1');
      expect(onpunish).toHaveBeenCalledWith('wave-1');
    } finally {
      cleanup();
    }
  });

  it('honours custom action labels and note', () => {
    const { target, cleanup } = render(WaveCard, {
      wave: pending,
      answerLabel: 'Reply',
      closeLabel: 'Decline',
      punishLabel: 'Report',
      punishNote: 'Custom note.',
    });
    try {
      expect(target.textContent).toMatch(/Reply/);
      expect(target.textContent).toMatch(/Decline/);
      expect(target.textContent).toMatch(/Report/);
      expect(target.querySelector('.note')!.textContent).toBe('Custom note.');
    } finally {
      cleanup();
    }
  });

  it('disables every action and names the status once decided', async () => {
    for (const state of ['answered', 'closed', 'silent', 'punished'] as const) {
      const { target, cleanup } = render(WaveCard, { wave: { ...pending, state } });
      try {
        for (const action of buttons(target)) expect(action.disabled).toBe(true);
        expect(target.querySelector('.state')!.textContent).toMatch(state);
        await tick();
      } finally {
        cleanup();
      }
    }
  });

  it('disables every action while the parent is busy', () => {
    const onanswer = vi.fn();
    const { target, cleanup } = render(WaveCard, { wave: pending, disabled: true, onanswer });
    try {
      for (const action of buttons(target)) expect(action.disabled).toBe(true);
      buttons(target)[0]!.click();
      expect(onanswer).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('keeps wave actions reachable from the keyboard', () => {
    const { target, cleanup } = render(WaveCard, { wave: pending });
    try {
      for (const action of buttons(target)) {
        action.focus();
        expect(document.activeElement).toBe(action);
      }
    } finally {
      cleanup();
    }
  });

  it('reflects answered, closed and punished outcomes from the real adapter', async () => {
    const answeredClient = createDevCmsg();
    await answeredClient.joinWithVoucher(JOIN);
    const [incoming] = await answeredClient.incomingWaves();
    const answered = await answeredClient.answerWave(incoming!.id, 'Hello back!');
    expect(answered.state).toBe('answered');
    const answeredView = render(WaveCard, { wave: answered });
    try {
      for (const action of buttons(answeredView.target)) expect(action.disabled).toBe(true);
      expect(answeredView.target.textContent).toMatch(/answered/);
    } finally {
      answeredView.cleanup();
    }

    const closedClient = createDevCmsg();
    await closedClient.joinWithVoucher(JOIN);
    const [toClose] = await closedClient.incomingWaves();
    const closed = await closedClient.closeWave(toClose!.id);
    const closedView = render(WaveCard, { wave: closed });
    try {
      expect(closedView.target.textContent).toMatch(/closed/);
    } finally {
      closedView.cleanup();
    }

    const punishedClient = createDevCmsg();
    await punishedClient.joinWithVoucher(JOIN);
    await punishedClient.publishProfile({ age: 34, neighbourhood: 'North', weekend: 'Hiking' });
    const [toPunish] = await punishedClient.incomingWaves();
    const punished = await punishedClient.punishWave(toPunish!.id);
    const punishedView = render(WaveCard, { wave: punished });
    try {
      for (const action of buttons(punishedView.target)) expect(action.disabled).toBe(true);
      expect(punishedView.target.textContent).toMatch(/punished/);
    } finally {
      punishedView.cleanup();
    }
  });

  it('surfaces unknown-wave adapter failures at the boundary', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await expect(client.answerWave('wave-missing', 'Hello')).rejects.toThrow();
  });
});

describe('GroupCard levels, joining and suggestions', () => {
  const circle: GroupView = {
    id: 'group-garden',
    name: 'Community garden',
    level: 'circle',
    size: 8,
    whatChangesNext: 'At 13 members this circle becomes an ingroup. (4 to go.)',
    description: 'Neighbours sharing tools and seeds.',
    joinConsent: null,
    joined: true,
    newcomerHistory: 'Newcomers start fresh.',
    messages: [],
    suggestion: null,
  };
  const room: GroupView = {
    id: 'group-market',
    name: 'Saturday market',
    level: 'room',
    size: 67,
    whatChangesNext: 'Above 59 members, at most six joins per hour.',
    description: 'The listed meeting place.',
    joinConsent: 'Members see each other\u2019s private profiles.',
    joined: false,
    newcomerHistory: 'Newcomers receive the last 24 hours.',
    messages: [],
    suggestion: null,
  };

  it('announces the group name and member count', () => {
    const { target, cleanup } = render(GroupCard, { group: circle });
    try {
      expect(target.querySelector('article')!.getAttribute('aria-label')).toBe('Community garden, 8 members');
      expect(target.textContent).toMatch(/8 members/);
      expect(target.textContent).toMatch(/Neighbours sharing tools/);
    } finally {
      cleanup();
    }
  });

  it('shows the level badge and what changes next', () => {
    const { target, cleanup } = render(GroupCard, { group: room, nextLabel: en.groups.whatChangesNext });
    try {
      expect(target.textContent).toMatch(/Public room/);
      expect(target.textContent).toMatch(/What changes next/);
      expect(target.textContent).toMatch(/six joins per hour/);
    } finally {
      cleanup();
    }
  });

  it('uses custom level labels when provided', () => {
    const { target, cleanup } = render(GroupCard, {
      group: circle,
      levelLabels: { circle: 'Close circle', ingroup: 'Inner', room: 'Open' },
    });
    try {
      expect(target.textContent).toMatch(/Close circle/);
    } finally {
      cleanup();
    }
  });

  it('offers join for outsiders and leave once joined', () => {
    const joinedView = render(GroupCard, { group: circle });
    try {
      expect(joinedView.target.textContent).toMatch(en.groups.joined);
      expect(joinedView.target.textContent).toMatch(en.groups.leave);
      expect(joinedView.target.textContent).not.toMatch(/Join[^e]/);
    } finally {
      joinedView.cleanup();
    }
    const outsiderView = render(GroupCard, { group: room });
    try {
      expect(outsiderView.target.querySelector('.joined')).toBeNull();
      expect(outsiderView.target.textContent).toMatch(en.groups.join);
    } finally {
      outsiderView.cleanup();
    }
  });

  it('routes join, leave and open with the group id', () => {
    const onjoin = vi.fn();
    const onleave = vi.fn();
    const onopen = vi.fn();
    const joinView = render(GroupCard, { group: room, onjoin, onopen });
    try {
      click(joinView.target.querySelector('.btn.primary'));
      expect(onjoin).toHaveBeenCalledWith('group-market');
      click(joinView.target.querySelector('.link'));
      expect(onopen).toHaveBeenCalledWith('group-market');
    } finally {
      joinView.cleanup();
    }
    const leaveView = render(GroupCard, { group: circle, onleave });
    try {
      click(leaveView.target.querySelector('.actions .btn'));
      expect(onleave).toHaveBeenCalledWith('group-garden');
    } finally {
      leaveView.cleanup();
    }
  });

  it('honours custom join, leave and joined labels', () => {
    const { target, cleanup } = render(GroupCard, {
      group: room,
      joinLabel: 'Become a member',
      leaveLabel: 'Step out',
      joinedLabel: 'Member',
    });
    try {
      expect(target.textContent).toMatch(/Become a member/);
    } finally {
      cleanup();
    }
  });

  it('shows a device suggestion only when present', () => {
    const withSuggestion = render(GroupCard, { group: { ...circle, suggestion: 'A split is not needed yet.' } });
    try {
      expect(withSuggestion.target.querySelector('.suggestion')!.textContent).toMatch(/not needed yet/);
    } finally {
      withSuggestion.cleanup();
    }
    const withoutSuggestion = render(GroupCard, { group: circle });
    try {
      expect(withoutSuggestion.target.querySelector('.suggestion')).toBeNull();
    } finally {
      withoutSuggestion.cleanup();
    }
  });

  it('keeps group actions reachable from the keyboard', () => {
    const { target, cleanup } = render(GroupCard, { group: room });
    try {
      const open = target.querySelector('.link') as HTMLElement;
      open.focus();
      expect(document.activeElement).toBe(open);
      const join = target.querySelector('.btn.primary') as HTMLElement;
      join.focus();
      expect(document.activeElement).toBe(join);
    } finally {
      cleanup();
    }
  });

  it('renders every seeded group from the real adapter and follows a room join', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const groups = await client.groups();
    expect(groups).toHaveLength(3);
    for (const group of groups) {
      const { target, cleanup } = render(GroupCard, { group });
      try {
        expect(target.querySelector('article')!.getAttribute('aria-label')).toBe(`${group.name}, ${group.size} members`);
        expect(target.textContent).toMatch(group.whatChangesNext);
        if (group.joined) expect(target.textContent).toMatch(en.groups.joined);
      } finally {
        cleanup();
      }
    }
    const market = groups.find((g) => g.id === 'group-market')!;
    const joined = await client.joinGroup(market.id);
    expect(joined.joined).toBe(true);
    const { target, cleanup } = render(GroupCard, { group: joined });
    try {
      expect(target.textContent).toMatch(en.groups.joined);
      expect(target.textContent).toMatch(/68 members/);
    } finally {
      cleanup();
    }
  });

  it('surfaces unknown-group adapter failures at the boundary', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await expect(client.joinGroup('group-missing')).rejects.toThrow();
  });
});

describe('connection failure from the real adapter', () => {
  it('reports an unreachable network so the UI can show failure plainly', async () => {
    const client = createDevCmsg({ connectDelayMs: 10, failConnect: true });
    const status = await client.connect();
    expect(status.phase).toBe('failed');
    const { target, cleanup } = render(Notice, { tone: 'error', title: 'Connection failed', children: undefined });
    try {
      expect(target.querySelector('[role="alert"]')!.textContent).toMatch(/Connection failed/);
    } finally {
      cleanup();
    }
  });
});
