import { describe, expect, it } from 'vitest';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';

const join = { voucher: 'VOUCHER-TEST-123', handle: 'fixture-member' };
const values = { age: 34, neighbourhood: 'North', weekend: 'Reading', location: { latitude: 47.3769, longitude: 8.5417 } };

describe('provisional presentation port', () => {
  it('resumes only an actionable gate and keeps waiting admission closed', async () => {
    const c = createDevCmsg({ gateState: 'action-needed' });
    await c.joinWithVoucher(join);
    await c.publishProfile(values);
    expect((await c.lobby()).admitted).toBe(false);
    await expect(c.completeGate('voucher', 'incorrect')).rejects.toThrow('not accepted');
    expect((await c.completeGate('voucher', join.voucher)).admitted).toBe(true);
    await expect(c.completeGate('voucher', join.voucher)).rejects.toThrow('not waiting');
    const waiting = createDevCmsg({ gateState: 'waiting' });
    await waiting.joinWithVoucher(join);
    await waiting.publishProfile(values);
    expect((await waiting.lobby()).gates[0]?.action).toBeUndefined();
    expect((await waiting.lobby()).admitted).toBe(false);
  });

  it('filters real distances and pages without returning private values', async () => {
    const c = createDevCmsg({ pageSize: 1 });
    await c.joinWithVoucher(join); await c.publishProfile(values);
    const first = await c.discover([{ field: 'location', maxDistanceKm: 5 }]);
    const second = await c.discover([{ field: 'location', maxDistanceKm: 5 }], first.cursor);
    expect(first.entries.map(x => x.memberId)).toEqual(['member-ana']);
    expect(second.entries.map(x => x.memberId)).toEqual(['member-tom']);
    expect(second.cursor).toBeNull();
    const exchange = await c.requestPrivateKey('member-ana');
    expect(exchange.profile?.values.age).toBe(34);
    exchange.profile!.values.age = 99;
    expect((await c.profileExchanges()).at(-1)?.result.profile?.values.age).toBe(34);
    expect((await c.discover([])).entries[0]?.values.about).toBeUndefined();
  });

  it('keeps reserved introductions distinct from release and cancels delivery on disconnect', async () => {
    const c = createDevCmsg({ incomingReleaseState: 'reserved', releaseDelayMs: 10 });
    const [incoming] = await c.incomingWaves();
    expect(incoming?.message).toBe('');
    await expect(c.answerWave(incoming!.id, 'Hello')).rejects.toThrow('not released');
    await expect(c.closeWave(incoming!.id)).rejects.toThrow('not released');
    await expect(c.punishWave(incoming!.id)).rejects.toThrow('not released');
    const seen: string[] = [];
    c.subscribe(e => { if (e.type === 'wave-updated') seen.push(e.wave.releaseState!); });
    expect((await c.sendWave('member-ana', 'Hello')).releaseState).toBe('reserved');
    await c.disconnect();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(seen).toEqual([]);
  });

  it('does not equate stored delivery or unblocking with an answered conversation', async () => {
    const c = createDevCmsg({ messageState: 'stored' });
    const [incoming] = await c.incomingWaves();
    await c.answerWave(incoming!.id, 'Hello');
    expect((await c.sendMessage('member-tom', 'Another')).state).toBe('stored');
    await c.closeConversation('member-tom');
    await expect(c.sendMessage('member-tom', 'No')).rejects.toThrow('not open');
    await c.requestReopen('member-tom');
    expect((await c.thread('member-tom')).state).toBe('reopen-pending');
    await c.punishConversation('member-tom');
    await c.unblockMember('member-tom');
    expect((await c.thread('member-tom')).state).toBe('closed');
    expect((await c.thread('member-tom')).established).toBe(false);
  });

  it('keeps the original group through a proposed and then consented opening fork', async () => {
    const c = createDevCmsg();
    await expect(c.joinGroup('group-market')).rejects.toThrow('consent');
    const before = await c.groups();
    const proposal = await c.proposeFork({ groupId: 'group-garden', kind: 'open', label: 'Open garden', detail: 'Join if you wish', memberIds: ['member-ana'] });
    expect((await c.groups()).length).toBe(before.length);
    const next = await c.consentFork(proposal.id, proposal.forks![0]!.id);
    expect(next.level).toBe('opening');
    expect(next.opening?.deadlineLabel).toContain('21 days');
    expect((await c.groups()).find(g => g.id === proposal.id)?.joined).toBe(true);
    await c.consentFork(proposal.id, proposal.forks![0]!.id);
    expect((await c.groups()).length).toBe(before.length + 1);
  });

  it('requires a separate approval for a pending device and surfaces irrecoverable loss', async () => {
    const c = createDevCmsg({ restoreState: 'unrecoverable' });
    const pending = await c.addDevice('Tablet');
    expect((await c.devices()).find(d => d.id === pending.id)?.state).toBe('pending');
    await c.renameDevice(pending.id, 'Spare tablet');
    const approved = await c.approveDevice(pending.id);
    expect(approved.state).toBe('active');
    approved.name = 'Outside mutation';
    expect((await c.devices()).find(d => d.id === pending.id)?.name).toBe('Spare tablet');
    await expect(c.removeDevice('device-1')).rejects.toThrow('another device');
    expect((await c.restoreVault()).state).toBe('unrecoverable');
    expect((await c.restoreVault()).message).toContain('no operator recovery');
  });

  it('requires portal sign-in and distinguishes scoped inherit, empty and value', async () => {
    const c = createDevCmsg();
    await expect(c.adminSchema()).rejects.toThrow('Sign in');
    await expect(c.rootCommunities()).rejects.toThrow('Sign in');
    await c.signInRole('root');
    const id = (await c.rootCommunities())[0]!.communityId;
    const setting = (await c.rootSetSetting(id, 'postingPace', 'empty')).settings[0]!;
    expect(setting).toMatchObject({ inherited: false, overrideValue: null, effectiveValue: '' });
    expect((await c.rootSetSetting(id, 'postingPace', 'value', 'daily')).settings[0]?.effectiveValue).toBe('daily');
    expect((await c.rootSetSetting(id, 'postingPace', 'inherit')).settings[0]?.effectiveValue).toBe('slow');
    expect((await c.rootCommunity('evening-choir')).settings[0]?.effectiveValue).toBe('weekly');
    await expect(c.rootSetSetting(id, 'joining', 'empty')).rejects.toThrow('platform');
    await c.rootSetAdmin(id, 'fixture-admin', true);
    expect((await c.rootCommunity(id)).admins.some(a => a.id === 'fixture-admin')).toBe(true);
    await c.signInRole('admin');
    await expect(c.rootCommunities()).rejects.toThrow('Sign in');
    const schema = await c.adminSchema();
    await c.adminSaveSchema(schema);
    await expect(c.adminSaveSchema(schema)).rejects.toThrow('schema changed');
  });

  it('returns deliberate fixture failures through the same API', async () => {
    const c = createDevCmsg({ failActions: ['renameDevice', 'completeGate', 'signInRole'] });
    await expect(c.renameDevice('device-1', 'Phone')).rejects.toThrow('Fixture failure');
    await expect(c.completeGate('voucher', join.voucher)).rejects.toThrow('Fixture failure');
    await expect(c.signInRole('root')).rejects.toThrow('Fixture failure');
  });
});
