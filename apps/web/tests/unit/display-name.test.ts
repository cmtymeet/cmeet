import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { memberName, PublicCard, ProfilePreview, WaveCard } from '../../../../ui/src/index.js';
import AdminSchema from '../../src/views/AdminSchema.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { ProfileSchema } from '../../../../core/src/cmsg.js';

describe('community display names', () => {
  it('keeps the handle for disabled or empty names and pairs enabled names', () => {
    expect(memberName('garden_friend')).toBe('garden_friend');
    expect(memberName('garden_friend', '')).toBe('garden_friend');
    expect(memberName('garden_friend', '  ')).toBe('garden_friend');
    expect(memberName('garden_friend', 'Garden Friend')).toBe('Garden Friend · @garden_friend');
  });

  it('distinguishes equal display names and never renders reserved public records', async () => {
    const target = document.createElement('div');
    const views = ['first-member', 'second-member'].map(handle => mount(PublicCard, { target, props: {
      card: { memberId: handle, handle, displayName: 'Garden Friend', online: true,
        values: { location: { latitude: 47, longitude: 8 } }, record: { accepted: 1, declined: 0, punished: 0 } },
    } }));
    try {
      await tick();
      expect([...target.querySelectorAll('h3')].map(node => node.textContent)).toEqual([
        'Garden Friend · @first-member', 'Garden Friend · @second-member',
      ]);
      expect(target.textContent).not.toMatch(/Welcomed|100%|\[object Object\]/);
      expect(target.textContent).toContain('47, 8');
    } finally { for (const view of views) await unmount(view); }
  });

  it('uses only a public flagged field for preview identity', async () => {
    const schema: ProfileSchema = { version: 1, fields: [
      { key: 'location', question: 'Meeting place', kind: 'location', visibility: 'public', required: false, filterable: false },
      { key: 'secret', question: 'Private name', kind: 'short-text', visibility: 'private', shownAsName: true, required: false, filterable: false },
      { key: 'name', question: 'Display name', kind: 'short-text', visibility: 'public', shownAsName: true, required: false, filterable: false },
    ] };
    const target = document.createElement('div');
    const view = mount(ProfilePreview, { target, props: { schema, handle: 'garden_friend', values: { secret: 'WITHHELD', name: 'Garden Friend', location: { latitude: 47, longitude: 8 } } } });
    try {
      await tick();
      expect(target.querySelector('.identity')?.textContent).toBe('Garden Friend · @garden_friend');
      expect(target.textContent).not.toContain('WITHHELD');
      expect(target.textContent).toContain('47, 8');
    } finally { await unmount(view); }
    const privateOnly = mount(ProfilePreview, { target, props: { schema: { ...schema, fields: [schema.fields[1]!] }, handle: 'garden_friend', values: { secret: 'WITHHELD' } } });
    try {
      await tick();
      expect(target.querySelector('.identity')?.textContent).toBe('garden_friend');
    } finally { await unmount(privateOnly); }
  });

  it('pairs incoming-wave names with the sender handle', async () => {
    const client = createDevCmsg();
    const wave = (await client.incomingWaves())[0]!;
    const target = document.createElement('div');
    const view = mount(WaveCard, { target, props: { wave: { ...wave, fromDisplayName: 'Garden Friend' } } });
    try {
      await tick();
      expect(target.querySelector('h3')?.textContent).toContain(`Garden Friend · @${wave.fromHandle}`);
    } finally { await unmount(view); await client.disconnect(); }
  });

  it('saves the public name flag through the schema port and clears it for private fields', async () => {
    const client = createDevCmsg();
    const target = document.createElement('div'); document.body.appendChild(target);
    const view = mount(AdminSchema, { target, props: { client } });
    const button = (name: string) => [...target.querySelectorAll('button')].find(node => node.textContent?.trim() === name)!;
    const change = async (id: string, value: string) => {
      const select = target.querySelector(id) as HTMLSelectElement;
      select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    };
    try {
      button('Sign in as admin').click();
      await vi.waitFor(() => expect(target.querySelector('#vis-age')).not.toBeNull());
      button('Add question').click(); await tick();
      await change('#vis-draft-1', 'public');
      const flag = target.querySelector('#name-draft-1') as HTMLInputElement;
      expect(flag.checked).toBe(false); flag.click(); await tick();
      button('Save schema').click();
      await vi.waitFor(async () => expect((await client.adminSchema()).fields.find(field => field.key === 'draft-1')?.shownAsName).toBe(true));
      await vi.waitFor(() => expect(button('Save schema').disabled).toBe(false));
      await change('#vis-draft-1', 'private');
      expect(target.querySelector('#name-draft-1')).toBeNull();
      button('Save schema').click();
      await vi.waitFor(async () => expect((await client.adminSchema()).fields.find(field => field.key === 'draft-1')?.shownAsName).toBe(false));
    } finally { await unmount(view); target.remove(); }
  });
});
