import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Devices from '../../src/views/Devices.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';

function button(target: HTMLElement, label: string) { return [...target.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!; }
describe('device presentation', () => {
  it('requests pairing without approval and renames an existing device', async () => {
    const client = createDevCmsg();
    const target = document.createElement('div'); document.body.append(target);
    const view = mount(Devices, { target, props: { client } });
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('My phone'));
      const input = target.querySelector<HTMLInputElement>('#device-name')!;
      input.value = 'Tablet'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
      input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(target.textContent).toContain('Waiting for approval'));
      expect((await client.devices()).find(d => d.name === 'Tablet')?.state).toBe('pending');
      button(target, 'Rename').click(); await tick();
      const rename = target.querySelector<HTMLInputElement>('#rename-device-1')!;
      rename.value = 'Primary phone'; rename.dispatchEvent(new Event('input', { bubbles: true })); await tick();
      button(target, 'Save name').click();
      await vi.waitFor(() => expect(target.textContent).toContain('Primary phone'));
      expect((await client.devices())[0]?.name).toBe('Primary phone');
    } finally { await unmount(view); target.remove(); }
  });
  it.each(['ready', 'locked', 'unavailable', 'unrecoverable'] as const)('renders the %s recovery response', async state => {
    const client = createDevCmsg({ restoreState: state });
    const target = document.createElement('div');
    const view = mount(Devices, { target, props: { client } });
    try {
      await tick(); button(target, 'Restore from surviving copies').click();
      await vi.waitFor(() => expect(target.textContent).toContain('Recovery result'));
      expect(target.textContent).toContain((await client.restoreVault()).message);
    } finally { await unmount(view); target.remove(); }
  });
  it('keeps refused pairing visible without adding a device', async () => {
    const client = createDevCmsg({ failActions: ['addDevice'] });
    const target = document.createElement('div'); document.body.append(target); const view = mount(Devices, { target, props: { client } });
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('My phone')); button(target, 'Add a device').click();
      await vi.waitFor(() => expect(target.textContent).toContain('Fixture failure for addDevice'));
      expect(await client.devices()).toHaveLength(1);
    } finally { await unmount(view); }
  });
});
