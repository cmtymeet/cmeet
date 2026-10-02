import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import GroupDetail from '../../src/views/GroupDetail.svelte';
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
    members: [{ id: 'member-ana', handle: 'ana-walks' }],
    forks: [],
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

function buttonByName(target: HTMLElement, name: string): HTMLButtonElement | null {
  const buttons = [...target.querySelectorAll('button')];
  return (buttons.find((b) => b.textContent?.trim() === name) as HTMLButtonElement) ?? null;
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

  it('previews the proposed roster, then records the proposal without claiming anyone moved', async () => {
    const client = createDevCmsg({ groups: [detailGroup()] });
    const { target, cleanup } = render(client, 'group-detail');
    try {
      await vi.waitFor(() => expect(target.querySelector('#fork-kind')).not.toBeNull());
      await selectKind(target, 'add');
      await fill(target, 'fork-label', 'Garden helpers');
      await fill(target, 'fork-detail', 'Neighbours who water on Saturdays.');
      await fill(target, 'fork-roster', 'member-ana, member-tom');
      expect(target.textContent).toMatch(/Roster preview/);
      expect(target.textContent).toMatch(/member-ana, member-tom/);
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

  it('consents explicitly while nonmovers keep the original group', async () => {
    const client = createDevCmsg({ groups: [detailGroup()] });
    const { target, cleanup } = render(client, 'group-detail');
    try {
      await vi.waitFor(() => expect(target.querySelector('#fork-kind')).not.toBeNull());
      await selectKind(target, 'split');
      await fill(target, 'fork-label', 'Quiet half');
      await fill(target, 'fork-detail', 'A smaller circle for slow weekends.');
      buttonByName(target, 'Propose fork')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Consent to this fork/));
      buttonByName(target, 'Consent to this fork')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Nonmovers keep the original group/));
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

  it('keeps first direct contact on waves, never as free messaging here', async () => {
    const client = createDevCmsg({ groups: [detailGroup()] });
    const { target, cleanup } = render(client, 'group-detail');
    try {
      await vi.waitFor(() => expect(target.querySelector('h1')).not.toBeNull());
      expect(target.textContent).toMatch(/send a wave/);
      expect(target.querySelector('a[href="#/waves"]')).not.toBeNull();
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

  it('renders the routed group and switches cleanly between ids', async () => {
    const client = createDevCmsg();
    const first = render(client, 'group-garden');
    try {
      await vi.waitFor(() => expect(first.target.querySelector('h1')).not.toBeNull());
      expect(first.target.querySelector('h1')?.textContent).toBe('Community garden');
    } finally {
      first.cleanup();
    }
    const second = render(client, 'group-choir');
    try {
      await vi.waitFor(() => expect(second.target.querySelector('h1')).not.toBeNull());
      expect(second.target.querySelector('h1')?.textContent).toBe('Evening choir');
      expect(second.target.textContent).not.toMatch(/Community garden/);
    } finally {
      second.cleanup();
    }
  });
});
