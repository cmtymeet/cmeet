import { describe, expect, it } from 'vitest';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';

const JOIN = { voucher: 'VOUCHER-TEST-123', handle: 'test-member' };

describe('connection preload', () => {
  it('connects through bootstrap phases and reports ready', async () => {
    const client = createDevCmsg({ connectDelayMs: 20 });
    const seen: string[] = [];
    client.subscribe((event) => {
      if (event.type === 'connection') seen.push(event.status.phase);
    });
    const status = await client.connect();
    expect(status.phase).toBe('ready');
    expect(seen).toContain('bootstrapping');
    expect(seen).toContain('publishing');
  });

  it('reports failure when the network is unreachable', async () => {
    const client = createDevCmsg({ connectDelayMs: 10, failConnect: true });
    const status = await client.connect();
    expect(status.phase).toBe('failed');
  });
});

describe('arrival with a voucher', () => {
  it('rejects bad vouchers and short handles', async () => {
    const client = createDevCmsg();
    await expect(client.joinWithVoucher({ voucher: 'nope', handle: 'test-member' })).rejects.toThrow();
    await expect(
      client.joinWithVoucher({ voucher: 'VOUCHER-TEST-123', handle: 'short' }),
    ).rejects.toThrow();
  });

  it('joins the lobby and warns about no return', async () => {
    const client = createDevCmsg();
    const { lobby } = await client.joinWithVoucher(JOIN);
    expect(lobby.handle).toBe('test-member');
    expect(lobby.expiryWarning).toMatch(/cannot return/);
    expect(lobby.profileComplete).toBe(false);
  });
});

describe('schema-driven profiles', () => {
  it('validates typed values and publishes the profile', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const issues = await client.validateProfile({ age: 12, neighbourhood: 'Moon' });
    expect(issues.length).toBeGreaterThan(0);
    await client.publishProfile({ age: 34, neighbourhood: 'North', weekend: 'Hiking' });
    const lobby = await client.lobby();
    expect(lobby.profileComplete).toBe(true);
  });
});

describe('two-way forum discovery', () => {
  it('matches only when both rule sets pass', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await client.publishProfile({ age: 34, neighbourhood: 'North', weekend: 'Hiking' });
    // No own rules: ana (25-45), tom (North/East) match; rin wants Reading/Music weekends.
    const open = await client.discover([]);
    const handles = open.entries.map((e) => e.handle);
    expect(handles).toContain('ana-walks');
    expect(handles).toContain('tom-cooks');
    expect(handles).not.toContain('rin-reads');
    // A one-sided filter on real values still applies on top.
    const filtered = await client.discover([{ field: 'neighbourhood', equals: ['East'] }]);
    expect(filtered.entries.map((e) => e.handle)).toEqual(['tom-cooks']);
    // Offline members never appear.
    expect(handles).not.toContain('jo-runs');
  });

  it('blocks hide the member from discovery', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await client.publishProfile({ age: 34, neighbourhood: 'North', weekend: 'Hiking' });
    await client.blockMember('member-tom');
    const page = await client.discover([]);
    expect(page.entries.map((e) => e.handle)).not.toContain('tom-cooks');
  });

  it('releases keys automatically by rules; the requester learns only the field', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await client.publishProfile({ age: 34, neighbourhood: 'North', weekend: 'Reading' });
    const accepted = await client.requestPrivateKey('member-ana');
    expect(accepted.status).toBe('accepted');
    // Rin's weekend rule excludes our Hiking profile.
    await client.publishProfile({ age: 34, neighbourhood: 'North', weekend: 'Hiking' });
    const rejected = await client.requestPrivateKey('member-rin');
    expect(rejected.status).toBe('rejected');
    expect(rejected.failingField).toBe('weekend');
    expect(rejected.reason).toBeUndefined();
  });
});

describe('waves as first contact', () => {
  it('answer returns both slots and opens an established thread', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const before = await client.waveSlots();
    const [incoming] = await client.incomingWaves();
    const done = await client.answerWave(incoming!.id, 'Hello back!');
    expect(done.state).toBe('answered');
    expect(done.senderSlotHeld).toBe(false);
    expect(done.recipientSlotHeld).toBe(false);
    const after = await client.waveSlots();
    expect(after.introductionsAvailable).toBeGreaterThanOrEqual(before.introductionsAvailable);
    const thread = await client.thread('member-tom');
    expect(thread.established).toBe(true);
    expect(thread.messages.length).toBe(2);
  });

  it('close returns the recipient slot at once and the sender slot after waiting', async () => {
    const client = createDevCmsg({ waveWaitMs: 20 });
    await client.joinWithVoucher(JOIN);
    const [incoming] = await client.incomingWaves();
    const closed = await client.closeWave(incoming!.id);
    expect(closed.state).toBe('closed');
    expect(closed.recipientSlotHeld).toBe(false);
    expect(closed.senderSlotHeld).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const [updated] = await client.incomingWaves();
    expect(updated!.senderSlotHeld).toBe(false);
  });

  it('punish burns both slots and blocks the sender', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await client.publishProfile({ age: 34, neighbourhood: 'North', weekend: 'Hiking' });
    const [incoming] = await client.incomingWaves();
    const punished = await client.punishWave(incoming!.id);
    expect(punished.state).toBe('punished');
    expect(punished.senderSlotHeld).toBe(false);
    expect(punished.recipientSlotHeld).toBe(false);
    const contacts = await client.contacts();
    expect(contacts.find((c) => c.memberId === 'member-tom')?.blockedByMe).toBe(true);
    const page = await client.discover([]);
    expect(page.entries.map((e) => e.handle)).not.toContain('tom-cooks');
  });
});

describe('groups by size', () => {
  it('shows level and what changes next, and joins rooms with consent state', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const groups = await client.groups();
    const circle = groups.find((g) => g.id === 'group-garden')!;
    expect(circle.level).toBe('circle');
    expect(circle.whatChangesNext).toMatch(/13/);
    const room = groups.find((g) => g.id === 'group-market')!;
    expect(room.level).toBe('room');
    expect(room.joinConsent).toMatch(/consent/);
    const joined = await client.joinGroup(room.id, true);
    expect(joined.joined).toBe(true);
    expect(joined.size).toBe(68);
    await client.sendGroupMessage(room.id, 'See you Saturday!');
    const [updated] = (await client.groups()).filter((g) => g.id === room.id);
    expect(updated!.messages.length).toBe(1);
    const fork = await client.proposeFork({ groupId: room.id, kind: 'exit', label: 'Exit', detail: '' });
    expect(fork.id).toBe(room.id);
    expect(fork.forks?.[0]?.consented).toBe(false);
    const moved = await client.consentFork(room.id, fork.forks![0]!.id);
    expect(moved.id).not.toBe(room.id);
    expect((await client.groups()).find(group => group.id === room.id)?.joined).toBe(true);
  });
});

describe('devices', () => {
  it('adds with approval and removes without touching this device', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const pending = await client.addDevice('Spare phone');
    await client.approveDevice(pending.id);
    let devices = await client.devices();
    expect(devices.map((d) => d.name)).toContain('Spare phone');
    await client.removeDevice(pending.id);
    devices = await client.devices();
    expect(devices.map((d) => d.name)).not.toContain('Spare phone');
    expect(devices.some((d) => d.thisDevice)).toBe(true);
  });
});

describe('admin and root', () => {
  it('saves the schema and reports impact', async () => {
    const client = createDevCmsg();
    await client.signInRole('admin');
    const schema = await client.adminSchema();
    const impact = await client.adminSaveSchema({ ...schema, fields: [...schema.fields].reverse() });
    expect(impact.profilesNeedingChanges).toBeGreaterThanOrEqual(0);
    expect(impact.note).toMatch(/at once/);
  });

  it('lists communities for root', async () => {
    const client = createDevCmsg();
    await client.signInRole('root');
    const communities = await client.rootCommunities();
    expect(communities.length).toBeGreaterThan(0);
  });
});
