import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import GroupDetail from '../../src/views/GroupDetail.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { CmsgClient, CreditStatus, GroupView } from '../../../../core/src/cmsg.js';

function circle(): GroupView {
  return {
    id: 'group-credit', name: 'Credit circle', level: 'circle', size: 9,
    whatChangesNext: 'At 13 members, a consented fork can become an Ingroup.',
    description: 'A circle for credit tests.', joinConsent: null, joined: true,
    newcomerHistory: 'Newcomers start fresh.', messages: [], suggestion: null,
    welcomePrompt: 'Welcome the newcomer.',
    members: [{ id: 'member-ana', handle: 'ana-walks' }, { id: 'member-tom', handle: 'tom-cooks' }],
    forks: [],
  };
}
function render(client: CmsgClient) {
  const target = document.createElement('div');
  document.body.append(target);
  const view = mount(GroupDetail, { target, props: { client, id: 'group-credit' } });
  return { target, cleanup: () => { void unmount(view); target.remove(); } };
}
const press = (target: HTMLElement, name: string) =>
  [...target.querySelectorAll('button')].find((b) => b.textContent?.includes(name))!;
function choose(target: HTMLElement, id: string, value: string) {
  const select = target.querySelector(`#${id}`) as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
const statuses: CreditStatus[] = ['pending', 'credited', 'capped', 'failed'];

describe('credit receipts in the development adapter', () => {
  it('reports every credit outcome for welcomes and introductions', async () => {
    for (const status of statuses) {
      const client = createDevCmsg({ groups: [circle()], creditStatus: status });
      const welcome = await client.welcomeMember('group-credit');
      const intro = await client.introduceMembers('group-credit', 'member-ana', 'member-tom');
      expect(welcome.credit.status).toBe(status);
      expect(intro.status).toBe(status);
      expect(welcome.credit.kind).toBe('welcome');
      expect(intro.kind).toBe('introduction');
      expect(Boolean(intro.valueLabel)).toBe(status === 'credited');
      expect(Boolean(welcome.credit.valueLabel)).toBe(status === 'credited');
    }
    const defaults = createDevCmsg({ groups: [circle()] });
    expect((await defaults.introduceMembers('group-credit', 'member-ana', 'member-tom')).explanation).toContain('answered their first contact');
    expect((await defaults.welcomeMember('group-credit')).credit.explanation).toContain('once it is confirmed');
  });

  it('refuses invalid introductions and keeps the failure boundary', async () => {
    const client = createDevCmsg({ groups: [circle(), { ...circle(), id: 'group-other', joined: false }] });
    await expect(client.introduceMembers('missing', 'member-ana', 'member-tom')).rejects.toThrow('not available');
    await expect(client.introduceMembers('group-other', 'member-ana', 'member-tom')).rejects.toThrow('Join the group');
    await expect(client.introduceMembers('group-credit', 'member-ana', 'member-ana')).rejects.toThrow('two different');
    await expect(client.introduceMembers('group-credit', 'member-ana', 'stranger')).rejects.toThrow('belong to this group');
    await expect(client.introduceMembers('group-credit', 'stranger', 'member-tom')).rejects.toThrow('belong to this group');
    const bare = createDevCmsg({ groups: [{ ...circle(), members: undefined }] });
    await expect(bare.introduceMembers('group-credit', 'member-ana', 'member-tom')).rejects.toThrow('belong to this group');
    const failing = createDevCmsg({ groups: [circle()], failActions: ['introduceMembers'] });
    await expect(failing.introduceMembers('group-credit', 'member-ana', 'member-tom')).rejects.toThrow('Fixture failure');
  });
});

describe('credit presentation', () => {
  it.each(statuses)('renders a %s welcome receipt only after cmsg returns it', async (status) => {
    const { target, cleanup } = render(createDevCmsg({ groups: [circle()], creditStatus: status }));
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('Welcome the newcomer.'));
      expect(target.textContent).not.toContain('Credited');
      press(target, 'Welcome a newcomer').click();
      const label = { pending: 'Credit pending', credited: 'Credited', capped: 'No credit this week', failed: 'Credit not confirmed' }[status];
      await vi.waitFor(() => expect(target.textContent).toContain(label));
      expect(target.textContent?.includes('+0.25')).toBe(status === 'credited');
    } finally { cleanup(); }
  });

  it('introduces two members, never exposes credit early and clears the choice', async () => {
    const { target, cleanup } = render(createDevCmsg({ groups: [circle()], creditStatus: 'credited' }));
    try {
      await vi.waitFor(() => expect(target.querySelector('#introduce-a')).not.toBeNull());
      expect(target.textContent).toContain('never costs you a wave');
      press(target, 'Introduce').click();
      await vi.waitFor(() => expect(target.textContent).toContain('Choose two members'));
      choose(target, 'introduce-a', 'member-ana');
      choose(target, 'introduce-b', 'member-tom');
      await tick();
      press(target, 'Introduce').click();
      await vi.waitFor(() => expect(target.textContent).toContain('Credited.'));
      expect(target.textContent).toContain('Credit: +1');
      expect((target.querySelector('#introduce-a') as HTMLSelectElement).value).toBe('');
    } finally { cleanup(); }
  });

  it('shows a refused introduction as an error and drops late replies', async () => {
    const base = createDevCmsg({ groups: [circle()] });
    const { target, cleanup } = render(base);
    try {
      await vi.waitFor(() => expect(target.querySelector('#introduce-a')).not.toBeNull());
      choose(target, 'introduce-a', 'member-ana');
      choose(target, 'introduce-b', 'member-ana');
      await tick();
      press(target, 'Introduce').click();
      await vi.waitFor(() => expect(target.textContent).toContain('two different'));
    } finally { cleanup(); }

    const nonError = { ...base, introduceMembers: () => Promise.reject('plain') } as unknown as CmsgClient;
    const second = render(nonError);
    try {
      await vi.waitFor(() => expect(second.target.querySelector('#introduce-a')).not.toBeNull());
      choose(second.target, 'introduce-a', 'member-ana');
      choose(second.target, 'introduce-b', 'member-tom');
      await tick();
      press(second.target, 'Introduce').click();
      await vi.waitFor(() => expect(second.target.textContent).toContain('The introduction did not work.'));
    } finally { second.cleanup(); }

    let release: () => void = () => {};
    const slow = {
      ...base,
      introduceMembers: (g: string, a: string, b: string) => new Promise((resolve) => { release = () => resolve(base.introduceMembers(g, a, b)); }),
    } as unknown as CmsgClient;
    const third = render(slow);
    await vi.waitFor(() => expect(third.target.querySelector('#introduce-a')).not.toBeNull());
    choose(third.target, 'introduce-a', 'member-ana');
    choose(third.target, 'introduce-b', 'member-tom');
    await tick();
    press(third.target, 'Introduce').click();
    await tick();
    third.cleanup();
    release();
    await tick();
  });
});
