import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import Lobby from '../../src/views/Lobby.svelte';
import Settings from '../../src/views/Settings.svelte';
import ProfileEditor from '../../src/views/ProfileEditor.svelte';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type { CmsgClient, HandlePolicy } from '../../../../core/src/cmsg.js';

const JOIN = { voucher: 'VOUCHER-TEST-123', handle: 'handle-member' };
const states: HandlePolicy['state'][] = ['settling-in', 'locked', 'token', 'required', 'placeholder'];

function render(component: typeof Settings | typeof Lobby | typeof ProfileEditor, client: CmsgClient) {
  const target = document.createElement('div');
  document.body.append(target);
  const view = mount(component as typeof Settings, { target, props: { client } });
  return { target, cleanup: () => { void unmount(view); target.remove(); } };
}
function type(target: HTMLElement, id: string, value: string) {
  const input = target.querySelector(`#${id}`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
const press = (target: HTMLElement, name: string) =>
  [...target.querySelectorAll('button')].find((b) => b.textContent?.includes(name))!;

describe('handle policy in the development adapter', () => {
  it('describes every state and only offers changes where cmsg allows them', async () => {
    const seen: Record<string, HandlePolicy> = {};
    for (const state of states) {
      const client = createDevCmsg({ handlePolicy: state });
      await expect(client.handlePolicy()).rejects.toThrow('Join');
      await client.joinWithVoucher(JOIN);
      seen[state] = await client.handlePolicy();
      expect(seen[state]!.state).toBe(state);
      expect(seen[state]!.reservedNote).toContain('two years');
    }
    expect(seen['settling-in']!.canChange).toBe(true);
    expect(seen['token']!.canChange).toBe(true);
    expect(seen['required']!.reason).toContain('community');
    expect(seen['required']!.deadlineLabel).toContain('7 days');
    expect(seen['locked']!.canChange).toBe(false);
    expect(seen['placeholder']!.canChange).toBe(false);
    expect(seen['placeholder']!.summary).toContain('placeholder');
  });

  it('validates a change, reserves the released handle and consumes one-time permissions', async () => {
    const client = createDevCmsg();
    await expect(client.changeHandle('anything-long')).rejects.toThrow('Join');
    await client.joinWithVoucher(JOIN);
    const spy = vi.fn();
    client.subscribe(spy);
    await expect(client.changeHandle('short')).rejects.toThrow('8 to 32');
    await expect(client.changeHandle(JOIN.handle)).rejects.toThrow('different');
    await expect(client.changeHandle('ana-walks')).rejects.toThrow('not available');
    const policy = await client.changeHandle(' second-handle ');
    expect(policy.state).toBe('settling-in');
    expect((await client.lobby()).handle).toBe('second-handle');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'lobby' }));
    await expect(client.changeHandle(JOIN.handle)).rejects.toThrow('not available');

    const token = createDevCmsg({ handlePolicy: 'token' });
    await token.joinWithVoucher(JOIN);
    expect((await token.changeHandle('token-handle')).state).toBe('locked');
    await expect(token.changeHandle('another-handle')).rejects.toThrow('not available right now');

    const locked = createDevCmsg({ handlePolicy: 'locked' });
    await locked.joinWithVoucher(JOIN);
    await expect(locked.changeHandle('locked-handle')).rejects.toThrow('not available right now');
  });

  it('lets the member answer a required change and never picks the name for them', async () => {
    const client = createDevCmsg({ handlePolicy: 'required', displayName: 'Anna Berg' });
    await client.joinWithVoucher(JOIN);
    expect((await client.lobby()).handleChange?.reason).toContain('community');
    expect((await client.lobby()).displayName).toBe('Anna Berg');
    expect((await client.changeHandle('chosen-by-me')).state).toBe('locked');
    expect((await client.lobby()).handleChange).toBeUndefined();

    const admin = createDevCmsg();
    await admin.joinWithVoucher(JOIN);
    await admin.signInRole('admin');
    await admin.requireHandleChange('me', 'Please choose another handle.');
    expect((await admin.handlePolicy()).state).toBe('required');
    expect((await admin.lobby()).handle).toBe(JOIN.handle);
  });

  it.each(['handlePolicy', 'changeHandle'])('keeps the %s failure boundary', async (action) => {
    const client = createDevCmsg({ failActions: [action] });
    await client.joinWithVoucher(JOIN);
    await expect(action === 'handlePolicy' ? client.handlePolicy() : client.changeHandle('failing-handle')).rejects.toThrow('Fixture failure');
  });
});

describe('handle presentation', () => {
  it('changes the handle from settings with busy, success and refusal states', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const { target, cleanup } = render(Settings, client);
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('first 7 days'));
      type(target, 'new-handle', 'short');
      press(target, 'Change handle').click();
      await vi.waitFor(() => expect(target.querySelector('[role="alert"]')?.textContent).toContain('8 to 32'));
      type(target, 'new-handle', 'brand-new-handle');
      press(target, 'Change handle').click();
      await vi.waitFor(() => expect(target.textContent).toContain('Your handle was changed.'));
      expect((await client.lobby()).handle).toBe('brand-new-handle');
    } finally { cleanup(); }
  });

  it('shows a required change privately with the deadline and no admin-picked name', async () => {
    const client = createDevCmsg({ handlePolicy: 'required' });
    await client.joinWithVoucher(JOIN);
    const { target, cleanup } = render(Settings, client);
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('only you can see this'));
      expect(target.textContent).toContain('Within 7 days');
      expect(target.textContent).toContain('never picks a name for you');
    } finally { cleanup(); }
  });

  it('explains locked handles without a form and retries a failed load', async () => {
    const locked = createDevCmsg({ handlePolicy: 'locked' });
    await locked.joinWithVoucher(JOIN);
    const first = render(Settings, locked);
    try {
      await vi.waitFor(() => expect(first.target.textContent).toContain('cannot change your handle'));
      expect(first.target.querySelector('#new-handle')).toBeNull();
    } finally { first.cleanup(); }

    const empty = createDevCmsg();
    const second = render(Settings, empty);
    try {
      await vi.waitFor(() => expect(second.target.textContent).toContain('could not be loaded'));
      await empty.joinWithVoucher(JOIN);
      press(second.target, 'Try again').click();
      await vi.waitFor(() => expect(second.target.textContent).toContain('first 7 days'));
    } finally { second.cleanup(); }
  });

  it('ignores answers that arrive after the view is gone', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    let release: () => void = () => {};
    const slow = Object.assign(Object.create(client), {
      changeHandle: (next: string) => new Promise((resolve) => { release = () => resolve(client.changeHandle(next)); }),
    }) as CmsgClient;
    const { target, cleanup } = render(Settings, slow);
    await vi.waitFor(() => expect(target.textContent).toContain('first 7 days'));
    type(target, 'new-handle', 'late-handle-name');
    press(target, 'Change handle').click();
    await tick();
    cleanup();
    release();
    await tick();
    const failing = Object.assign(Object.create(client), {
      handlePolicy: () => Promise.reject(new Error('gone')),
    }) as CmsgClient;
    const second = render(Settings, failing);
    second.cleanup();
    await tick();
  });

  it('keeps the lobby notice and the display name beside the handle', async () => {
    const client = createDevCmsg({ handlePolicy: 'required', displayName: 'Anna Berg' });
    await client.joinWithVoucher(JOIN);
    const { target, cleanup } = render(Lobby, client);
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('Anna Berg · @handle-member'));
      expect(target.textContent).toContain('Please choose a new handle');
      expect(target.querySelector('a[href="#/settings"]')).not.toBeNull();
    } finally { cleanup(); }
  });

  it('labels a name field so members know it is shown with the handle', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const schema = await client.schema();
    const named = { ...schema, fields: schema.fields.map((field, index) => (index === 0 ? { ...field, shownAsName: true } : field)) };
    const wrapped = Object.assign(Object.create(client), { schema: async () => named }) as CmsgClient;
    const { target, cleanup } = render(ProfileEditor, wrapped);
    try {
      await vi.waitFor(() => expect(target.textContent).toContain('Shown next to your handle'));
    } finally { cleanup(); }
  });
});
