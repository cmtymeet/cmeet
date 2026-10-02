import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Groups from '../../src/views/Groups.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { CmsgClient, GroupView } from '../../../../core/src/cmsg.js';

function render(client: CmsgClient) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(Groups, { target, props: { client } });
  return {
    target,
    cleanup: () => {
      unmount(component);
      target.remove();
    },
  };
}

function articleByName(target: HTMLElement, name: string): HTMLElement | null {
  const articles = [...target.querySelectorAll('article')];
  return (articles.find((a) => a.getAttribute('aria-label')?.includes(name)) as HTMLElement) ?? null;
}

function buttonIn(scope: ParentNode, name: string | RegExp): HTMLButtonElement | null {
  const buttons = [...scope.querySelectorAll('button')];
  return (
    (buttons.find((b) =>
      typeof name === 'string' ? b.textContent?.includes(name) : name.test(b.textContent ?? ''),
    ) as HTMLButtonElement) ?? null
  );
}

const BAND_GROUP: GroupView = {
  id: 'group-tiny-room',
  name: 'Tiny room',
  level: 'room',
  size: 5,
  whatChangesNext: 'At 36 or fewer members, this room becomes a hidden Ingroup.',
  description: 'A listed room that stayed small.',
  joinConsent: 'Members see each other\u2019s private profiles. Joining means consenting to that visibility.',
  joined: false,
  newcomerHistory: 'Newcomers receive the last 12 hours (up to 50 messages).',
  messages: [],
  suggestion: 'Invite people who would enjoy this conversation.',
  band: {
    notifications: 'Mentions only; a daily digest.',
    postingPace: '12 messages per hour; burst of 4.',
    joining: 'Explicit visibility consent; at most 6 joins per hour.',
  },
  seatBudget: { enabled: false, label: 'No seat budget in this room.' },
  forks: [],
};

const HUGE_CIRCLE: GroupView = {
  id: 'group-huge-circle',
  name: 'Huge circle',
  level: 'circle',
  size: 100,
  whatChangesNext: 'At 13 members, a consented fork can become an Ingroup.',
  description: 'A hidden circle with an unusual size in the fixture.',
  joinConsent: null,
  joined: false,
  newcomerHistory: 'Newcomers start fresh; earlier messages stay with the group.',
  messages: [],
  suggestion: null,
  band: {
    notifications: 'Every message, with quiet hours respected.',
    postingPace: '90 messages per hour; burst of 15.',
    joining: 'Invitation through an own contact; movers consent to a fork.',
  },
  seatBudget: { enabled: false, label: 'No seat budget in this circle.' },
  forks: [],
};

const SEAT_ROOM: GroupView = {
  ...BAND_GROUP,
  id: 'group-seat-room',
  name: 'Seat room',
  seatBudget: { enabled: true, label: 'Seat budget: 3 of 10 seats in use.' },
};

describe('groups list', () => {
  it('renders every supplied level with size, next change, band, history and opening data', async () => {
    window.location.hash = '';
    const { target, cleanup } = render(createDevCmsg());
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/Community garden/));
      expect(target.textContent).toMatch(/Circle/);
      expect(target.textContent).toMatch(/Ingroup/);
      expect(target.textContent).toMatch(/Public room/);
      expect(target.textContent).toMatch(/Opening room/);
      expect(target.textContent).toMatch(/What changes next/);
      expect(target.textContent).toMatch(/8 members/);
      expect(target.textContent).toMatch(/67 members/);
      // Band display data comes verbatim from cmsg.
      expect(target.textContent).toMatch(/Every message/);
      expect(target.textContent).toMatch(/Mentions only/);
      expect(target.textContent).toMatch(/at most 6 joins per hour/);
      expect(target.textContent).toMatch(/last 12 hours/);
      // Opening progress and deadline come from the API.
      expect(target.textContent).toMatch(/28 of 43 members/);
      expect(target.textContent).toMatch(/21 days/);
    } finally {
      cleanup();
    }
  });

  it('never derives the level from size', async () => {
    window.location.hash = '';
    const { target, cleanup } = render(createDevCmsg({ groups: [BAND_GROUP, HUGE_CIRCLE] }));
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/Tiny room/));
      const tiny = articleByName(target, 'Tiny room');
      expect(tiny?.textContent).toMatch(/Public room/);
      expect(tiny?.textContent).toMatch(/At 36 or fewer/);
      const huge = articleByName(target, 'Huge circle');
      expect(huge?.textContent).toMatch(/Circle/);
      expect(huge?.textContent).toMatch(/At 13 members/);
    } finally {
      cleanup();
    }
  });

  it('hides the seat display unless the API enables it', async () => {
    window.location.hash = '';
    const hidden = render(createDevCmsg());
    try {
      await vi.waitFor(() => expect(hidden.target.textContent).toMatch(/Saturday market/));
      expect(hidden.target.textContent).not.toMatch(/Seat budget/);
    } finally {
      hidden.cleanup();
    }
    const shown = render(createDevCmsg({ groups: [SEAT_ROOM] }));
    try {
      await vi.waitFor(() => expect(shown.target.textContent).toMatch(/Seat room/));
      expect(shown.target.textContent).toMatch(/Seat budget/);
      expect(shown.target.textContent).toMatch(/3 of 10 seats in use/);
    } finally {
      shown.cleanup();
    }
  });

  it('asks explicit consent for rooms and joins with (id, true) only after checking', async () => {
    window.location.hash = '';
    const client = createDevCmsg();
    const spy = vi.spyOn(client, 'joinGroup');
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/Saturday market/));
      const article = articleByName(target, 'Saturday market')!;
      buttonIn(article, 'Join')?.click();
      await tick();
      const dialog = target.querySelector('dialog');
      expect(dialog).not.toBeNull();
      expect(dialog?.textContent).toMatch(/consenting/);
      const confirm = buttonIn(dialog!, /Join Saturday market/)!;
      expect(confirm.disabled).toBe(true);
      expect(spy).not.toHaveBeenCalled();
      const check = target.querySelector('#join-consent-check') as HTMLInputElement;
      check.click();
      await tick();
      expect(buttonIn(target.querySelector('dialog')!, /Join Saturday market/)!.disabled).toBe(false);
      buttonIn(target.querySelector('dialog')!, /Join Saturday market/)?.click();
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      expect(spy).toHaveBeenCalledWith('group-market', true);
      await vi.waitFor(() => expect(window.location.hash).toContain('group-market'));
    } finally {
      cleanup();
    }
  });

  it('also gates the opening room behind the same affirmative consent', async () => {
    window.location.hash = '';
    const client = createDevCmsg();
    const spy = vi.spyOn(client, 'joinGroup');
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/Newcomers opening/));
      articleByName(target, 'Newcomers opening');
      const article = articleByName(target, 'Newcomers opening')!;
      buttonIn(article, 'Join')?.click();
      await tick();
      expect(target.querySelector('dialog')).not.toBeNull();
      expect(spy).not.toHaveBeenCalled();
      (target.querySelector('#join-consent-check') as HTMLInputElement).click();
      await tick();
      buttonIn(target.querySelector('dialog')!, /Join Newcomers opening/)?.click();
      await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('group-opening', true));
    } finally {
      cleanup();
    }
  });

  it('shows a refused consent join inside the dialog and locks its controls while submitting', async () => {
    window.location.hash = '';
    const base = createDevCmsg();
    let rejectJoin!: (reason: Error) => void;
    const gated: CmsgClient = {
      ...base,
      joinGroup: (id: string, consent?: boolean) =>
        new Promise<GroupView>((_resolve, reject) => {
          rejectJoin = reject;
        }).then(() => base.joinGroup(id, consent)),
    };
    const { target, cleanup } = render(gated);
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/Saturday market/));
      buttonIn(articleByName(target, 'Saturday market')!, 'Join')?.click();
      await tick();
      const dialog = target.querySelector('dialog')!;
      (target.querySelector('#join-consent-check') as HTMLInputElement).click();
      await tick();
      buttonIn(dialog, /Join Saturday market/)?.click();
      await tick();
      // While submitting, the dialog locks and the background stays inert.
      expect((target.querySelector('#join-consent-check') as HTMLInputElement).disabled).toBe(true);
      expect(buttonIn(dialog, 'Cancel')!.disabled).toBe(true);
      expect(buttonIn(articleByName(target, 'Saturday market')!, 'Join')!.disabled).toBe(true);
      rejectJoin(new Error('The groups service is unavailable. Try again later.'));
      await vi.waitFor(() => expect(dialog.querySelector('[role="alert"]')).not.toBeNull());
      expect(dialog.textContent).toMatch(/groups service is unavailable/);
      // The dialog stays open for an explicit retry or cancel; nothing navigated.
      expect(target.querySelector('dialog')).not.toBeNull();
      expect(window.location.hash).not.toContain('group-market');
      buttonIn(dialog, 'Cancel')?.click();
      await tick();
      expect(target.querySelector('dialog')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('explains visibility in the dialog when the API supplies no consent text', async () => {
    window.location.hash = '';
    const quietRoom: GroupView = { ...BAND_GROUP, id: 'group-quiet-room', name: 'Quiet room', joinConsent: null };
    const { target, cleanup } = render(createDevCmsg({ groups: [quietRoom] }));
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/Quiet room/));
      buttonIn(articleByName(target, 'Quiet room')!, 'Join')?.click();
      await tick();
      const dialog = target.querySelector('dialog')!;
      expect(dialog.textContent).toMatch(/private profiles/);
      expect(dialog.textContent).toMatch(/consenting to that visibility/);
    } finally {
      cleanup();
    }
  });

  it('does not navigate after teardown when a slow join completes', async () => {
    window.location.hash = '';
    const base = createDevCmsg();
    let release!: () => void;
    const slow: CmsgClient = {
      ...base,
      joinGroup: async (id: string, consent?: boolean) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return base.joinGroup(id, consent);
      },
    };
    const { target, cleanup } = render(slow);
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/Evening choir/));
      buttonIn(articleByName(target, 'Evening choir')!, 'Join')?.click();
      await tick();
      expect(typeof release).toBe('function');
      // The member navigates away before the slow join completes.
      cleanup();
      window.location.hash = '#/forum';
      release();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(window.location.hash).toBe('#/forum');
    } finally {
      window.location.hash = '';
    }
  });

  it('recovers through retry after a refused load and clears the error', async () => {
    window.location.hash = '';
    const base = createDevCmsg();
    let calls = 0;
    const flaky: CmsgClient = {
      ...base,
      groups: async () => {
        calls += 1;
        if (calls === 1) throw new Error('The groups service is unavailable. Try again later.');
        return base.groups();
      },
    };
    const { target, cleanup } = render(flaky);
    try {
      await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).not.toBeNull());
      expect(target.textContent).toMatch(/unavailable/);
      expect(target.textContent).not.toMatch(/No groups yet/);
      buttonIn(target, 'Try again')?.click();
      await vi.waitFor(() => expect(target.textContent).toMatch(/Saturday market/));
      expect(target.querySelector('[role="alert"]')).toBeNull();
    } finally {
      cleanup();
    }
  });
  it('lets the adapter refuse room joins without affirmative consent', async () => {
    const client = createDevCmsg();
    await expect(client.joinGroup('group-market')).rejects.toThrow('consent');
    await expect(client.joinGroup('group-market', false)).rejects.toThrow('consent');
    const joined = await client.joinGroup('group-market', true);
    expect(joined.joined).toBe(true);
  });

  it('distinguishes loading, refusal and empty, and retry recovers', async () => {
    window.location.hash = '';
    // Loading is shown before the first response settles.
    const slowBase = createDevCmsg();
    const loadingClient: CmsgClient = {
      ...slowBase,
      groups: async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return slowBase.groups();
      },
    };
    const loading = render(loadingClient);
    try {
      expect(loading.target.textContent).toMatch(/Loading/);
      await vi.waitFor(() => expect(loading.target.textContent).toMatch(/Saturday market/));
    } finally {
      loading.cleanup();
    }
    // Refusal is an error with retry, never the empty state.
    const refusing = render(createDevCmsg({ failActions: ['groups'] }));
    try {
      await vi.waitFor(() => expect(refusing.target.querySelector('[role="alert"]')).not.toBeNull());
      expect(refusing.target.textContent).toMatch(/Fixture failure/);
      expect(refusing.target.textContent).not.toMatch(/No groups yet/);
    } finally {
      refusing.cleanup();
    }
    // An admitted empty list is its own state.
    const empty = render(createDevCmsg({ groups: [] }));
    try {
      await vi.waitFor(() => expect(empty.target.textContent).toMatch(/No groups yet/));
      expect(empty.target.textContent).toMatch(/Seed rooms/);
    } finally {
      empty.cleanup();
    }
  });

  it('guards busy joins, applies live updates and keeps joins free of waves', async () => {
    window.location.hash = '';
    const client = createDevCmsg();
    const joinSpy = vi.spyOn(client, 'joinGroup');
    const waveSpy = vi.spyOn(client, 'sendWave');
    const before = await client.waveSlots();
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/Community garden/));
      // Suggestions read as invitations, never orders.
      expect(target.textContent).toMatch(/Invitation/);
      expect(target.textContent).toMatch(/Joining never costs a wave/);
      // Circles without consent text join directly; a double click joins once.
      const garden = articleByName(target, 'Community garden');
      expect(garden?.textContent).toMatch(/Joined/);
      const choir = articleByName(target, 'Evening choir')!;
      const join = buttonIn(choir, 'Join')!;
      join.click();
      join.click();
      await vi.waitFor(() => expect(joinSpy).toHaveBeenCalledTimes(1));
      // Live cmsg events update the list without a stale overwrite.
      await client.joinGroup('group-choir');
      await vi.waitFor(() => expect(articleByName(target, 'Evening choir')?.textContent).toMatch(/Joined/));
      const after = await client.waveSlots();
      expect(after).toEqual(before);
      expect(waveSpy).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('surfaces injected join failures without inventing another path', async () => {
    window.location.hash = '';
    const client = createDevCmsg({ failActions: ['joinGroup'] });
    const { target, cleanup } = render(client);
    try {
      await vi.waitFor(() => expect(target.textContent).toMatch(/Evening choir/));
      buttonIn(articleByName(target, 'Evening choir')!, 'Join')?.click();
      await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).not.toBeNull());
      expect(target.textContent).toMatch(/Fixture failure for joinGroup/);
    } finally {
      cleanup();
    }
  });
});
