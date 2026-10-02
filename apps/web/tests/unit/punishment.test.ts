import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Waves from '../../src/views/Waves.svelte';
import Chat from '../../src/views/Chat.svelte';
import ChatHarness from './fixtures/ChatHarness.svelte';
import PublicCard from '../../../../ui/src/components/PublicCard.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { PublicRecord } from '../../../../core/src/cmsg.js';

const button = (target: HTMLElement, name: string) => [...target.querySelectorAll('button')].find(b => b.textContent?.trim() === name)!;

describe('punishment confirmation', () => {
  for (const surface of ['wave', 'chat'] as const) {
    it(`${surface}: cancel leaves both participants unchanged; confirm delegates once`, async () => {
      const client = createDevCmsg();
      if (surface === 'chat') await client.answerWave((await client.incomingWaves())[0]!.id, 'Hello');
      const before = await client.waveSlots();
      const target = document.createElement('div'); document.body.append(target);
      const view = surface === 'wave' ? mount(Waves, {target, props: {client}}) : mount(Chat, {target, props: {client, peer: 'member-tom'}});
      const action = vi.spyOn(client, surface === 'wave' ? 'punishWave' : 'punishConversation');
      try {
        await vi.waitFor(() => expect(button(target, 'Punish')).toBeTruthy());
        button(target, 'Punish').click(); await tick();
        expect(target.querySelector('dialog')?.open).toBe(true);
        expect(target.querySelector('dialog')?.textContent).toContain('costs both');
        button(target, 'Cancel').click(); await tick();
        expect(action).not.toHaveBeenCalled();
        expect(await client.waveSlots()).toEqual(before);
        button(target, 'Punish').click(); await tick();
        button(target, 'Confirm punishment').click(); button(target, 'Confirm punishment').click();
        await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(target.querySelector('dialog')?.open).toBe(false));
        expect((await client.contacts()).find(c => c.memberId === 'member-tom')?.blockedByMe).toBe(true);
        if (surface === 'wave') expect((await client.incomingWaves())[0]!.state).toBe('punished');
        else expect((await client.thread('member-tom')).state).toBe('blocked');
      } finally { await unmount(view); target.remove(); await client.disconnect(); }
    });
    it(`${surface}: refusal preserves state and the confirmation for retry`, async () => {
      const client = createDevCmsg({failActions: [surface === 'wave' ? 'punishWave' : 'punishConversation']});
      if (surface === 'chat') await client.answerWave((await client.incomingWaves())[0]!.id, 'Hello');
      const target = document.createElement('div'); document.body.append(target);
      const view = surface === 'wave' ? mount(Waves, {target, props: {client}}) : mount(Chat, {target, props: {client, peer: 'member-tom'}});
      try {
        await vi.waitFor(() => expect(button(target, 'Punish')).toBeTruthy());
        button(target, 'Punish').click(); await tick(); button(target, 'Confirm punishment').click();
        await vi.waitFor(() => expect(target.querySelector('dialog')?.textContent).toContain('Fixture failure'));
        expect(target.querySelector('dialog')?.open).toBe(true);
        expect((await client.contacts()).some(c => c.blockedByMe)).toBe(false);
        target.querySelector('dialog')!.dispatchEvent(new Event('cancel', {cancelable: true})); await tick();
        expect(target.querySelector('dialog')?.open).toBe(false);
      } finally { await unmount(view); target.remove(); await client.disconnect(); }
    });
  }
  it('clears a pending confirmation when changing the conversation', async () => {
    const client = createDevCmsg();
    await client.answerWave((await client.incomingWaves())[0]!.id, 'Hello');
    const target = document.createElement('div'); document.body.append(target);
    const view = mount(ChatHarness, {target, props: {client, initialPeer: 'member-tom'}});
    try {
      await vi.waitFor(() => expect(button(target, 'Punish')).toBeTruthy());
      button(target, 'Punish').click(); await tick();
      (view as unknown as {showPeer(peer: string): void}).showPeer('member-ana'); await tick();
      expect(target.querySelector('dialog')?.open).toBe(false);
      expect((await client.contacts()).some(c => c.blockedByMe)).toBe(false);
    } finally { await unmount(view); target.remove(); await client.disconnect(); }
  });
});

describe('public record privacy', () => {
  it.each([null, {status: 'withheld'}] as (PublicRecord | null)[])('withholds every figure until cmsg supplies a current quorum record: %j', async record => {
    const target = document.createElement('div');
    const view = mount(PublicCard, {target, props: {card: {memberId: 'sample', handle: 'sample-handle', values: {}, online: true, record}}});
    try {
      await tick(); expect(target.querySelector('dl')).toBeNull();
      expect(target.textContent).not.toContain('%');
      expect(target.textContent).toContain('enough responses and a current record check');
    } finally { await unmount(view); }
  });
});
