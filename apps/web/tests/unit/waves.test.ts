import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Waves from '../../src/views/Waves.svelte';
import WaveCard from '../../../../ui/src/components/WaveCard.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';

describe('released introductions', () => {
  it('never renders reserved content even if a malformed fixture includes it', async () => {
    const client = createDevCmsg({ incomingReleaseState: 'reserved' });
    const wave = (await client.incomingWaves())[0]!;
    const target = document.createElement('div');
    const view = mount(WaveCard, { target, props: { wave: { ...wave, message: 'WITHHELD CONTENT' } } });
    await tick();
    expect(target.textContent).not.toContain('WITHHELD CONTENT');
    expect([...target.querySelectorAll('button')].every(b => b.disabled)).toBe(true);
    await unmount(view);
  });
  it.each(['answer', 'close'] as const)('shows the %s result from cmsg', async kind => {
    const client = createDevCmsg();
    const target = document.createElement('div'); const view = mount(Waves, { target, props: { client } });
    try {
      await vi.waitFor(() => expect(target.querySelector('textarea')).not.toBeNull());
      if (kind === 'answer') {
        const input = target.querySelector('textarea')!; input.value = 'Hello'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
      }
      [...target.querySelectorAll('button')].find(b => b.textContent === (kind === 'answer' ? 'Answer' : 'Respectfully close'))!.click();
      await vi.waitFor(() => expect(target.textContent).toContain(`Status: ${kind === 'answer' ? 'answered' : 'closed'}`));
      expect((await client.incomingWaves())[0]?.reason).toBeTruthy();
    } finally { await client.disconnect(); await unmount(view); }
  });
  it('keeps the reply when answering is refused', async () => {
    const client = createDevCmsg({ failActions: ['answerWave'] });
    const target = document.createElement('div'); const view = mount(Waves, { target, props: { client } });
    try {
      await vi.waitFor(() => expect(target.querySelector('textarea')).not.toBeNull());
      const input = target.querySelector('textarea')!; input.value = 'Keep this reply'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
      [...target.querySelectorAll('button')].find(b => b.textContent === 'Answer')!.click();
      await vi.waitFor(() => expect(target.textContent).toContain('Fixture failure for answerWave'));
      expect(input.value).toBe('Keep this reply');
      expect((await client.incomingWaves())[0]?.state).toBe('pending');
    } finally { await unmount(view); }
  });
});


describe('introduction lifecycle and MVP controls', () => {
  it('recovers from a failed load and clears the error', async () => {
    const base = createDevCmsg();
    let attempts = 0;
    const client = { ...base, incomingWaves: async () => {
      if (++attempts === 1) throw new Error('Temporarily unavailable');
      return base.incomingWaves();
    } };
    const target = document.createElement('div');
    const view = mount(Waves, { target, props: { client } });
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('Temporarily unavailable'));
      expect(target.textContent).not.toContain('No waves waiting');
      [...target.querySelectorAll('button')].find(b => b.textContent === 'Check again')!.click();
      await vi.waitFor(() => expect(target.querySelector('textarea')).not.toBeNull());
      expect(target.querySelector('[role="alert"]')).toBeNull();
      expect(target.textContent).toContain('Punish');
    } finally { await unmount(view); await base.disconnect(); }
  });
  it('locks the reply and makes no follow-up read after teardown during an answer', async () => {
    const base = createDevCmsg();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const incomingWaves = vi.fn(() => base.incomingWaves());
    const client = { ...base, incomingWaves, answerWave: async (id: string, message: string) => {
      await gate;
      return base.answerWave(id, message);
    } };
    const target = document.createElement('div');
    const view = mount(Waves, { target, props: { client } });
    await vi.waitFor(() => expect(target.querySelector('textarea')).not.toBeNull());
    const input = target.querySelector('textarea')!;
    input.value = 'Hello'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    [...target.querySelectorAll('button')].find(b => b.textContent === 'Answer')!.click();
    await tick();
    expect(input.matches(':disabled')).toBe(true);
    await unmount(view);
    incomingWaves.mockClear();
    release();
    await vi.waitFor(async () => expect((await base.incomingWaves())[0]?.state).toBe('answered'));
    expect(incomingWaves).not.toHaveBeenCalled();
    await base.disconnect();
  });
});
