import { describe, expect, it, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import Contacts from '../../src/views/Contacts.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';

async function seedEstablished(client: ReturnType<typeof createDevCmsg>) {
  const [incoming] = await client.incomingWaves();
  await client.answerWave(incoming!.id, 'Hello back');
}

function makeTarget() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  return target;
}

describe('contacts with real state', () => {
  it('loads an established contact with peer presence only from the API', async () => {
    const client = createDevCmsg();
    await seedEstablished(client);
    const target = makeTarget();
    const view = mount(Contacts, { target, props: { client } });
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('tom-cooks'));
      expect(target.textContent).toContain('Established');
      // Peer presence comes from the API fixture (tom is online).
      expect(target.textContent).toContain('Online');
      // No invented favourites or ranking.
      expect(target.textContent).not.toMatch(/favourite|rank/i);
      expect(target.querySelector('[role="status"]')).toBeNull();
    } finally {
      await client.disconnect();
      await unmount(view);
      target.remove();
    }
  });

  it('shows a useful empty state before any contact exists', async () => {
    const client = createDevCmsg();
    const target = makeTarget();
    const view = mount(Contacts, { target, props: { client } });
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('No contacts yet'));
      expect(target.textContent).toContain('Answer a wave');
    } finally {
      await client.disconnect();
      await unmount(view);
      target.remove();
    }
  });

  it('block is a separate action and at once stops discovery of that member', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher({ voucher: 'VOUCHER-TEST-123', handle: 'test-member' });
    await client.publishProfile({ age: 34, neighbourhood: 'North', weekend: 'Hiking' });
    await seedEstablished(client);
    const before = await client.discover([]);
    expect(before.entries.map((e) => e.handle)).toContain('tom-cooks');
    const target = makeTarget();
    const view = mount(Contacts, { target, props: { client } });
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('tom-cooks'));
      [...target.querySelectorAll('button')].find((b) => b.textContent === 'Block')!.click();
      await vi.waitFor(() => expect(target.textContent).toContain('Blocked'));
      const after = await client.discover([]);
      expect(after.entries.map((e) => e.handle)).not.toContain('tom-cooks');
      const contact = (await client.contacts()).find((c) => c.memberId === 'member-tom')!;
      expect(contact.blockedByMe).toBe(true);
      expect(contact.relation).toBe('blocked');
    } finally {
      await client.disconnect();
      await unmount(view);
      target.remove();
    }
  });

  it('unblock leaves a closed relation and never opens chat automatically', async () => {
    const client = createDevCmsg();
    await seedEstablished(client);
    await client.blockMember('member-tom');
    window.location.hash = '#/contacts';
    const target = makeTarget();
    const view = mount(Contacts, { target, props: { client } });
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('Blocked'));
      [...target.querySelectorAll('button')].find((b) => b.textContent === 'Unblock')!.click();
      await vi.waitFor(() => expect(target.textContent).toContain('Closed'));
      const contact = (await client.contacts()).find((c) => c.memberId === 'member-tom')!;
      expect(contact.blockedByMe).toBe(false);
      expect(contact.relation).toBe('closed');
      // No automatic navigation to the thread.
      expect(window.location.hash).toBe('#/contacts');
      // The closed note explains the explicit reopen step.
      expect(target.textContent).toContain('explicit request');
    } finally {
      await client.disconnect();
      await unmount(view);
      target.remove();
    }
  });

  it('a closed relation offers an explicit reopen request that stays pending', async () => {
    const client = createDevCmsg();
    await seedEstablished(client);
    await client.closeConversation('member-tom');
    const target = makeTarget();
    const view = mount(Contacts, { target, props: { client } });
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('Closed'));
      [...target.querySelectorAll('button')].find((b) => b.textContent === 'Request reopening')!.click();
      await vi.waitFor(() => expect(target.textContent).toContain('Pending'));
      const contact = (await client.contacts()).find((c) => c.memberId === 'member-tom')!;
      expect(contact.relation).toBe('pending');
      const thread = await client.thread('member-tom');
      expect(thread.established).toBe(false);
    } finally {
      await client.disconnect();
      await unmount(view);
      target.remove();
    }
  });

  it('a refused block keeps the established contact and shows the backend error', async () => {
    const client = createDevCmsg({ failActions: ['blockMember'] });
    await seedEstablished(client);
    const target = makeTarget();
    const view = mount(Contacts, { target, props: { client } });
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('tom-cooks'));
      [...target.querySelectorAll('button')].find((b) => b.textContent === 'Block')!.click();
      await vi.waitFor(() => expect(target.textContent).toContain('Fixture failure for blockMember'));
      // The established member is preserved; nothing was removed.
      expect(target.textContent).toContain('tom-cooks');
      expect(target.textContent).toContain('Established');
      const contact = (await client.contacts()).find((c) => c.memberId === 'member-tom')!;
      expect(contact.relation).toBe('established');
    } finally {
      await client.disconnect();
      await unmount(view);
      target.remove();
    }
  });

  it('a refused unblock preserves the blocked contact and a refused reopen preserves closed', async () => {
    const blockedClient = createDevCmsg({ failActions: ['unblockMember'] });
    await seedEstablished(blockedClient);
    await blockedClient.blockMember('member-tom');
    const target = makeTarget();
    const view = mount(Contacts, { target, props: { client: blockedClient } });
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('Blocked'));
      [...target.querySelectorAll('button')].find((b) => b.textContent === 'Unblock')!.click();
      await vi.waitFor(() => expect(target.textContent).toContain('Fixture failure for unblockMember'));
      expect(target.textContent).toContain('tom-cooks');
      expect((await blockedClient.contacts()).find((c) => c.memberId === 'member-tom')?.relation).toBe('blocked');
    } finally {
      await blockedClient.disconnect();
      await unmount(view);
      target.remove();
    }

    const closedClient = createDevCmsg({ failActions: ['requestReopen'] });
    await seedEstablished(closedClient);
    await closedClient.closeConversation('member-tom');
    const target2 = makeTarget();
    const view2 = mount(Contacts, { target: target2, props: { client: closedClient } });
    try {
      await vi.waitFor(() => expect(target2.textContent).toContain('Closed'));
      [...target2.querySelectorAll('button')].find((b) => b.textContent === 'Request reopening')!.click();
      await vi.waitFor(() => expect(target2.textContent).toContain('Fixture failure for requestReopen'));
      expect((await closedClient.contacts()).find((c) => c.memberId === 'member-tom')?.relation).toBe('closed');
    } finally {
      await closedClient.disconnect();
      await unmount(view2);
      target2.remove();
    }
  });

  it('preserves other members when one action is refused', async () => {
    const client = createDevCmsg({ failActions: ['blockMember'] });
    await seedEstablished(client);
    // A closed contact created without the refused block path.
    await client.closeConversation('member-ana');
    expect((await client.contacts()).map((c) => c.memberId)).toEqual(
      expect.arrayContaining(['member-tom', 'member-ana']),
    );
    const target = makeTarget();
    const view = mount(Contacts, { target, props: { client } });
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('ana-walks'));
      [...target.querySelectorAll('button')].find((b) => b.textContent === 'Block')!.click();
      await vi.waitFor(() => expect(target.textContent).toContain('Fixture failure for blockMember'));
      // Both members stay listed; the refused action removed nothing.
      expect(target.textContent).toContain('tom-cooks');
      expect(target.textContent).toContain('ana-walks');
    } finally {
      await client.disconnect();
      await unmount(view);
      target.remove();
    }
  });

  it('ignores stale adapter events after unmount', async () => {
    const client = createDevCmsg();
    await seedEstablished(client);
    const target = makeTarget();
    const view = mount(Contacts, { target, props: { client } });
    await vi.waitFor(() => expect(target.textContent).toContain('tom-cooks'));
    await unmount(view);
    // A late backend event must not update the detached view or throw.
    await expect(client.blockMember('member-tom')).resolves.toBeUndefined();
    await client.disconnect();
    target.remove();
  });
});
