import {describe, it, expect, vi} from 'vitest';
import {mount, tick, unmount} from 'svelte';
import {createDevCmsg} from '../../../../core/src/dev-adapter.js';
import Admin from '../../src/views/Admin.svelte';
import AdminRoles from '../../src/views/AdminRoles.svelte';
import AdminBoard from '../../src/views/AdminBoard.svelte';
import {routeForLocation, routeHref, parseHash} from '../../src/session.svelte.js';
import type {CmsgClient} from '../../../../core/src/cmsg.js';
const button = (target: HTMLElement, name: string) => [...target.querySelectorAll('button')].find(b => b.textContent?.trim() === name)!;
const join = (client: CmsgClient) => client.joinWithVoucher({voucher:'VOUCHER-TEST-123',handle:'fixture-member'});

describe('admin capabilities and isolation', () => {
  it('refuses ordinary members and cross-community admin actions', async () => {
    const member = createDevCmsg({role:'member'});
    await expect(member.signInRole('admin')).rejects.toThrow('role');
    await expect(member.adminAccess()).rejects.toThrow('Sign in');
    const admin = createDevCmsg({role:'admin'});
    await expect(admin.signInRole('root')).rejects.toThrow('role');
    await admin.signInRole('admin');
    await expect(admin.adminAccess('other')).rejects.toThrow('another community');
    expect((await admin.adminAccess()).assignableRoles).toEqual(['member','admin']);
    await expect(admin.adminSetRole('someone','root')).rejects.toThrow('Only roots');
    await expect(admin.adminSetRole('role-root','member')).rejects.toThrow('Only roots');
    await expect(admin.adminSetRole(' ','admin')).rejects.toThrow('Choose');
    const assigned = await admin.adminSetRole('someone','admin');
    expect(assigned.members.find(m=>m.id==='someone')?.role).toBe('admin');
    const removed = await admin.adminSetRole('someone','member');
    expect(removed.members.find(m=>m.id==='someone')?.role).toBe('member');
    assigned.members.length=0;
    expect((await admin.adminAccess()).members.length).toBeGreaterThan(0);
    await admin.disconnect();
    await expect(admin.adminAccess()).rejects.toThrow('Sign in');
  });
  it('allows roots to appoint and remove roots in selected communities', async () => {
    const client = createDevCmsg(); await client.signInRole('root');
    expect((await client.adminAccess('other')).assignableRoles).toContain('root');
    expect((await client.adminSetRole('new-root','root','other')).members.find(m=>m.id==='new-root')?.role).toBe('root');
    expect((await client.adminSetRole('new-root','member','other')).members.find(m=>m.id==='new-root')?.role).toBe('member');
    expect((await client.adminAccess()).members.some(m=>m.id==='new-root')).toBe(false);
  });
  it('requires a reason and leaves the replacement name to the member', async () => {
    const client = createDevCmsg(); await join(client); await client.signInRole('admin');
    await expect(client.requireHandleChange('','reason')).rejects.toThrow('Choose');
    await expect(client.requireHandleChange('me',' ')).rejects.toThrow('Choose');
    const spy = vi.fn(); client.subscribe(spy);
    const notice = await client.requireHandleChange('me','Please choose another handle.');
    expect(notice.deadlineLabel).toContain('7 days');
    expect((await client.lobby()).handle).toBe('fixture-member');
    expect((await client.lobby()).handleChange?.reason).toBe('Please choose another handle.');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({type:'lobby'}));
    const other = await client.requireHandleChange('someone','Different reason.');
    other.reason='altered';
    expect((await client.lobby()).handleChange?.reason).not.toBe('altered');
    const absent = createDevCmsg(); await absent.signInRole('admin');
    await expect(absent.requireHandleChange('me','reason')).rejects.toThrow('Join');
  });
  it('enters the root board as a distinct community through the ordinary lobby', async () => {
    const wrong = createDevCmsg();
    await expect(wrong.rootBoardAccess()).rejects.toThrow('root community');
    await expect(wrong.enterRootBoard()).rejects.toThrow('root community');
    for (const boardState of ['eligible','active','renewal-needed'] as const) {
      const client = createDevCmsg({communityScope:'root',boardState});
      expect((await client.rootBoardAccess()).state).toBe(boardState);
      const result = await client.enterRootBoard();
      expect(result.lobby.admitted).toBe(false);
      expect(result.lobby.handle).toBe('board-member');
      expect((await client.rootBoardAccess()).state).toBe('active');
      await expect(client.rootCommunities()).rejects.toThrow('root first');
      expect(JSON.stringify(await client.rootBoardAccess())).not.toMatch(/garden-neighbours|role|voucher/);
    }
    const unavailable = createDevCmsg({communityScope:'root',boardState:'unavailable'});
    expect((await unavailable.rootBoardAccess()).canEnter).toBe(false);
    await expect(unavailable.enterRootBoard()).rejects.toThrow('current admin credential');
    const defaults = createDevCmsg({communityScope:'root'});
    expect((await defaults.rootBoardAccess()).state).toBe('eligible');
  });
  it.each(['adminAccess','adminSetRole','requireHandleChange','rootBoardAccess','enterRootBoard'])('retains the %s failure boundary', async action => {
    const client = createDevCmsg({failActions:[action],communityScope:'root'}); await client.signInRole('root');
    const calls: Record<string,()=>Promise<unknown>> = {
      adminAccess:()=>client.adminAccess(), adminSetRole:()=>client.adminSetRole('person','admin'),
      requireHandleChange:()=>client.requireHandleChange('person','reason'), rootBoardAccess:()=>client.rootBoardAccess(), enterRootBoard:()=>client.enterRootBoard(),
    };
    await expect(calls[action]!()).rejects.toThrow('Fixture failure');
  });
});

describe('admin presentation', () => {
  it('keeps the gardens and board routes distinct', () => {
    expect(routeForLocation('', 'root.example')).toEqual({name:'admin-board'});
    expect(routeForLocation('#/forum', 'root.example')).toEqual({name:'forum'});
    expect(routeForLocation('#/root','admin.root.example')).toEqual({name:'root'});
    expect(routeForLocation('', 'admin.community.example')).toEqual({name:'admin'});
    expect(routeForLocation('#/admin/schema','admin.community.example')).toEqual({name:'admin-schema'});
    expect(routeForLocation('#/board','community.example')).toEqual({name:'arrival'});
    expect(routeForLocation('#/admin','community.example')).toEqual({name:'arrival'});
    expect(routeHref(parseHash('#/board'))).toBe('#/board');
    expect(routeHref(parseHash('#/admin'))).toBe('#/admin');
  });
  it('offers only projected roles, explains forced change and retains backend refusal', async () => {
    const client=createDevCmsg({role:'admin',failActions:['requireHandleChange']});
    const target=document.createElement('div'); document.body.append(target);
    const view=mount(Admin,{target,props:{client}});
    try {
      button(target,'Sign in as admin').click();
      await vi.waitFor(()=>expect(target.querySelector('#member-role')).not.toBeNull());
      expect([...target.querySelectorAll('option')].map(o=>o.value)).not.toContain('root');
      const member=target.querySelector('#role-member') as HTMLInputElement;
      member.value='someone';member.dispatchEvent(new Event('input',{bubbles:true}));
      const select=target.querySelector('#member-role') as HTMLSelectElement;
      select.value='admin';select.dispatchEvent(new Event('change',{bubbles:true}));await tick();
      button(target,'Set role').click();
      await vi.waitFor(()=>expect(target.textContent).toContain('Role updated.'));
      const reason=target.querySelector('#handle-reason') as HTMLTextAreaElement;
      reason.value='Please choose a new handle.';reason.dispatchEvent(new Event('input',{bubbles:true}));await tick();
      button(target,'Require handle change').click();
      await vi.waitFor(()=>expect(target.textContent).toContain('Fixture failure'));
      expect(target.textContent).toContain('You cannot choose a name for them');
    } finally {await unmount(view);target.remove();}
  });
  it('shows access failure without role controls and lets a board member enter the lobby',async()=>{
    const target=document.createElement('div');
    const denied=mount(AdminRoles,{target,props:{client:createDevCmsg()}});
    await vi.waitFor(()=>expect(target.textContent).toContain('Admin controls are unavailable'));
    expect(target.querySelector('select')).toBeNull();await unmount(denied);
    const client=createDevCmsg({communityScope:'root'});const onjoined=vi.fn();
    const board=mount(AdminBoard,{target,props:{client,onjoined}});
    try {
      await vi.waitFor(()=>expect(button(target,'Enter the board')).toBeTruthy());
      button(target,'Enter the board').click();
      await vi.waitFor(()=>expect(onjoined).toHaveBeenCalledTimes(1));
      expect(target.textContent).not.toContain('garden-neighbours');
    } finally {await unmount(board);}
  });
});
