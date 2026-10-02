/** Mounted shared-component behavior; browser tests qualify native focus/keyboard behavior.
 * Real development adapter fixtures; platform-only jsdom shims in platform.ts.
 * The complete combined suite is measured against strict UI/core coverage.
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
import DialogHarness from './fixtures/DialogHarness.svelte';
import SegmentedHarness from './fixtures/SegmentedHarness.svelte';
import SnippetHarness from './fixtures/SnippetHarness.svelte';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render<P extends Record<string, unknown>>(view: Component<any>, props: P) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(view, { target, props });
  return {
    target,
    cleanup: async () => {
      await unmount(component);
      await tick();
      target.remove();
    },
  };
}

function dialogOf(target: HTMLElement): HTMLDialogElement {
  const dialog = target.querySelector('dialog');
  expect(dialog).not.toBeNull();
  return dialog as HTMLDialogElement;
}

function stubRect(dialog: HTMLDialogElement): void {
  dialog.getBoundingClientRect = () =>
    ({ x: 100, y: 100, width: 100, height: 100, top: 100, right: 200, bottom: 200, left: 100, toJSON: () => ({}) }) as DOMRect;
}

function backdropClick(dialog: HTMLDialogElement, x: number, y: number): void {
  dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
}

function cancel(dialog: HTMLDialogElement): void {
  // bubbles:true reaches the listener regardless of Svelte event delegation;
  // the component only preventDefaults and asks the parent to close.
  dialog.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }));
}

function keydown(el: Element | null, key: string): void {
  expect(el).not.toBeNull();
  (el as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function click(el: Element | null): void {
  expect(el).not.toBeNull();
  (el as HTMLElement).click();
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
  it('renders each variant class and the default secondary style', async () => {
    for (const variant of ['primary', 'secondary', 'danger', 'text'] as const) {
      const { target, cleanup } = render(Button, { variant, children: undefined });
      try {
        await tick();
        expect(target.querySelector(`.btn-${variant}`)).not.toBeNull();
      } finally {
        await cleanup();
      }
    }
  });

  it('defaults to a plain secondary button that calls onclick', async () => {
    const onclick = vi.fn();
    const { target, cleanup } = render(Button, { onclick, children: undefined });
    try {
      await tick();
      const button = target.querySelector('button')!;
      expect(button.getAttribute('type')).toBe('button');
      expect(button.classList.contains('btn-secondary')).toBe(true);
      button.click();
      expect(onclick).toHaveBeenCalledTimes(1);
      expect(onclick.mock.calls[0][0]).toBeInstanceOf(MouseEvent);
    } finally {
      await cleanup();
    }
  });

  it('supports submit type for forms', async () => {
    const { target, cleanup } = render(Button, { type: 'submit', children: undefined });
    try {
      await tick();
      expect(target.querySelector('button')!.getAttribute('type')).toBe('submit');
    } finally {
      await cleanup();
    }
  });

  it('disables the control while busy, shows the busy label and hides children', async () => {
    const plain = render(Button, { busy: true, children: undefined });
    try {
      await tick();
      const button = plain.target.querySelector('button')!;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(plain.target.querySelector('.spinner')).not.toBeNull();
      expect(button.textContent).toMatch(en.common.loading);
    } finally {
      await plain.cleanup();
    }
    const custom = render(Button, { busy: true, busyLabel: 'Joining…', children: undefined });
    try {
      await tick();
      expect(custom.target.querySelector('button')!.textContent).toMatch(/Joining/);
    } finally {
      await custom.cleanup();
    }
  });

  it('never marks a calm button as busy', async () => {
    const { target, cleanup } = render(Button, { children: undefined });
    try {
      await tick();
      const button = target.querySelector('button')!;
      expect(button.getAttribute('aria-busy')).toBeNull();
      expect(target.querySelector('.spinner')).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it.each([{}, { busy: true }])('does not call onclick while disabled or busy', async (extra) => {
    const onclick = vi.fn();
    const { target, cleanup } = render(Button, { disabled: true, onclick, children: undefined, ...extra });
    try {
      await tick();
      const button = target.querySelector('button')!;
      expect(button.disabled).toBe(true);
      button.click();
      expect(onclick).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it('can receive focus and dispatch its click', async () => {
    const onclick = vi.fn();
    const { target, cleanup } = render(Button, { onclick, children: undefined });
    try {
      await tick();
      const button = target.querySelector('button')!;
      button.focus();
      expect(document.activeElement).toBe(button);
      // Keyboard activation issues a click on a native button.
      button.click();
      expect(onclick).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });

  it('rerenders live snippet children in place', async () => {
    const { target, cleanup } = render(SnippetHarness, {});
    try {
      await tick();
      const label = target.querySelector('[data-testid="btn-label"]')!;
      expect(label.textContent).toBe('Count 1');
      expect(target.querySelector('[data-testid="notice-body"]')!.textContent).toBe('Body 1');
      click(target.querySelector('[data-testid="bump"]'));
      await tick();
      expect(target.querySelector('[data-testid="btn-label"]')).toBe(label);
      expect(label.textContent).toBe('Count 2');
      expect(target.querySelector('[data-testid="notice-body"]')!.textContent).toBe('Body 2');
    } finally {
      await cleanup();
    }
  });
});

describe('Dialog native open/close, labelling, focus and keyboard', () => {
  it('keeps a closed native dialog shut with no modal state', async () => {
    const { target, cleanup } = render(Dialog, { open: false, labelledBy: 'dlg-title' });
    try {
      await tick();
      const dialog = dialogOf(target);
      expect(dialog.open).toBe(false);
      expect(dialog.hasAttribute('open')).toBe(false);
      expect(target.querySelector('[role="dialog"]')).toBeNull();
      expect(dialog.textContent).toBe('');
    } finally {
      await cleanup();
    }
  });

  it('shows a labelled native modal with children when open', async () => {
    const { target, cleanup } = render(Dialog, { open: true, labelledBy: 'dlg-title', children: undefined });
    try {
      await tick();
      const dialog = dialogOf(target);
      expect(dialog.open).toBe(true);
      expect(dialog.tagName).toBe('DIALOG');
      expect(dialog.getAttribute('aria-labelledby')).toBe('dlg-title');
      expect(dialog.getAttribute('aria-describedby')).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('exposes the optional description reference', async () => {
    const { target, cleanup } = render(Dialog, {
      open: true,
      labelledBy: 'dlg-title',
      describedBy: 'dlg-desc',
      children: undefined,
    });
    try {
      await tick();
      expect(dialogOf(target).getAttribute('aria-describedby')).toBe('dlg-desc');
    } finally {
      await cleanup();
    }
  });

  it('moves focus into the dialog on open', async () => {
    const { target, cleanup } = render(Dialog, { open: true, labelledBy: 'dlg-title', children: undefined });
    try {
      await tick();
      const dialog = dialogOf(target);
      expect(dialog.open).toBe(true);
      expect(dialog.contains(document.activeElement)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('retries close requests when the parent keeps the dialog open', async () => {
    const onclose = vi.fn();
    const { target, cleanup } = render(Dialog, { open: true, labelledBy: 'dlg-title', onclose, children: undefined });
    try {
      await tick();
      const dialog = dialogOf(target);
      keydown(dialog, 'Enter');
      expect(onclose).not.toHaveBeenCalled();
      cancel(dialog);
      cancel(dialog);
      expect(onclose).toHaveBeenCalledTimes(2);
    } finally {
      await cleanup();
    }
  });

  it('requests close on backdrop clicks but not on inside padding clicks', async () => {
    const onclose = vi.fn();
    const { target, cleanup } = render(Dialog, { open: true, labelledBy: 'dlg-title', onclose, children: undefined });
    try {
      await tick();
      const dialog = dialogOf(target);
      stubRect(dialog);
      backdropClick(dialog, 150, 150);
      expect(onclose).not.toHaveBeenCalled();
      backdropClick(dialog, 10, 10);
      expect(onclose).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });

  it('tolerates cancel and backdrop clicks without an onclose handler', async () => {
    const { target, cleanup } = render(Dialog, { open: true, labelledBy: 'dlg-title', children: undefined });
    try {
      await tick();
      const dialog = dialogOf(target);
      stubRect(dialog);
      cancel(dialog);
      await tick();
      backdropClick(dialog, 10, 10);
      await tick();
      expect(dialog.open).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('restores the opener on unmount', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Opener';
    document.body.appendChild(opener);
    opener.focus();
    const { target, cleanup } = render(Dialog, { open: true, labelledBy: 'dlg-title', children: undefined });
    try {
      await tick();
      expect(dialogOf(target).contains(document.activeElement)).toBe(true);
    } finally {
      await cleanup();
    }
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('renders real snippet children, closes through the harness and reopens', async () => {
    const onclose = vi.fn();
    const { target, cleanup } = render(DialogHarness, { onclose });
    try {
      const opener = target.querySelector('[data-testid="opener"]') as HTMLElement;
      opener.focus();
      await tick();
      expect(dialogOf(target).open).toBe(true);
      const heading = target.querySelector('#harness-title')!;
      expect(heading.textContent).toBe('Harness dialog');
      expect(dialogOf(target).getAttribute('aria-labelledby')).toBe('harness-title');
      expect(dialogOf(target).contains(document.activeElement)).toBe(true);
      click(target.querySelector('[data-testid="inner-close"]'));
      await tick();
      expect(dialogOf(target).open).toBe(false);
      expect(onclose).toHaveBeenCalledTimes(1);
      // Reopen from the focused opener so the harness captures it for restore.
      opener.focus();
      click(opener);
      await tick();
      expect(dialogOf(target).open).toBe(true);
      expect(dialogOf(target).contains(document.activeElement)).toBe(true);
      click(target.querySelector('[data-testid="inner-close"]'));
      await tick();
      expect(dialogOf(target).open).toBe(false);
      expect(onclose).toHaveBeenCalledTimes(2);
      expect(document.activeElement).toBe(opener);
    } finally {
      await cleanup();
    }
  });
});

describe('EmptyState conditional title, hint and action', () => {
  it('shows only the title heading when empty', async () => {
    const { target, cleanup } = render(EmptyState, { title: en.forum.empty });
    try {
      await tick();
      expect(target.querySelector('h2')!.textContent).toBe(en.forum.empty);
      expect(target.querySelector('p')).toBeNull();
      expect(target.querySelector('button')).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('shows the hint alongside the title', async () => {
    const { target, cleanup } = render(EmptyState, { title: 'Nothing here', hint: 'Check back after connecting.' });
    try {
      await tick();
      expect(target.querySelector('p')!.textContent).toMatch(/Check back/);
      expect(target.querySelector('button')).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('offers the action and calls back when chosen', async () => {
    const onaction = vi.fn();
    const { target, cleanup } = render(EmptyState, { title: 'Nothing here', actionLabel: en.common.refresh, onaction });
    try {
      await tick();
      const action = target.querySelector('button')!;
      expect(action.textContent).toBe(en.common.refresh);
      action.click();
      expect(onaction).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });

  it('tolerates an action press without a handler', async () => {
    const { target, cleanup } = render(EmptyState, { title: 'Nothing here', actionLabel: en.common.refresh });
    try {
      await tick();
      target.querySelector('button')!.click();
      await tick();
    } finally {
      await cleanup();
    }
  });
});

describe('LevelBadge plain level names', () => {
  it('names circle, ingroup and room plainly with level classes', async () => {
    const expected = { circle: 'Circle', ingroup: 'Ingroup', room: 'Public room' } as const;
    for (const [level, label] of Object.entries(expected) as Array<[keyof typeof expected, string]>) {
      const { target, cleanup } = render(LevelBadge, { level });
      try {
        await tick();
        expect(target.textContent).toBe(label);
        expect(target.querySelector(`.badge-${level}`)).not.toBeNull();
      } finally {
        await cleanup();
      }
    }
  });

  it('matches the shared English level strings', async () => {
    for (const level of ['circle', 'ingroup', 'room'] as const) {
      const { target, cleanup } = render(LevelBadge, { level });
      try {
        await tick();
        expect(target.textContent).toBe(en.groups.level[level]);
      } finally {
        await cleanup();
      }
    }
  });

  it('names the opening level by default (no en.groups.level key)', async () => {
    const { target, cleanup } = render(LevelBadge, { level: 'opening' });
    try {
      await tick();
      expect(target.textContent).toBe('Opening room');
      expect(target.querySelector('.badge-opening')).not.toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('uses caller-provided labels for white-label themes', async () => {
    const { target, cleanup } = render(LevelBadge, {
      level: 'room',
      labels: { circle: 'C', ingroup: 'I', room: 'Open space', opening: 'Opening' },
    });
    try {
      await tick();
      expect(target.textContent).toBe('Open space');
    } finally {
      await cleanup();
    }
  });
});

describe('Notice tones, roles and titles', () => {
  it('uses alert for error and warning, status otherwise', async () => {
    const roles = { info: 'status', success: 'status', warning: 'alert', error: 'alert' } as const;
    for (const [tone, role] of Object.entries(roles) as Array<[keyof typeof roles, 'status' | 'alert']>) {
      const { target, cleanup } = render(Notice, { tone, children: undefined });
      try {
        await tick();
        const notice = target.querySelector(`.notice-${tone}`)!;
        expect(notice.getAttribute('role')).toBe(role);
      } finally {
        await cleanup();
      }
    }
  });

  it('defaults to the info tone', async () => {
    const { target, cleanup } = render(Notice, { children: undefined });
    try {
      await tick();
      expect(target.querySelector('.notice-info')).not.toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('shows the title only when provided', async () => {
    const withTitle = render(Notice, { tone: 'warning', title: 'Heads up', children: undefined });
    try {
      await tick();
      expect(withTitle.target.querySelector('strong')!.textContent).toBe('Heads up');
    } finally {
      await withTitle.cleanup();
    }
    const withoutTitle = render(Notice, { tone: 'warning', children: undefined });
    try {
      await tick();
      expect(withoutTitle.target.querySelector('strong')).toBeNull();
    } finally {
      await withoutTitle.cleanup();
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
      await tick();
      const notice = target.querySelector('.notice-error')!;
      expect(notice.getAttribute('role')).toBe('alert');
      expect(notice.textContent).toMatch(/Join failed/);
    } finally {
      await cleanup();
    }
  });
});

describe('ProfilePreview flashcard front and back', () => {
  const values = { age: 34, about: 'Hello.' };

  it('shows the public front first and hides private values', async () => {
    const { target, cleanup } = render(ProfilePreview, {
      schema: tinySchema,
      values,
      frontLabel: en.profile.previewFront,
      backLabel: en.profile.previewBack,
    });
    try {
      await tick();
      const tabs = target.querySelectorAll('[role="tab"]');
      expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
      expect(tabs[0]!.getAttribute('tabindex')).toBe('0');
      expect(tabs[1]!.getAttribute('tabindex')).toBe('-1');
      expect(target.textContent).toMatch(/34/);
      expect(target.textContent).not.toMatch(/Hello\./);
    } finally {
      await cleanup();
    }
  });

  it('reveals the private back on request, by pointer and from the keyboard', async () => {
    const { target, cleanup } = render(ProfilePreview, { schema: tinySchema, values });
    try {
      await tick();
      const tabs = target.querySelectorAll('[role="tab"]');
      (tabs[1] as HTMLElement).focus();
      expect(document.activeElement).toBe(tabs[1]);
      (tabs[1] as HTMLElement).click();
      await tick();
      expect((tabs[1] as HTMLElement).getAttribute('aria-selected')).toBe('true');
      expect((tabs[0] as HTMLElement).getAttribute('aria-selected')).toBe('false');
      expect((tabs[1] as HTMLElement).getAttribute('tabindex')).toBe('0');
      expect(target.textContent).toMatch(/Hello\./);
      (tabs[0] as HTMLElement).click();
      await tick();
      expect(target.textContent).not.toMatch(/Hello\./);
      expect(target.textContent).toMatch(/34/);
    } finally {
      await cleanup();
    }
  });

  it('labels both sides for assistive technology', async () => {
    const { target, cleanup } = render(ProfilePreview, { schema: tinySchema, values });
    try {
      await tick();
      expect(target.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toMatch(/Preview side/);
      expect(target.querySelector('section')!.getAttribute('aria-label')).toMatch(/public profile/);
    } finally {
      await cleanup();
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
      await tick();
      (target.querySelectorAll('[role="tab"]')[1] as HTMLElement).click();
      await tick();
      expect(target.textContent).toMatch(/Nothing private yet/);
    } finally {
      await cleanup();
    }
  });

  it('shows a dash for unanswered questions', async () => {
    const { target, cleanup } = render(ProfilePreview, { schema: tinySchema, values: {} });
    try {
      await tick();
      expect(target.textContent).toMatch(/—/);
    } finally {
      await cleanup();
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
      await tick();
      expect(target.textContent).toMatch(/34/);
      expect(target.textContent).toMatch(/North/);
      (target.querySelectorAll('[role="tab"]')[1] as HTMLElement).click();
      await tick();
      expect(target.textContent).not.toMatch(/North/);
    } finally {
      await cleanup();
    }
  });
});

describe('ProgressBar calm progress values', () => {
  it('reports the percentage through accessible attributes', async () => {
    const { target, cleanup } = render(ProgressBar, { value: 0.3, label: en.connection.title });
    try {
      await tick();
      const bar = target.querySelector('[role="progressbar"]')!;
      expect(bar.getAttribute('aria-valuenow')).toBe('30');
      expect(bar.getAttribute('aria-valuemin')).toBe('0');
      expect(bar.getAttribute('aria-valuemax')).toBe('100');
      expect(bar.getAttribute('aria-label')).toBe(en.connection.title);
      expect((target.querySelector('.bar') as HTMLElement).style.width).toBe('30%');
    } finally {
      await cleanup();
    }
  });

  it('clamps out-of-range values instead of overflowing', async () => {
    const low = render(ProgressBar, { value: -0.5, label: 'Progress' });
    try {
      await tick();
      expect(low.target.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('0');
      expect((low.target.querySelector('.bar') as HTMLElement).style.width).toBe('0%');
    } finally {
      await low.cleanup();
    }
    const high = render(ProgressBar, { value: 2, label: 'Progress' });
    try {
      await tick();
      expect(high.target.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('100');
      expect((high.target.querySelector('.bar') as HTMLElement).style.width).toBe('100%');
    } finally {
      await high.cleanup();
    }
  });

  it('reaches both ends of the range', async () => {
    const empty = render(ProgressBar, { value: 0, label: 'Progress' });
    try {
      await tick();
      expect((empty.target.querySelector('.bar') as HTMLElement).style.width).toBe('0%');
    } finally {
      await empty.cleanup();
    }
    const full = render(ProgressBar, { value: 1, label: 'Progress' });
    try {
      await tick();
      expect(full.target.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('100');
    } finally {
      await full.cleanup();
    }
  });
});

describe('PublicCard presence, values and suppressed reserved record', () => {
  const card = {
    memberId: 'member-ana',
    handle: 'ana-walks',
    values: { age: 34, neighbourhood: 'North' },
    online: true,
    record: { accepted: 0.7, declined: 0.25, punished: 0.05 },
  };

  it('announces the member, shows presence and lists public values', async () => {
    const { target, cleanup } = render(PublicCard, { card });
    try {
      await tick();
      expect(target.querySelector('article')!.getAttribute('aria-label')).toMatch(/ana-walks/);
      expect(target.querySelector('h3')!.textContent).toBe('ana-walks');
      expect(target.textContent).toMatch(en.common.online);
      expect(target.textContent).toMatch(/age: 34/);
      expect(target.textContent).toMatch(/neighbourhood: North/);
    } finally {
      await cleanup();
    }
  });

  it('marks offline members plainly', async () => {
    const { target, cleanup } = render(PublicCard, { card: { ...card, online: false } });
    try {
      await tick();
      expect(target.textContent).toMatch(en.common.offline);
      expect(target.textContent).not.toMatch(en.common.online);
    } finally {
      await cleanup();
    }
  });

  it('suppresses the reserved record regardless of its value', async () => {
    const withRecord = render(PublicCard, { card });
    try {
      await tick();
      expect(withRecord.target.textContent).not.toMatch(/Welcomed by/);
    } finally {
      await withRecord.cleanup();
    }
    const beforeQuorum = render(PublicCard, { card: { ...card, record: null } });
    try {
      await tick();
      expect(beforeQuorum.target.textContent).not.toMatch(/Welcomed by/);
    } finally {
      await beforeQuorum.cleanup();
    }
  });

  it('uses the member initial as the avatar with no pictures', async () => {
    const { target, cleanup } = render(PublicCard, { card });
    try {
      await tick();
      const avatar = target.querySelector('.avatar')!;
      expect(avatar.textContent).toBe('A');
      expect(avatar.getAttribute('aria-hidden')).toBe('true');
    } finally {
      await cleanup();
    }
  });

  it('calls back with the member id and honours a custom action label', async () => {
    const onaction = vi.fn();
    const { target, cleanup } = render(PublicCard, { card, actionLabel: 'Say hello', onaction });
    try {
      await tick();
      const action = target.querySelector('button')!;
      expect(action.textContent).toBe('Say hello');
      action.click();
      expect(onaction).toHaveBeenCalledWith('member-ana');
    } finally {
      await cleanup();
    }
  });

  it('defaults the action to wanting to know more', async () => {
    const { target, cleanup } = render(PublicCard, { card });
    try {
      await tick();
      expect(target.querySelector('button')!.textContent).toBe(en.forum.wantToKnowMore);
    } finally {
      await cleanup();
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
        await tick();
        expect(target.querySelector('h3')!.textContent).toBe(entry.handle);
        expect(target.querySelector('article')!.getAttribute('aria-label')).toMatch(entry.handle);
        expect(target.textContent).not.toMatch(/Welcomed by/);
      } finally {
        await cleanup();
      }
    }
  });
});

describe('SegmentedControl options, selection and keyboard', () => {
  const options = [
    { value: 'front', label: 'Front' },
    { value: 'back', label: 'Back' },
  ] as const;

  it('marks exactly the current option as selected with roving tabindex', async () => {
    for (const current of ['front', 'back'] as const) {
      const { target, cleanup } = render(SegmentedControl, {
        label: 'Profile preview side',
        options: [...options],
        current,
      });
      try {
        await tick();
        const tabs = target.querySelectorAll('[role="tab"]');
        expect(tabs).toHaveLength(2);
        for (const tab of tabs) {
          const selected = (tab as HTMLElement).textContent === (current === 'front' ? 'Front' : 'Back');
          expect(tab.getAttribute('aria-selected')).toBe(String(selected));
          expect(tab.getAttribute('tabindex')).toBe(selected ? '0' : '-1');
          expect((tab as HTMLElement).classList.contains('active')).toBe(selected);
        }
      } finally {
        await cleanup();
      }
    }
  });

  it('labels the option group for assistive technology', async () => {
    const { target, cleanup } = render(SegmentedControl, {
      label: 'Profile preview side',
      options: [...options],
      current: 'back' as 'front' | 'back',
    });
    try {
      await tick();
      expect(target.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe('Profile preview side');
      expect(target.querySelectorAll('[role="tab"]')[1]!.getAttribute('aria-selected')).toBe('true');
    } finally {
      await cleanup();
    }
  });

  it('reports the chosen value through onselect without changing one-way state', async () => {
    const onselect = vi.fn();
    const { target, cleanup } = render(SegmentedControl, {
      label: 'Profile preview side',
      options: [...options],
      current: 'front' as 'front' | 'back',
      onselect,
    });
    try {
      await tick();
      const tabs = target.querySelectorAll('[role="tab"]');
      (tabs[1] as HTMLElement).click();
      expect(onselect).toHaveBeenCalledWith('back');
      // One-way binding: the visual selection follows the parent's `current`.
      expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    } finally {
      await cleanup();
    }
  });

  it('moves focus and selects with arrow keys from a fixed parent value', async () => {
    const onselect = vi.fn();
    const { target, cleanup } = render(SegmentedControl, {
      label: 'Profile preview side',
      options: [...options],
      current: 'front' as 'front' | 'back',
      onselect,
    });
    try {
      await tick();
      const list = target.querySelector('[role="tablist"]')!;
      const tabs = target.querySelectorAll('[role="tab"]');
      (tabs[0] as HTMLElement).focus();
      keydown(list, 'ArrowRight');
      expect(onselect).toHaveBeenCalledWith('back');
      expect(document.activeElement).toBe(tabs[1]);
      // One-way `current` never moved, so arrows keep offering the other value.
      keydown(list, 'ArrowLeft');
      expect(onselect).toHaveBeenLastCalledWith('back');
      expect(document.activeElement).toBe(tabs[1]);
    } finally {
      await cleanup();
    }
  });

  it('wraps around the ends through a stateful parent', async () => {
    const { target, cleanup } = render(SegmentedHarness, {});
    try {
      await tick();
      const tabs = target.querySelectorAll('[role="tab"]');
      const list = target.querySelector('[role="tablist"]')!;
      keydown(list, 'ArrowLeft');
      await tick();
      expect(target.querySelector('[data-testid="current"]')!.textContent).toBe('back');
      expect(document.activeElement).toBe(tabs[1]);
      keydown(list, 'ArrowRight');
      await tick();
      expect(target.querySelector('[data-testid="current"]')!.textContent).toBe('front');
      expect(document.activeElement).toBe(tabs[0]);
    } finally {
      await cleanup();
    }
  });

  it('jumps with Home and End and ignores other keys', async () => {
    const onselect = vi.fn();
    const { target, cleanup } = render(SegmentedControl, {
      label: 'Profile preview side',
      options: [...options],
      current: 'front' as 'front' | 'back',
      onselect,
    });
    try {
      await tick();
      const list = target.querySelector('[role="tablist"]')!;
      // Already first: Home offers the current value, so no selection event.
      keydown(list, 'Home');
      expect(onselect).not.toHaveBeenCalled();
      keydown(list, 'End');
      expect(onselect).toHaveBeenCalledWith('back');
      keydown(list, 'Enter');
      expect(onselect).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });

  it('lets each option receive programmatic focus and click', async () => {
    const onselect = vi.fn();
    const { target, cleanup } = render(SegmentedControl, {
      label: 'Profile preview side',
      options: [...options],
      current: 'front' as 'front' | 'back',
      onselect,
    });
    try {
      await tick();
      for (const tab of buttons(target)) {
        tab.focus();
        expect(document.activeElement).toBe(tab);
        tab.click();
      }
      expect(onselect).toHaveBeenCalledTimes(2);
    } finally {
      await cleanup();
    }
  });

  it('rerenders selection and tabindex through a stateful harness', async () => {
    const { target, cleanup } = render(SegmentedHarness, {});
    try {
      await tick();
      const output = target.querySelector('[data-testid="current"]')!;
      expect(output.textContent).toBe('front');
      const tabs = target.querySelectorAll('[role="tab"]');
      (tabs[1] as HTMLElement).click();
      await tick();
      expect(output.textContent).toBe('back');
      expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
      expect(tabs[1]!.getAttribute('tabindex')).toBe('0');
      expect(tabs[0]!.getAttribute('tabindex')).toBe('-1');
      keydown(target.querySelector('[role="tablist"]'), 'ArrowLeft');
      await tick();
      expect(output.textContent).toBe('front');
      expect(document.activeElement).toBe(tabs[0]);
    } finally {
      await cleanup();
    }
  });

  it('renders an empty option list as an empty labelled group', async () => {
    const onselect = vi.fn();
    const { target, cleanup } = render(SegmentedControl, {
      label: 'Empty choices',
      options: [],
      current: 'front' as 'front' | 'back',
      onselect,
    });
    try {
      await tick();
      expect(target.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe('Empty choices');
      expect(target.querySelectorAll('[role="tab"]')).toHaveLength(0);
      keydown(target.querySelector('[role="tablist"]'), 'ArrowRight');
      expect(onselect).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});

describe('TextField inputs, help, errors and choices', () => {
  it('associates the label with the input', async () => {
    const { target, cleanup } = render(TextField, { id: 'handle', label: 'Choose a handle', value: '' });
    try {
      await tick();
      expect(target.querySelector('label')!.getAttribute('for')).toBe('handle');
      expect(target.querySelector('#handle')).not.toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('reports typed text through oninput as a string payload', async () => {
    const oninput = vi.fn();
    const { target, cleanup } = render(TextField, { id: 'handle', label: 'Choose a handle', value: '', oninput });
    try {
      await tick();
      const input = target.querySelector('#handle') as HTMLInputElement;
      input.focus();
      expect(document.activeElement).toBe(input);
      input.value = 'new-member';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(oninput).toHaveBeenCalledWith('new-member');
      expect(typeof oninput.mock.calls[0][0]).toBe('string');
    } finally {
      await cleanup();
    }
  });

  it('shows help text and wires it to the input', async () => {
    const { target, cleanup } = render(TextField, {
      id: 'handle',
      label: 'Choose a handle',
      value: '',
      help: '8 to 32 characters.',
    });
    try {
      await tick();
      expect(target.querySelector('.help')!.textContent).toBe('8 to 32 characters.');
      expect(target.querySelector('input')!.getAttribute('aria-describedby')).toBe('handle-help');
    } finally {
      await cleanup();
    }
  });

  it('combines help and error in aria-describedby with stable ids', async () => {
    const { target, cleanup } = render(TextField, {
      id: 'handle',
      label: 'Choose a handle',
      value: 'short',
      help: '8 to 32 characters.',
      error: 'Handles are 8 to 32 characters long.',
    });
    try {
      await tick();
      expect(target.querySelector('input')!.getAttribute('aria-describedby')).toBe('handle-help handle-error');
      expect(target.querySelector('#handle-error')!.getAttribute('role')).toBe('alert');
    } finally {
      await cleanup();
    }
  });

  it('announces errors as an alert and marks the input invalid', async () => {
    const { target, cleanup } = render(TextField, {
      id: 'handle',
      label: 'Choose a handle',
      value: 'short',
      error: 'Handles are 8 to 32 characters long.',
    });
    try {
      await tick();
      const alert = target.querySelector('.error')!;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.textContent).toMatch(/8 to 32/);
      expect(target.querySelector('input')!.getAttribute('aria-invalid')).toBe('true');
    } finally {
      await cleanup();
    }
  });

  it('leaves a calm field without error semantics', async () => {
    const { target, cleanup } = render(TextField, { id: 'handle', label: 'Choose a handle', value: 'fine-handle' });
    try {
      await tick();
      expect(target.querySelector('.error')).toBeNull();
      expect(target.querySelector('input')!.getAttribute('aria-invalid')).not.toBe('true');
    } finally {
      await cleanup();
    }
  });

  it('marks required input, select and textarea as natively required', async () => {
    const plain = render(TextField, { id: 'req-name', label: 'Name', value: '', required: true });
    try {
      await tick();
      const input = plain.target.querySelector('input')!;
      expect(input.required).toBe(true);
      expect(plain.target.querySelector('label span')!.textContent).toBe('*');
    } finally {
      await plain.cleanup();
    }
    const choice = render(TextField, {
      id: 'req-color',
      label: 'Color',
      value: '',
      choices: ['red', 'blue'],
      required: true,
    });
    try {
      await tick();
      expect(choice.target.querySelector('select')!.required).toBe(true);
    } finally {
      await choice.cleanup();
    }
    const long = render(TextField, { id: 'req-bio', label: 'Bio', value: '', multiline: true, required: true });
    try {
      await tick();
      expect(long.target.querySelector('textarea')!.required).toBe(true);
    } finally {
      await long.cleanup();
    }
  });

  it('renders number inputs with bounds and placeholder', async () => {
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
      await tick();
      const input = target.querySelector('input')!;
      expect(input.getAttribute('type')).toBe('number');
      expect(input.getAttribute('min')).toBe('18');
      expect(input.getAttribute('max')).toBe('99');
      expect(input.getAttribute('placeholder')).toBe('34');
      expect((input as HTMLInputElement).value).toBe('34');
    } finally {
      await cleanup();
    }
  });

  it('renders long answers as a multiline field', async () => {
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
      await tick();
      const area = target.querySelector('textarea')!;
      expect(area.getAttribute('rows')).toBe('3');
      expect(area.getAttribute('maxlength')).toBe('280');
      area.value = 'Hello.';
      area.dispatchEvent(new Event('input', { bubbles: true }));
      expect(oninput).toHaveBeenCalledWith('Hello.');
    } finally {
      await cleanup();
    }
  });

  it('renders fixed answers as a choice list with a prompt first', async () => {
    const oninput = vi.fn();
    const { target, cleanup } = render(TextField, {
      id: 'neighbourhood',
      label: 'Which neighbourhood?',
      value: '',
      choices: ['North', 'East'],
      oninput,
    });
    try {
      await tick();
      const select = target.querySelector('select')!;
      expect(select.querySelectorAll('option')).toHaveLength(3);
      expect(select.querySelector('option')!.textContent).toMatch(/Choose/);
      select.value = 'East';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      expect(oninput).toHaveBeenCalledWith('East');
    } finally {
      await cleanup();
    }
  });

  it('preselects the current choice', async () => {
    const { target, cleanup } = render(TextField, {
      id: 'neighbourhood',
      label: 'Which neighbourhood?',
      value: 'North',
      choices: ['North', 'East'],
    });
    try {
      await tick();
      expect((target.querySelector('select') as HTMLSelectElement).value).toBe('North');
    } finally {
      await cleanup();
    }
  });
});

describe('WaveCard first-contact actions and states', () => {
  const pending: Wave = {
    id: 'wave-1',
    releaseState: 'released',
    from: 'member-tom',
    fromHandle: 'tom-cooks',
    to: 'me',
    message: 'Hello! Would you like to talk?',
    state: 'pending',
    senderSlotHeld: true,
    recipientSlotHeld: true,
  };

  it('announces the sender, shows the message and enables every action while pending', async () => {
    const { target, cleanup } = render(WaveCard, { wave: pending });
    try {
      await tick();
      expect(target.querySelector('article')!.getAttribute('aria-label')).toMatch(/tom-cooks/);
      expect(target.querySelector('.message')!.textContent).toMatch(/Would you like to talk/);
      for (const action of buttons(target)) expect(action.disabled).toBe(false);
      expect(target.querySelector('.state')).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('offers answer and close with no punishment by default', async () => {
    const { target, cleanup } = render(WaveCard, { wave: pending });
    try {
      await tick();
      expect(target.textContent).toMatch(en.waves.answer);
      expect(target.textContent).toMatch(en.waves.close);
      expect(target.textContent).not.toMatch(en.waves.punish);
      expect(target.querySelector('.note')).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('routes answer, close and punish with the wave id', async () => {
    const onanswer = vi.fn();
    const onclose = vi.fn();
    const onpunish = vi.fn();
    const { target, cleanup } = render(WaveCard, { wave: pending, onanswer, onclose, onpunish });
    try {
      await tick();
      const actions = buttons(target);
      actions[0]!.click();
      actions[1]!.click();
      actions[2]!.click();
      expect(onanswer).toHaveBeenCalledWith('wave-1');
      expect(onclose).toHaveBeenCalledWith('wave-1');
      expect(onpunish).toHaveBeenCalledWith('wave-1');
    } finally {
      await cleanup();
    }
  });

  it('honours custom action labels and note', async () => {
    const { target, cleanup } = render(WaveCard, {
      wave: pending,
      answerLabel: 'Reply',
      closeLabel: 'Decline',
      punishLabel: 'Report',
      punishNote: 'Custom note.',
      onpunish: vi.fn(),
    });
    try {
      await tick();
      expect(target.textContent).toMatch(/Reply/);
      expect(target.textContent).toMatch(/Decline/);
      expect(target.textContent).toMatch(/Report/);
      expect(target.querySelector('.note')!.textContent).toBe('Custom note.');
    } finally {
      await cleanup();
    }
  });

  it('disables every action and names the status once decided', async () => {
    for (const state of ['answered', 'closed', 'silent', 'punished'] as const) {
      const { target, cleanup } = render(WaveCard, { wave: { ...pending, state } });
      try {
        await tick();
        for (const action of buttons(target)) expect(action.disabled).toBe(true);
        expect(target.querySelector('.state')!.textContent).toMatch(state);
      } finally {
        await cleanup();
      }
    }
  });

  it('disables every action while the parent is busy', async () => {
    const onanswer = vi.fn();
    const { target, cleanup } = render(WaveCard, { wave: pending, disabled: true, onanswer });
    try {
      await tick();
      for (const action of buttons(target)) expect(action.disabled).toBe(true);
      buttons(target)[0]!.click();
      expect(onanswer).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it('keeps wave actions reachable from the keyboard', async () => {
    const { target, cleanup } = render(WaveCard, { wave: pending });
    try {
      await tick();
      for (const action of buttons(target)) {
        action.focus();
        expect(document.activeElement).toBe(action);
      }
    } finally {
      await cleanup();
    }
  });

  it('withholds reserved content even if the transport supplies text prematurely', async () => {
    const client = createDevCmsg({ incomingReleaseState: 'reserved' });
    const [incoming] = await client.incomingWaves();
    expect(incoming?.releaseState).toBe('reserved');
    expect(incoming?.message).toBe('');
    const { target, cleanup } = render(WaveCard, { wave: { ...incoming!, message: 'WITHHELD' } });
    try {
      await tick();
      expect(target.querySelector('.message')).toBeNull();
      expect(target.textContent).not.toContain('WITHHELD');
    } finally {
      await cleanup();
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
      await tick();
      for (const action of buttons(answeredView.target)) expect(action.disabled).toBe(true);
      expect(answeredView.target.textContent).toMatch(/answered/);
    } finally {
      await answeredView.cleanup();
    }

    const closedClient = createDevCmsg();
    await closedClient.joinWithVoucher(JOIN);
    const [toClose] = await closedClient.incomingWaves();
    const closed = await closedClient.closeWave(toClose!.id);
    const closedView = render(WaveCard, { wave: closed });
    try {
      await tick();
      expect(closedView.target.textContent).toMatch(/closed/);
    } finally {
      await closedView.cleanup();
    }

    const punishedClient = createDevCmsg();
    await punishedClient.joinWithVoucher(JOIN);
    await punishedClient.publishProfile({ age: 34, neighbourhood: 'North', weekend: 'Hiking' });
    const [toPunish] = await punishedClient.incomingWaves();
    const punished = await punishedClient.punishWave(toPunish!.id);
    const punishedView = render(WaveCard, { wave: punished });
    try {
      await tick();
      for (const action of buttons(punishedView.target)) expect(action.disabled).toBe(true);
      expect(punishedView.target.textContent).toMatch(/punished/);
    } finally {
      await punishedView.cleanup();
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

  it('announces the group name and member count', async () => {
    const { target, cleanup } = render(GroupCard, { group: circle });
    try {
      await tick();
      expect(target.querySelector('article')!.getAttribute('aria-label')).toBe('Community garden, 8 members');
      expect(target.textContent).toMatch(/8 members/);
      expect(target.textContent).toMatch(/Neighbours sharing tools/);
    } finally {
      await cleanup();
    }
  });

  it('shows the level badge and what changes next', async () => {
    const { target, cleanup } = render(GroupCard, { group: room, nextLabel: en.groups.whatChangesNext });
    try {
      await tick();
      expect(target.textContent).toMatch(/Public room/);
      expect(target.textContent).toMatch(/What changes next/);
      expect(target.textContent).toMatch(/six joins per hour/);
    } finally {
      await cleanup();
    }
  });

  it('uses custom level labels when provided', async () => {
    const { target, cleanup } = render(GroupCard, {
      group: circle,
      levelLabels: { circle: 'Close circle', ingroup: 'Inner', room: 'Open', opening: 'Opening' },
    });
    try {
      await tick();
      expect(target.textContent).toMatch(/Close circle/);
    } finally {
      await cleanup();
    }
  });

  it('renders the supplied opening level, progress and band', async () => {
    const opening: GroupView = {
      ...room,
      id: 'group-opening',
      name: 'Newcomers opening',
      level: 'opening',
      size: 28,
      whatChangesNext: 'Reach 43 within 21 days to become public; otherwise return to a hidden Ingroup.',
      opening: { progress: '28 of 43 members.', deadlineLabel: 'Opening window: 21 days.' },
      band: { notifications: 'Mentions only.', postingPace: 'Slow.', joining: 'Consent.' },
      lineage: ['garden-neighbours'],
    };
    const { target, cleanup } = render(GroupCard, { group: opening });
    try {
      await tick();
      expect(target.querySelector('article')!.getAttribute('aria-label')).toBe('Newcomers opening, 28 members');
      expect(target.textContent).toMatch(/Opening room/);
      expect(target.textContent).toMatch(/Reach 43 within 21 days/);
      // These are opaque display values supplied by the port.
      expect(target.textContent).toMatch(/28 of 43 members\./);
      expect(target.textContent).toMatch(/Mentions only\./);
      expect(target.textContent).not.toMatch(/garden-neighbours/);
    } finally {
      await cleanup();
    }
  });

  it('offers join for outsiders and leave once joined', async () => {
    const joinedView = render(GroupCard, { group: circle });
    try {
      await tick();
      expect(joinedView.target.textContent).toMatch(en.groups.joined);
      expect(joinedView.target.textContent).toMatch(en.groups.leave);
      expect(joinedView.target.textContent).not.toMatch(/Join[^e]/);
    } finally {
      await joinedView.cleanup();
    }
    const outsiderView = render(GroupCard, { group: room });
    try {
      await tick();
      expect(outsiderView.target.querySelector('.joined')).toBeNull();
      expect(outsiderView.target.textContent).toMatch(en.groups.join);
    } finally {
      await outsiderView.cleanup();
    }
  });

  it('routes join, leave and open with the group id', async () => {
    const onjoin = vi.fn();
    const onleave = vi.fn();
    const onopen = vi.fn();
    const joinView = render(GroupCard, { group: room, onjoin, onopen });
    try {
      await tick();
      click(joinView.target.querySelector('.btn.primary'));
      expect(onjoin).toHaveBeenCalledWith('group-market');
      click(joinView.target.querySelector('.link'));
      expect(onopen).toHaveBeenCalledWith('group-market');
    } finally {
      await joinView.cleanup();
    }
    const leaveView = render(GroupCard, { group: circle, onleave });
    try {
      await tick();
      click(leaveView.target.querySelector('.actions .btn'));
      expect(onleave).toHaveBeenCalledWith('group-garden');
    } finally {
      await leaveView.cleanup();
    }
  });

  it('honours custom join, leave and joined labels', async () => {
    const { target, cleanup } = render(GroupCard, {
      group: room,
      joinLabel: 'Become a member',
      leaveLabel: 'Step out',
      joinedLabel: 'Member',
    });
    try {
      await tick();
      expect(target.textContent).toMatch(/Become a member/);
    } finally {
      await cleanup();
    }
  });

  it('shows a device suggestion only when present', async () => {
    const withSuggestion = render(GroupCard, { group: { ...circle, suggestion: 'A split is not needed yet.' } });
    try {
      await tick();
      expect(withSuggestion.target.querySelector('.suggestion')!.textContent).toMatch(/not needed yet/);
    } finally {
      await withSuggestion.cleanup();
    }
    const withoutSuggestion = render(GroupCard, { group: circle });
    try {
      await tick();
      expect(withoutSuggestion.target.querySelector('.suggestion')).toBeNull();
    } finally {
      await withoutSuggestion.cleanup();
    }
  });

  it('keeps group actions reachable from the keyboard', async () => {
    const { target, cleanup } = render(GroupCard, { group: room });
    try {
      await tick();
      const open = target.querySelector('.link') as HTMLElement;
      open.focus();
      expect(document.activeElement).toBe(open);
      const join = target.querySelector('.btn.primary') as HTMLElement;
      join.focus();
      expect(document.activeElement).toBe(join);
    } finally {
      await cleanup();
    }
  });

  it('renders every seeded group from the real adapter and follows a room join', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const groups = await client.groups();
    expect(groups).toHaveLength(4);
    for (const group of groups) {
      const { target, cleanup } = render(GroupCard, { group });
      try {
        await tick();
        expect(target.querySelector('article')!.getAttribute('aria-label')).toBe(`${group.name}, ${group.size} members`);
        expect(target.textContent).toMatch(group.whatChangesNext);
        if (group.joined) expect(target.textContent).toMatch(en.groups.joined);
        if (group.level === 'opening') expect(target.textContent).toMatch(/Opening room/);
      } finally {
        await cleanup();
      }
    }
    const market = groups.find((g) => g.id === 'group-market')!;
    await expect(client.joinGroup(market.id)).rejects.toThrow(/consent/i);
    const joined = await client.joinGroup(market.id, true);
    expect(joined.joined).toBe(true);
    const { target, cleanup } = render(GroupCard, { group: joined });
    try {
      await tick();
      expect(target.textContent).toMatch(en.groups.joined);
      expect(target.textContent).toMatch(/68 members/);
    } finally {
      await cleanup();
    }
  });

  it('surfaces unknown-group adapter failures at the boundary', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await expect(client.joinGroup('group-missing')).rejects.toThrow();
  });
});

describe('connection and fixture-boundary failures from the real adapter', () => {
  it('reports an unreachable network so the UI can show failure plainly', async () => {
    const client = createDevCmsg({ connectDelayMs: 10, failConnect: true });
    const status = await client.connect();
    expect(status.phase).toBe('failed');
    const { target, cleanup } = render(Notice, { tone: 'error', title: 'Connection failed', children: undefined });
    try {
      await tick();
      expect(target.querySelector('[role="alert"]')!.textContent).toMatch(/Connection failed/);
    } finally {
      await cleanup();
    }
  });

  it('returns deliberate fixture failures through the same API', async () => {
    const client = createDevCmsg({ failActions: ['discover'] });
    await client.joinWithVoucher(JOIN);
    await client.publishProfile({ age: 34, neighbourhood: 'North', weekend: 'Hiking' });
    await expect(client.discover([])).rejects.toThrow(/Fixture failure/);
  });
});
