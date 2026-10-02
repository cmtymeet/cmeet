import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { writable } from 'svelte/store';
import GroupDetail from '../../src/views/GroupDetail.svelte';
import GroupDetailHarness from './fixtures/GroupDetailHarness.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { CmsgClient, GroupView } from '../../../../core/src/cmsg.js';

function detailGroup(): GroupView {
  return {
    id: 'group-detail',
    name: 'Detail neighbours',
    level: 'circle',
    size: 9,
    whatChangesNext: 'At 13 members, a consented fork can become an Ingroup.',
    description: 'A small circle for detail tests.',
    joinConsent: null,
    joined: true,
    newcomerHistory: 'Newcomers start fresh; earlier messages stay with the group.',
    messages: [],
    suggestion: 'Consider a split once the circle feels crowded.',
    band: {
      notifications: 'Every message, with quiet hours respected.',
      postingPace: '90 messages per hour; burst of 15.',
      joining: 'Invitation through an own contact; movers consent to a fork.',
    },
    lineage: ['detail-root'],
    seatBudget: { enabled: false, label: 'No seat budget in this circle.' },
    welcomePrompt: 'Welcome! Say hello and tell the group one weekend habit.',
    members: [
      { id: 'member-ana', handle: 'ana-walks' },
      { id: 'member-tom', handle: 'tom-cooks' },
    ],
    forks: [],
  };
}

/** Boundary timing wrapper: the real adapter, with a delayed groups() read. */
function withGroupsDelay(base: CmsgClient, ms: number): CmsgClient {
  return {
    ...base,
    groups: async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return base.groups();
    },
  };
}

/** Boundary timing wrapper: slow first groups() read, fast follow-ups. */
function withDecreasingGroupsDelay(base: CmsgClient, firstMs: number, restMs: number): CmsgClient {
  let calls = 0;
  return {
    ...base,
    groups: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, calls === 1 ? firstMs : restMs));
      return base.groups();
    },
  };
}
/** Boundary timing wrapper: the real adapter, with a delayed group send. */
function withSendDelay(base: CmsgClient, ms: number): CmsgClient {
  return {
    ...base,
    sendGroupMessage: async (id: string, text: string) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return base.sendGroupMessage(id, text);
    },
  };
}

function render(client: CmsgClient, id: string) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(GroupDetail, { target, props: { client, id } });
  return {
    target,
    cleanup: () => {
      unmount(component);
      target.remove();
    },
  };
}

function renderHarness(client: CmsgClient, initialId: string) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const route = writable(initialId);
  const component = mount(GroupDetailHarness, { target, props: { client, route } });
  return {
    target,
    route,
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

function checkboxByName(target: HTMLElement, name: string): HTMLInputElement | null {
  const boxes = [...target.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
  return (
    boxes.find((box) => box.closest('label')?.textContent?.trim() === name) ?? null
  );
}

async function fill(target: HTMLElement, id: string, value: string) {
  const input = target.querySelector(`#${id}`) as HTMLInputElement | HTMLTextAreaElement | null;
  expect(input).not.toBeNull();
  input!.value = value;
  input!.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
}

async function selectKind(target: HTMLElement, value: string) {
  const select = target.querySelector('#fork-kind') as HTMLSelectElement | null;
  expect(select).not.toBeNull();
  select!.value = value;
  select!.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
}

describe('group detail conversation', () => {
  it('renders the provided level, next change, band, history and lineage with no seat meter', async () => {
    const client = createDevCmsg({ groups: [detailGroup()] });
    const { target, cleanup } = render(client, 'group-detail');
    try {
      await vi.waitFor(() => expect(target.querySelector('h1')).not.toBeNull());
      expect(target.textContent).toMatch(/Detail neighbours/);
      expect(target.textContent).toMatch(/Circle/);
      expect(target.textContent).toMatch(/At 13 members/);
      expect(target.textContent).toMatch(/90 messages per hour/);
      expect(target.textContent).toMatch(/Newcomers start fresh/);
      expect(target.textContent).toMatch(/detail-root/);
      expect(target.textContent).not.toMatch(/Seat budget/);
      expect(target.textContent).not.toMatch(/kick|expel|make admin|vote/i);
    } finally {
      cleanup();
    }
  });

  it('shows the seat meter only when the economy is enabled', async () => {
    const seated = { ...detailGroup(), id: 'group-seated', seatBudget: { enabled: true, label: 'One message a week keeps a seat free.' } };
    const client = createDevCmsg({ groups: [seated] });
    const { target, cleanup } = render(client, 'group-seated');
    try {
      await vi.waitFor(() => expect(target.querySelector('h1')).not.toBeNull());
      expect(target.textContent).toMatch(/Seat budget/);
      expect(target.textContent).toMatch(/keeps a seat free/);
    } finally {
      cleanup();
    }
  });

  it('sends a group message through the real adapter', async () => {
    const client = createDevCmsg({ groups: [detailGroup()] });
    const { target, cleanup } = render(client, 'group-detail');
    try {
      await vi.waitFor(() => expect(target.querySelector('#group-composer')).not.toBeNull());
      await fill(target, 'group-composer', 'Hello neighbours!');
      buttonByName(target, 'Send')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Hello neighbours!/));
    } finally {
      cleanup();
    }
  });

  it('locks the composer while sending so success cannot discard newer text', async () => {
    const base = createDevCmsg({ groups: [detailGroup()] });
    const client = withSendDelay(base, 60);
    const { target, cleanup } = render(client, 'group-detail');
    try {
      await vi.waitFor(() => expect(target.querySelector('#group-composer')).not.toBeNull());
      await fill(target, 'group-composer', 'Hello neighbours!');
      buttonByName(target, 'Send')?.click();
      await tick();
      expect((target.querySelector('#group-composer') as HTMLInputElement).disabled).toBe(true);
      await vi.waitFor(() => expect(target.textContent).toMatch(/Hello neighbours!/));
      expect((target.querySelector('#group-composer') as HTMLInputElement).value).toBe('');
    } finally {
      cleanup();
    }
  });

  it('chooses the roster from cmsg handles, then records the proposal without claiming anyone moved', async () => {
    const client = createDevCmsg({ groups: [detailGroup()] });
    const { target, cleanup } = render(client, 'group-detail');
    try {
      await vi.waitFor(() => expect(target.querySelector('#fork-kind')).not.toBeNull());
      await selectKind(target, 'add');
      await fill(target, 'fork-label', 'Garden helpers');
      await fill(target, 'fork-detail', 'Neighbours who water on Saturdays.');
      expect(target.querySelector('#fork-target')).toBeNull();
      // No raw member id entry: roster comes from cmsg-supplied checkboxes.
      expect(target.querySelector('#fork-roster')).toBeNull();
      checkboxByName(target, 'ana-walks')?.click();
      await tick();
      checkboxByName(target, 'tom-cooks')?.click();
      await tick();
      expect(target.textContent).toMatch(/Chosen roster/);
      expect(target.textContent).toMatch(/ana-walks, tom-cooks/);
      buttonByName(target, 'Propose fork')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Proposal recorded/));
      expect(target.textContent).toMatch(/Nobody has moved/);
      expect(target.textContent).not.toMatch(/moved to|mutation completed|members moved/i);
      expect(target.textContent).toMatch(/Garden helpers/);
      expect(target.textContent).toMatch(/Consent to this fork/);
    } finally {
      cleanup();
    }
  });

  it('shows the merge target selector only for merges, with cmsg group names', async () => {
    const client = createDevCmsg();
    const { target, cleanup } = render(client, 'group-garden');
    try {
      await vi.waitFor(() => expect(target.querySelector('#fork-kind')).not.toBeNull());
      expect(target.querySelector('#fork-target')).toBeNull();
      await selectKind(target, 'merge');
      const select = target.querySelector('#fork-target') as HTMLSelectElement | null;
      expect(select).not.toBeNull();
      const options = [...select!.options].map((o) => o.textContent);
      expect(options).toContain('Evening choir');
      expect(options).not.toContain('Community garden');
      await selectKind(target, 'split');
      expect(target.querySelector('#fork-target')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('consents explicitly from the returned outcome while nonmovers keep the original group', async () => {
    const client = createDevCmsg({ groups: [detailGroup()] });
    const { target, cleanup } = render(client, 'group-detail');
    try {
      await vi.waitFor(() => expect(target.querySelector('#fork-kind')).not.toBeNull());
      await selectKind(target, 'split');
      await fill(target, 'fork-label', 'Quiet half');
      await fill(target, 'fork-detail', 'A smaller circle for slow weekends.');
      checkboxByName(target, 'ana-walks')?.click();
      await tick();
      buttonByName(target, 'Propose fork')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Consent to this fork/));
      // The returned fork renders its roster by handle, not raw ids.
      expect(target.textContent).toMatch(/ana-walks/);
      buttonByName(target, 'Consent to this fork')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Consent recorded in/));
      expect(target.textContent).toMatch(/Nonmovers keep the original group/);
      const groups = await client.groups();
      expect(groups.find((g) => g.id === 'group-detail')?.joined).toBe(true);
      expect(target.querySelector('h1')?.textContent).toBe('Detail neighbours');
    } finally {
      cleanup();
    }
  });

  it('shows the welcome reply as an API note only and dismisses the suggestion', async () => {
    const client = createDevCmsg({ groups: [detailGroup()] });
    const { target, cleanup } = render(client, 'group-detail');
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/Welcome! Say hello/));
      buttonByName(target, 'Welcome a newcomer')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Group reply/));
      expect(target.textContent).toMatch(/Welcome to Detail neighbours!/);
      expect(target.textContent).not.toMatch(/\+0\.25|earned|reward/i);
      expect(target.textContent).toMatch(/Consider a split/);
      buttonByName(target, 'Dismiss suggestion')?.click();
      await vi.waitFor(() => expect(target.textContent).not.toMatch(/Consider a split/));
    } finally {
      cleanup();
    }
  });

  it('keeps first direct contact a wave without pointing at a peer-targeting screen', async () => {
    const client = createDevCmsg({ groups: [detailGroup()] });
    const { target, cleanup } = render(client, 'group-detail');
    try {
      await vi.waitFor(() => expect(target.querySelector('h1')).not.toBeNull());
      expect(target.textContent).toMatch(/send them a wave/);
      expect(target.querySelector('a[href="#/waves"]')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('surfaces injected adapter failures without inventing success', async () => {
    const failing: CmsgClient = {
      ...createDevCmsg({ groups: [detailGroup()] }),
      sendGroupMessage: async () => {
        throw new Error('Fixture failure for sendGroupMessage.');
      },
    };
    const { target, cleanup } = render(failing, 'group-detail');
    try {
      await vi.waitFor(() => expect(target.querySelector('#group-composer')).not.toBeNull());
      await fill(target, 'group-composer', 'Hello neighbours!');
      buttonByName(target, 'Send')?.click();
      await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).not.toBeNull());
      expect(target.textContent).toMatch(/Fixture failure/);
      expect(target.textContent).not.toMatch(/Hello neighbours!/);
    } finally {
      cleanup();
    }
  });

  it('switches one mounted instance to the new route and ignores the slower stale load', async () => {
    const base = createDevCmsg();
    // The garden read lands last; only the token guard keeps it from winning.
    const client = withDecreasingGroupsDelay(base, 120, 20);
    const { target, route, cleanup } = renderHarness(client, 'group-garden');
    try {
      route.set('group-choir');
      await tick();
      await vi.waitFor(() => expect(target.querySelector('h1')?.textContent).toBe('Evening choir'));
      await new Promise((resolve) => setTimeout(resolve, 250));
      await tick();
      expect(target.querySelector('h1')?.textContent).toBe('Evening choir');
      expect(target.textContent).not.toMatch(/Community garden/);
    } finally {
      cleanup();
    }
  });

  it('prefers a newer groups event over a stale in-flight load', async () => {
    const base = createDevCmsg();
    const client = withGroupsDelay(base, 60);
    const { target, route, cleanup } = renderHarness(client, 'group-garden');
    try {
      route.set('group-choir');
      await tick();
      await base.proposeFork({
        groupId: 'group-choir',
        kind: 'split',
        label: 'Evening half',
        detail: 'A smaller circle for slow songs.',
      });
      await vi.waitFor(() => expect(target.textContent).toMatch(/Evening half/));
      expect(target.querySelector('h1')?.textContent).toBe('Evening choir');
      expect(target.textContent).not.toMatch(/Community garden/);
    } finally {
      cleanup();
    }
  });

  it('shows unavailable when the routed group is absent and never renders it', async () => {
    const base = createDevCmsg({ groups: [detailGroup()] });
    const onlySeeded: CmsgClient = {
      ...base,
      groups: async () => (await base.groups()).filter((g) => g.id !== 'group-detail'),
    };
    const { target, cleanup } = render(onlySeeded, 'group-detail');
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/not available/));
      expect(target.querySelector('h1')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('tears down mid-load without errors or stray content', async () => {
    const base = createDevCmsg();
    const client = withGroupsDelay(base, 80);
    const { target, cleanup } = render(client, 'group-garden');
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await tick();
    expect(document.body.contains(target)).toBe(false);
  });
});
