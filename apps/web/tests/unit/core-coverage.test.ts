import { describe, expect, it } from 'vitest';
import { createDevCmsg } from '../../../../core/src/dev-adapter.js';
import type {
  CmsgClient,
  CmsgEvent,
  GroupView,
  MatchRule,
  ProfileValues,
} from '../../../../core/src/cmsg.js';

const JOIN = { voucher: 'VOUCHER-TEST-123', handle: 'test-member' };
const PROFILE: ProfileValues = { age: 34, neighbourhood: 'North', weekend: 'Reading' };
const ZURICH_PROFILE: ProfileValues = {
  age: 34,
  neighbourhood: 'North',
  weekend: 'Reading',
  location: { latitude: 47.3769, longitude: 8.5417 },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function joined(client: CmsgClient): Promise<CmsgClient> {
  await client.joinWithVoucher(JOIN);
  return client;
}

async function admitted(client: CmsgClient, values: ProfileValues = PROFILE): Promise<CmsgClient> {
  await client.joinWithVoucher(JOIN);
  await client.publishProfile(values);
  return client;
}

function collect(client: CmsgClient) {
  const events: CmsgEvent[] = [];
  const release = client.subscribe((event) => {
    events.push(event);
  });
  return { events, release };
}

/* ------------------------------------------------------------------ */
/* Connection lifecycle                                                */
/* ------------------------------------------------------------------ */

describe('core coverage: connection lifecycle', () => {
  it('reports the starting status before connecting', async () => {
    const client = createDevCmsg();
    const status = await client.connectionStatus();
    expect(status).toMatchObject({ phase: 'starting', progress: 0, backend: 'tor' });
    status.message = 'mutated';
    expect((await client.connectionStatus()).message).not.toBe('mutated');
  });

  it('connects through bootstrap phases and reports ready', async () => {
    const client = createDevCmsg({ connectDelayMs: 20 });
    const { events } = collect(client);
    const status = await client.connect();
    expect(status).toMatchObject({ phase: 'ready', progress: 1, backend: 'tor' });
    const phases = events.filter((e) => e.type === 'connection').map((e) => e.type === 'connection' ? e.status.phase : '');
    expect(phases).toEqual(['bootstrapping', 'publishing', 'ready']);
  });

  it('reports failure when the fixture network is unreachable', async () => {
    const client = createDevCmsg({ connectDelayMs: 10, failConnect: true });
    const { events } = collect(client);
    const status = await client.connect();
    expect(status.phase).toBe('failed');
    expect(events.at(-1)).toMatchObject({ type: 'connection' });
  });

  it('drops a stale first attempt when a second connect starts early', async () => {
    const client = createDevCmsg({ connectDelayMs: 60 });
    const first = client.connect();
    await sleep(10);
    const second = client.connect();
    const [early, late] = await Promise.all([first, second]);
    expect(late.phase).toBe('ready');
    expect(early.phase).not.toBe('ready');
    expect((await client.connectionStatus()).phase).toBe('ready');
  });

  it('drops a stale first attempt after publishing when a second connect starts late', async () => {
    const client = createDevCmsg({ connectDelayMs: 60 });
    const first = client.connect();
    await sleep(40);
    const second = client.connect();
    const [early, late] = await Promise.all([first, second]);
    expect(late.phase).toBe('ready');
    expect(early.phase).not.toBe('ready');
    expect((await client.connectionStatus()).phase).toBe('ready');
  });

  it('disconnect resets the connection, clears subscriptions, roles and timers', async () => {
    const client = createDevCmsg({ releaseDelayMs: 20, waveWaitMs: 20 });
    await client.signInRole('admin');
    const seen: string[] = [];
    client.subscribe((event) => {
      seen.push(event.type);
    });
    await client.joinWithVoucher(JOIN);
    await client.sendWave('member-ana', 'Hello');
    await client.disconnect();
    expect(seen).toContain('connection');
    const count = seen.length;
    await sleep(60);
    expect(seen.length).toBe(count);
    await expect(client.adminSchema()).rejects.toThrow('Sign in');
    expect((await client.connectionStatus()).phase).toBe('starting');
  });
});

describe('core coverage: subscribe and event isolation', () => {
  it('fans out to every subscriber and stops after unsubscribe', async () => {
    const client = createDevCmsg({ connectDelayMs: 10 });
    const first: CmsgEvent[] = [];
    const second: CmsgEvent[] = [];
    const releaseFirst = client.subscribe((event) => {
      first.push(event);
    });
    client.subscribe((event) => {
      second.push(event);
    });
    await client.connect();
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    releaseFirst();
    releaseFirst();
    first.length = 0;
    await client.disconnect();
    expect(first).toEqual([]);
    expect(second.length).toBeGreaterThan(0);
  });

  it('hands out event payloads as copies the UI cannot mutate', async () => {
    const client = createDevCmsg();
    const seen: CmsgEvent[] = [];
    client.subscribe((event) => {
      seen.push(event);
    });
    await client.joinWithVoucher(JOIN);
    const lobbyEvent = seen.find((event) => event.type === 'lobby');
    expect(lobbyEvent?.type).toBe('lobby');
    if (lobbyEvent?.type === 'lobby') lobbyEvent.lobby.handle = 'mutated';
    expect((await client.lobby()).handle).toBe('test-member');
  });
});

/* ------------------------------------------------------------------ */
/* Lobby, voucher join, passkey sign-in and gates                      */
/* ------------------------------------------------------------------ */

describe('core coverage: arrival and gates', () => {
  it('rejects malformed vouchers and out-of-range handles', async () => {
    const client = createDevCmsg();
    await expect(client.joinWithVoucher({ voucher: 'nope', handle: 'test-member' })).rejects.toThrow('not accepted');
    await expect(client.joinWithVoucher({ voucher: 'VOUCHER-', handle: 'test-member' })).rejects.toThrow('not accepted');
    await expect(client.joinWithVoucher({ voucher: 'VOUCHER-TEST-123', handle: 'short' })).rejects.toThrow('8 to 32');
    await expect(client.joinWithVoucher({ voucher: 'VOUCHER-TEST-123', handle: 'x'.repeat(33) })).rejects.toThrow('8 to 32');
  });

  it('trims surrounding whitespace on voucher and handle', async () => {
    const client = createDevCmsg();
    const { lobby } = await client.joinWithVoucher({ voucher: '  VOUCHER-TEST-123  ', handle: '  spaced-member  ' });
    expect(lobby.handle).toBe('spaced-member');
  });

  it('joins the lobby unadmitted with a no-return warning', async () => {
    const client = createDevCmsg();
    const { lobby } = await client.joinWithVoucher(JOIN);
    expect(lobby.handle).toBe('test-member');
    expect(lobby.admitted).toBe(false);
    expect(lobby.profileComplete).toBe(false);
    expect(lobby.expiryWarning).toMatch(/cannot return/);
    expect(lobby.devices.some((d) => d.thisDevice)).toBe(true);
  });

  it('refuses lobby and sign-in before any join', async () => {
    const client = createDevCmsg();
    await expect(client.lobby()).rejects.toThrow('voucher first');
    await expect(client.signIn()).rejects.toThrow('voucher first');
    await expect(client.completeGate('voucher', JOIN.voucher)).rejects.toThrow('voucher first');
  });

  it('signs a joined member in again through the passkey path', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const { lobby } = await client.signIn();
    expect(lobby.handle).toBe('test-member');
  });

  it('rejects gate completion unless this step waits for input', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await expect(client.completeGate('profile', 'anything')).rejects.toThrow('not available');
    await expect(client.completeGate('voucher', JOIN.voucher)).rejects.toThrow('not waiting');
    const waiting = createDevCmsg({ gateState: 'waiting' });
    await waiting.joinWithVoucher(JOIN);
    await expect(waiting.completeGate('voucher', JOIN.voucher)).rejects.toThrow('not waiting');
  });

  it('resumes an actionable gate only with the matching voucher input', async () => {
    const client = createDevCmsg({ gateState: 'action-needed' });
    await client.joinWithVoucher(JOIN);
    expect((await client.lobby()).gates[0]?.action).toMatchObject({ label: 'Check voucher' });
    await expect(client.completeGate('voucher', 'VOUCHER-WRONG-000')).rejects.toThrow('not accepted');
    await client.publishProfile(PROFILE);
    expect((await client.lobby()).admitted).toBe(false);
    const lobby = await client.completeGate('voucher', JOIN.voucher);
    expect(lobby.admitted).toBe(true);
    expect(lobby.expiryWarning).toBeNull();
    await expect(client.completeGate('voucher', JOIN.voucher)).rejects.toThrow('not waiting');
  });

  it('keeps admission closed while the profile gate is still open', async () => {
    const client = createDevCmsg({ gateState: 'action-needed' });
    await client.joinWithVoucher(JOIN);
    const lobby = await client.completeGate('voucher', JOIN.voucher);
    expect(lobby.admitted).toBe(false);
    expect(lobby.profileComplete).toBe(false);
  });

  it('publishes admission through lobby events', async () => {
    const client = createDevCmsg();
    const { events } = collect(client);
    await client.joinWithVoucher(JOIN);
    await client.publishProfile(PROFILE);
    const lobbies = events.filter((event) => event.type === 'lobby');
    expect(lobbies.length).toBeGreaterThanOrEqual(2);
  });
});

/* ------------------------------------------------------------------ */
/* Schema, own profile, rules and validation                           */
/* ------------------------------------------------------------------ */

describe('core coverage: schema, profile and rules', () => {
  it('returns schema, profile and rules as detached snapshots', async () => {
    const client = createDevCmsg();
    await client.signInRole('admin');
    const schema = await client.schema();
    schema.fields.push({ key: 'injected', question: 'Injected?', kind: 'short-text', visibility: 'public', required: false, filterable: false });
    expect((await client.schema()).fields.some((f) => f.key === 'injected')).toBe(false);

    await client.joinWithVoucher(JOIN);
    await client.saveRules([{ field: 'age', min: 30 }]);
    const rules = await client.ownRules();
    rules.push({ field: 'injected' });
    expect(await client.ownRules()).toEqual([{ field: 'age', min: 30 }]);

    const profile = await client.ownProfile();
    profile.values.age = 99;
    expect((await client.ownProfile()).values.age).toBeUndefined();
  });

  it('stores a detached copy of saved rules', async () => {
    const client = createDevCmsg();
    const next: MatchRule[] = [{ field: 'age', min: 30 }];
    await client.saveRules(next);
    next.push({ field: 'injected' });
    expect(await client.ownRules()).toEqual([{ field: 'age', min: 30 }]);
  });

  it('flags missing required answers and empty text', async () => {
    const client = createDevCmsg();
    const issues = await client.validateProfile({});
    expect(issues.map((i) => i.field).sort()).toEqual(['age', 'neighbourhood']);
    const empty = await client.validateProfile({ age: '', neighbourhood: '' } as unknown as ProfileValues);
    expect(empty.length).toBeGreaterThanOrEqual(2);
  });

  it('flags non-finite numbers and out-of-range ages', async () => {
    const client = createDevCmsg();
    expect((await client.validateProfile({ age: 'old', neighbourhood: 'North' } as unknown as ProfileValues)).some((i) => i.field === 'age')).toBe(true);
    expect((await client.validateProfile({ age: NaN, neighbourhood: 'North' })).some((i) => i.message.match(/finite/))).toBe(true);
    expect((await client.validateProfile({ age: 12, neighbourhood: 'North' })).some((i) => i.message.match(/18/))).toBe(true);
    expect((await client.validateProfile({ age: 120, neighbourhood: 'North' })).some((i) => i.message.match(/99/))).toBe(true);
    expect(await client.validateProfile({ age: 34, neighbourhood: 'North' })).toEqual([]);
  });

  it('flags unknown choice answers but accepts an empty optional choice', async () => {
    const client = createDevCmsg();
    const bad = await client.validateProfile({ age: 34, neighbourhood: 'Moon' });
    expect(bad.some((i) => i.field === 'neighbourhood')).toBe(true);
    const object = await client.validateProfile({ age: 34, neighbourhood: { odd: true } as unknown as string });
    expect(object.some((i) => i.field === 'neighbourhood')).toBe(true);
    expect(await client.validateProfile({ age: 34, neighbourhood: 'North', weekend: '' })).toEqual([]);
  });

  it('flags mistyped text answers', async () => {
    const client = createDevCmsg();
    const issues = await client.validateProfile({ age: 34, neighbourhood: 'North', about: 42 as unknown as string });
    expect(issues.some((i) => i.field === 'about')).toBe(true);
  });

  it('flags invalid locations', async () => {
    const client = createDevCmsg();
    const base = { age: 34, neighbourhood: 'North' };
    for (const location of [
      'Zurich',
      { latitude: 200, longitude: 8 },
      { latitude: 47, longitude: 200 },
      { latitude: NaN, longitude: 8 },
      { latitude: 47 },
    ]) {
      const issues = await client.validateProfile({ ...base, location: location as unknown as ProfileValues['location'] });
      expect(issues.some((i) => i.field === 'location')).toBe(true);
    }
    expect(await client.validateProfile({ ...base, location: { latitude: 47.3769, longitude: 8.5417 } })).toEqual([]);
  });

  it('validates fixture yes-no and long-text fields added through the admin schema', async () => {
    const client = createDevCmsg();
    await client.signInRole('admin');
    const schema = await client.adminSchema();
    await client.adminSaveSchema({
      ...schema,
      fields: [
        ...schema.fields,
        { key: 'agree', question: 'Do you agree?', kind: 'yes-no', visibility: 'private', required: false, filterable: false },
        { key: 'story', question: 'Your story?', kind: 'long-text', visibility: 'private', required: false, filterable: false },
      ],
    });
    const wrongYesNo = await client.validateProfile({ age: 34, neighbourhood: 'North', agree: 'maybe' as unknown as boolean });
    expect(wrongYesNo.some((i) => i.field === 'agree')).toBe(true);
    const wrongLong = await client.validateProfile({ age: 34, neighbourhood: 'North', story: 7 as unknown as string });
    expect(wrongLong.some((i) => i.field === 'story')).toBe(true);
    expect(await client.validateProfile({ age: 34, neighbourhood: 'North', agree: true, story: 'Hello' })).toEqual([]);
  });
});

describe('core coverage: publish profile', () => {
  it('refuses to publish an incomplete profile', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await expect(client.publishProfile({ age: 12, neighbourhood: 'North' })).rejects.toThrow();
  });

  it('publishes a detached copy, bumps the revision and admits when gates are complete', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const values = { ...PROFILE };
    const result = await client.publishProfile(values);
    values.age = 99;
    expect(result.profile.revision).toBe(1);
    expect(result.profile.published).toBe(true);
    expect(result.pinsSpent).toEqual([]);
    expect((await client.ownProfile()).values.age).toBe(34);
    const second = await client.publishProfile({ ...PROFILE, weekend: 'Hiking' });
    expect(second.profile.revision).toBe(2);
    expect((await client.lobby()).admitted).toBe(true);
  });

  it('stays unadmitted when the gate is still waiting', async () => {
    const client = createDevCmsg({ gateState: 'waiting' });
    await client.joinWithVoucher(JOIN);
    await client.publishProfile(PROFILE);
    expect((await client.lobby()).admitted).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Forum discovery, key exchange, location filters                     */
/* ------------------------------------------------------------------ */

describe('core coverage: forum discovery', () => {
  it('refuses discovery before admission', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await expect(client.discover([])).rejects.toThrow('admission');
  });

  it('matches only when both rule sets pass and hides offline members', async () => {
    const client = await admitted(createDevCmsg());
    const handles = (await client.discover([])).entries.map((e) => e.handle);
    expect(handles).toContain('ana-walks');
    expect(handles).toContain('tom-cooks');
    expect(handles).not.toContain('rin-reads');
    expect(handles).not.toContain('jo-runs');
  });

  it('applies one-sided filters on top of two-way matching', async () => {
    const client = await admitted(createDevCmsg());
    const filtered = await client.discover([{ field: 'neighbourhood', equals: ['East'] }]);
    expect(filtered.entries.map((e) => e.handle)).toEqual(['tom-cooks']);
    const ranged = await client.discover([{ field: 'age', min: 30, max: 40 }]);
    expect(ranged.entries.map((e) => e.handle)).toEqual(['ana-walks']);
    const none = await client.discover([{ field: 'age', min: 60 }]);
    expect(none.entries).toEqual([]);
    expect(none.cursor).toBeNull();
  });

  it('rejects non-numeric values against numeric filters', async () => {
    const client = await admitted(createDevCmsg());
    const page = await client.discover([{ field: 'neighbourhood', min: 1 }]);
    expect(page.entries).toEqual([]);
  });

  it('enforces the member’s own rules against candidates', async () => {
    const client = await admitted(createDevCmsg());
    await client.saveRules([{ field: 'neighbourhood', equals: ['West'] }]);
    expect((await client.discover([])).entries).toEqual([]);
    await client.saveRules([{ field: 'neighbourhood', min: 1 }]);
    expect((await client.discover([])).entries).toEqual([]);
  });

  it('treats a bare location rule as satisfied and a ranged one by distance', async () => {
    const near = await admitted(createDevCmsg(), ZURICH_PROFILE);
    await near.saveRules([{ field: 'location' }]);
    expect((await near.discover([])).entries.length).toBeGreaterThan(0);
    expect((await near.discover([{ field: 'location' }])).entries.length).toBeGreaterThan(0);

    const ranged = await admitted(createDevCmsg(), ZURICH_PROFILE);
    await ranged.saveRules([{ field: 'location', maxDistanceKm: 5 }]);
    const handles = (await ranged.discover([])).entries.map((e) => e.handle);
    expect(handles).toContain('ana-walks');
    expect(handles).toContain('tom-cooks');
    expect(handles).not.toContain('rin-reads');

    const homeless = await admitted(createDevCmsg());
    await homeless.saveRules([{ field: 'location', maxDistanceKm: 5 }]);
    expect((await homeless.discover([])).entries).toEqual([]);
  });

  it('filters real distances and pages through the forum', async () => {
    const client = createDevCmsg({ pageSize: 1 });
    await admitted(client, ZURICH_PROFILE);
    const first = await client.discover([{ field: 'location', maxDistanceKm: 5 }]);
    expect(first.entries.map((e) => e.memberId)).toEqual(['member-ana']);
    expect(first.cursor).toBe('1');
    const second = await client.discover([{ field: 'location', maxDistanceKm: 5 }], first.cursor);
    expect(second.entries.map((e) => e.memberId)).toEqual(['member-tom']);
    expect(second.cursor).toBeNull();
    const far = await client.discover([{ field: 'location', maxDistanceKm: 5 }], '99');
    expect(far.entries).toEqual([]);
    const missing = await admitted(createDevCmsg());
    expect((await missing.discover([{ field: 'location', maxDistanceKm: 5 }])).entries).toEqual([]);
  });

  it('uses the default page size in one page', async () => {
    const client = await admitted(createDevCmsg(), ZURICH_PROFILE);
    const page = await client.discover([]);
    expect(page.cursor).toBeNull();
    expect(page.entries.length).toBeGreaterThan(0);
  });

  it('never exposes private values and isolates card snapshots', async () => {
    const client = await admitted(createDevCmsg(), ZURICH_PROFILE);
    const page = await client.discover([]);
    expect(page.entries[0]?.values.about).toBeUndefined();
    expect(page.entries[0]?.values.age).toBeDefined();
    expect(page.entries.find((e) => e.memberId === 'member-tom')?.record).toBeNull();
    expect(page.entries.find((e) => e.memberId === 'member-ana')?.record).not.toBeNull();
    page.entries[0]!.values.age = 99;
    expect((await client.discover([])).entries[0]?.values.age).not.toBe(99);
  });

  it('hides blocked members from discovery', async () => {
    const client = await admitted(createDevCmsg());
    await client.blockMember('member-tom');
    expect((await client.discover([])).entries.map((e) => e.handle)).not.toContain('tom-cooks');
  });
});

describe('core coverage: private key exchange', () => {
  it('refuses unavailable members', async () => {
    const client = await admitted(createDevCmsg());
    await expect(client.requestPrivateKey('member-jo')).rejects.toThrow('not available');
    await expect(client.requestPrivateKey('ghost-member')).rejects.toThrow('not available');
    await client.blockMember('member-ana');
    await expect(client.requestPrivateKey('member-ana')).rejects.toThrow('not available');
  });

  it('accepts by rules and shares the peer profile without raw keys or owner reasons', async () => {
    const client = await admitted(createDevCmsg());
    const { events } = collect(client);
    const result = await client.requestPrivateKey('member-ana');
    expect(result.status).toBe('accepted');
    expect(result.reason).toBeUndefined();
    expect(result.profile?.values.age).toBe(34);
    expect(events.filter((e) => e.type === 'key-decision').length).toBe(1);
  });

  it('reports only the failing field when the peer’s rule rejects us', async () => {
    const client = createDevCmsg();
    await admitted(client, { age: 34, neighbourhood: 'North', weekend: 'Hiking' });
    const rejected = await client.requestPrivateKey('member-rin');
    expect(rejected.status).toBe('rejected');
    expect(rejected.failingField).toBe('weekend');
    expect(rejected.reason).toBeUndefined();
    expect(rejected.profile).toBeUndefined();
  });

  it('reports only the failing field when our own rule rejects the peer', async () => {
    const client = await admitted(createDevCmsg());
    await client.saveRules([{ field: 'neighbourhood', equals: ['West'] }]);
    const rejected = await client.requestPrivateKey('member-ana');
    expect(rejected.status).toBe('rejected');
    expect(rejected.failingField).toBe('neighbourhood');
  });

  it('logs exchanges as detached snapshots including the seed entry', async () => {
    const client = await admitted(createDevCmsg());
    const seed = await client.profileExchanges();
    expect(seed[0]).toMatchObject({ peer: 'member-ana', direction: 'incoming' });
    await client.requestPrivateKey('member-ana');
    const exchanges = await client.profileExchanges();
    expect(exchanges.at(-1)).toMatchObject({ peer: 'member-ana', direction: 'outgoing' });
    exchanges.at(-1)!.result.profile!.values.age = 99;
    expect((await client.profileExchanges()).at(-1)?.result.profile?.values.age).toBe(34);
  });
});

/* ------------------------------------------------------------------ */
/* Waves: slots, release, answering, closing, punishing                */
/* ------------------------------------------------------------------ */

describe('core coverage: waves', () => {
  it('reports the starting slot budget', async () => {
    const client = createDevCmsg();
    expect(await client.waveSlots()).toEqual({ introductionsAvailable: 3, incomingAvailable: 3 });
  });

  it('seeds one released incoming wave as detached copies', async () => {
    const client = createDevCmsg();
    const [incoming] = await client.incomingWaves();
    expect(incoming?.releaseState).toBe('released');
    expect(incoming?.message).not.toBe('');
    incoming!.message = 'mutated';
    expect((await client.incomingWaves())[0]?.message).not.toBe('mutated');
  });

  it('seeds a reserved incoming wave whose content stays hidden', async () => {
    const client = createDevCmsg({ incomingReleaseState: 'reserved' });
    const [incoming] = await client.incomingWaves();
    expect(incoming?.releaseState).toBe('reserved');
    expect(incoming?.message).toBe('');
    await expect(client.answerWave(incoming!.id, 'Hello')).rejects.toThrow('not released');
    await expect(client.closeWave(incoming!.id)).rejects.toThrow('not released');
    await expect(client.punishWave(incoming!.id)).rejects.toThrow('not released');
  });

  it('refuses invalid outgoing waves', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await expect(client.sendWave('member-ana', '   ')).rejects.toThrow('Write a message');
    await expect(client.sendWave('member-jo', 'Hello')).rejects.toThrow('online');
    await expect(client.sendWave('ghost-member', 'Hello')).rejects.toThrow('online');
    await client.blockMember('member-ana');
    await expect(client.sendWave('member-ana', 'Hello')).rejects.toThrow('blocked');
  });

  it('spends the sender budget and refuses a fourth introduction', async () => {
    const client = createDevCmsg({ releaseDelayMs: 10 });
    await client.joinWithVoucher(JOIN);
    await client.sendWave('member-ana', 'Hello ana');
    await client.sendWave('member-tom', 'Hello tom');
    await client.sendWave('member-rin', 'Hello rin');
    expect((await client.waveSlots()).introductionsAvailable).toBe(0);
    await expect(client.sendWave('member-ana', 'Again')).rejects.toThrow('No introductions');
    await client.disconnect();
  });

  it('holds outgoing content as reserved and releases it on the fixture timer', async () => {
    const client = createDevCmsg({ releaseDelayMs: 20 });
    await client.joinWithVoucher(JOIN);
    const { events } = collect(client);
    const wave = await client.sendWave('member-ana', 'Hello');
    expect(wave.releaseState).toBe('reserved');
    expect(wave.reason).toMatch(/Waiting/);
    await sleep(60);
    const updates = events.filter((event) => event.type === 'wave-updated');
    expect(updates.length).toBeGreaterThanOrEqual(1);
    const last = updates.at(-1);
    expect(last?.type).toBe('wave-updated');
    if (last?.type === 'wave-updated') expect(last.wave.releaseState).toBe('released');
  });

  it('schedules the default release delay without options', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const wave = await client.sendWave('member-ana', 'Hello');
    expect(wave.releaseState).toBe('reserved');
    await client.disconnect();
  });

  it('answers a released wave, returns both slots and opens an established thread', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const { events } = collect(client);
    const [incoming] = await client.incomingWaves();
    const done = await client.answerWave(incoming!.id, 'Hello back!');
    expect(done.state).toBe('answered');
    expect(done.senderSlotHeld).toBe(false);
    expect(done.recipientSlotHeld).toBe(false);
    const thread = await client.thread('member-tom');
    expect(thread.established).toBe(true);
    expect(thread.state).toBe('active');
    expect(thread.messages.length).toBe(2);
    expect(thread.messages[0]?.state).toBe('received');
    expect(events.filter((e) => e.type === 'message').length).toBe(2);
    expect(events.some((e) => e.type === 'wave-updated')).toBe(true);
    await expect(client.answerWave(incoming!.id, 'Again')).rejects.toThrow('no longer waiting');
  });

  it('refuses answers that are unknown, outgoing, empty or blocked', async () => {
    const client = createDevCmsg({ releaseDelayMs: 10 });
    await client.joinWithVoucher(JOIN);
    await expect(client.answerWave('wave-missing', 'Hello')).rejects.toThrow('no longer waiting');
    const outgoing = await client.sendWave('member-ana', 'Hello');
    await expect(client.answerWave(outgoing.id, 'Hello')).rejects.toThrow('not released');
    const [incoming] = await client.incomingWaves();
    await expect(client.answerWave(incoming!.id, '   ')).rejects.toThrow('Write a reply');
    const blocked = createDevCmsg();
    await blocked.joinWithVoucher(JOIN);
    await blocked.blockMember('member-tom');
    const [seed] = await blocked.incomingWaves();
    await expect(blocked.answerWave(seed!.id, 'Hello')).rejects.toThrow('blocked');
    await client.disconnect();
  });

  it('closes at once on the recipient side and returns the sender slot after waiting', async () => {
    const client = createDevCmsg({ waveWaitMs: 20 });
    await client.joinWithVoucher(JOIN);
    const { events } = collect(client);
    const [incoming] = await client.incomingWaves();
    const closed = await client.closeWave(incoming!.id);
    expect(closed.state).toBe('closed');
    expect(closed.recipientSlotHeld).toBe(false);
    expect(closed.senderSlotHeld).toBe(true);
    await sleep(60);
    const [updated] = await client.incomingWaves();
    expect(updated!.senderSlotHeld).toBe(false);
    expect(events.filter((e) => e.type === 'wave-updated').length).toBeGreaterThanOrEqual(2);
    await expect(client.closeWave(incoming!.id)).rejects.toThrow('no longer waiting');
    await expect(client.closeWave('wave-missing')).rejects.toThrow('no longer waiting');
  });

  it('punishes through the seed wave and blocks the sender without a prior thread', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await client.publishProfile(PROFILE);
    const [incoming] = await client.incomingWaves();
    const punished = await client.punishWave(incoming!.id);
    expect(punished.state).toBe('punished');
    expect(punished.senderSlotHeld).toBe(false);
    expect(punished.recipientSlotHeld).toBe(false);
    expect((await client.contacts()).find((c) => c.memberId === 'member-tom')?.blockedByMe).toBe(true);
    expect((await client.discover([])).entries.map((e) => e.handle)).not.toContain('tom-cooks');
    await expect(client.punishWave(incoming!.id)).rejects.toThrow('no longer waiting');
  });

  it('punishes while a thread exists and marks that thread blocked', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await client.thread('member-tom');
    const [incoming] = await client.incomingWaves();
    await client.punishWave(incoming!.id);
    expect((await client.thread('member-tom')).state).toBe('blocked');
  });
});

/* ------------------------------------------------------------------ */
/* Contacts and blocks                                                 */
/* ------------------------------------------------------------------ */

describe('core coverage: contacts', () => {
  it('starts empty and lists answered contacts as established', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    expect(await client.contacts()).toEqual([]);
    const [incoming] = await client.incomingWaves();
    await client.answerWave(incoming!.id, 'Hello');
    const contact = (await client.contacts()).find((c) => c.memberId === 'member-tom');
    expect(contact).toMatchObject({ relation: 'established', online: true, blockedByMe: false });
  });

  it('represents unknown peers from open threads as offline and unblocked', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await client.closeConversation('ghost-peer');
    const contact = (await client.contacts()).find((c) => c.memberId === 'ghost-peer');
    expect(contact).toMatchObject({ relation: 'closed', online: false, blockedByMe: false });
  });

  it('blocks and unblocks with thread state and contact events', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const { events } = collect(client);
    const [incoming] = await client.incomingWaves();
    await client.answerWave(incoming!.id, 'Hello');
    await client.blockMember('member-tom');
    expect((await client.thread('member-tom')).state).toBe('blocked');
    expect((await client.contacts()).find((c) => c.memberId === 'member-tom')).toMatchObject({ relation: 'blocked', blockedByMe: true });
    await client.unblockMember('member-tom');
    expect((await client.thread('member-tom')).state).toBe('closed');
    expect((await client.contacts()).find((c) => c.memberId === 'member-tom')).toMatchObject({ relation: 'closed', blockedByMe: false });
    expect(events.filter((e) => e.type === 'contacts').length).toBe(2);
  });

  it('unblocks a never-blocked peer without failing', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await client.unblockMember('member-ana');
    expect((await client.contacts()).find((c) => c.memberId === 'member-ana')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Threads and one-to-one messages                                     */
/* ------------------------------------------------------------------ */

describe('core coverage: threads', () => {
  it('starts without threads and creates an inactive draft for known peers', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    expect(await client.threads()).toEqual([]);
    const draft = await client.thread('member-ana');
    expect(draft).toMatchObject({ peer: 'member-ana', peerHandle: 'ana-walks', established: false, state: 'active' });
    await expect(client.sendMessage('member-ana', 'Hello')).rejects.toThrow('not open');
  });

  it('refuses unknown peers and empty drafts', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await expect(client.thread('ghost-member')).rejects.toThrow('not available');
    const [incoming] = await client.incomingWaves();
    await client.answerWave(incoming!.id, 'Hello');
    await expect(client.sendMessage('member-tom', '   ')).rejects.toThrow('Write a message');
  });

  it('queues messages before the network is ready', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const [incoming] = await client.incomingWaves();
    await client.answerWave(incoming!.id, 'Hello');
    const message = await client.sendMessage('member-tom', 'Are you there?');
    expect(message.state).toBe('queued');
    expect(message.outgoing).toBe(true);
  });

  it('stores messages once the network is ready or the fixture overrides delivery', async () => {
    const ready = createDevCmsg({ connectDelayMs: 10 });
    await ready.joinWithVoucher(JOIN);
    const [incoming] = await ready.incomingWaves();
    await ready.answerWave(incoming!.id, 'Hello');
    await ready.connect();
    expect((await ready.sendMessage('member-tom', 'Hello')).state).toBe('stored');

    const forced = createDevCmsg({ messageState: 'stored' });
    await forced.joinWithVoucher(JOIN);
    const [seed] = await forced.incomingWaves();
    await forced.answerWave(seed!.id, 'Hello');
    expect((await forced.sendMessage('member-tom', 'Hello')).state).toBe('stored');
  });

  it('emits message events and isolates thread snapshots', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const { events } = collect(client);
    const [incoming] = await client.incomingWaves();
    await client.answerWave(incoming!.id, 'Hello');
    await client.sendMessage('member-tom', 'Second');
    expect(events.filter((e) => e.type === 'message').length).toBe(3);
    const threads = await client.threads();
    threads[0]!.messages.push({ id: 'injected', threadId: 'x', from: 'x', text: 'x', at: 0, outgoing: true, state: 'queued' });
    expect((await client.thread('member-tom')).messages.length).toBe(3);
  });

  it('creates blocked and closed thread views from the relation', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    await client.blockMember('ghost-peer');
    await client.closeConversation('member-ana');
    expect((await client.thread('ghost-peer')).state).toBe('blocked');
    expect((await client.thread('member-ana')).state).toBe('closed');
    expect((await client.thread('member-ana')).established).toBe(false);
  });

  it('closes, punishes and reopens conversations explicitly', async () => {
    const client = createDevCmsg();
    await client.joinWithVoucher(JOIN);
    const [incoming] = await client.incomingWaves();
    await client.answerWave(incoming!.id, 'Hello');
    await client.closeConversation('member-tom');
    await expect(client.sendMessage('member-tom', 'No')).rejects.toThrow('not open');
    await expect(client.requestReopen('member-ana')).rejects.toThrow('closed conversation');
    await client.requestReopen('member-tom');
    const pending = await client.thread('member-tom');
    expect(pending.state).toBe('reopen-pending');
    expect(pending.established).toBe(false);
    await client.punishConversation('member-tom');
    expect((await client.thread('member-tom')).state).toBe('blocked');
    await client.unblockMember('member-tom');
    expect((await client.thread('member-tom')).state).toBe('closed');
  });
});

/* ------------------------------------------------------------------ */
/* Groups, forks, suggestions and group messages                       */
/* ------------------------------------------------------------------ */

describe('core coverage: groups', () => {
  it('lists seeded levels with opaque transition hints as snapshots', async () => {
    const client = createDevCmsg();
    const groups = await client.groups();
    expect(groups.find((g) => g.id === 'group-garden')).toMatchObject({ level: 'circle', joined: true });
    expect(groups.find((g) => g.id === 'group-market')).toMatchObject({ level: 'room' });
    expect(groups.find((g) => g.id === 'group-opening')).toMatchObject({ level: 'opening' });
    groups[0]!.name = 'mutated';
    expect((await client.groups())[0]?.name).not.toBe('mutated');
  });

  it('uses caller-supplied group fixtures without aliasing them', async () => {
    const custom: GroupView[] = [
      {
        id: 'group-custom',
        name: 'Custom',
        level: 'circle',
        size: 5,
        whatChangesNext: 'Nothing yet.',
        description: 'Custom fixture.',
        joinConsent: null,
        joined: true,
        newcomerHistory: 'Fresh start.',
        messages: [],
        suggestion: null,
      },
    ];
    const client = createDevCmsg({ groups: custom });
    custom[0]!.name = 'mutated';
    expect((await client.groups())[0]?.name).toBe('Custom');
    await expect(client.consentFork('group-custom', 'fork-x')).rejects.toThrow('not available');
    const proposal = await client.proposeFork({ groupId: 'group-custom', kind: 'split', label: 'Split', detail: 'd' });
    expect(proposal.forks?.[0]?.proposedRoster).toEqual([]);
    const moved = await client.consentFork('group-custom', proposal.forks![0]!.id);
    expect(moved.lineage).toEqual(['Custom']);
  });

  it('refuses unknown groups for every group action', async () => {
    const client = createDevCmsg();
    await expect(client.joinGroup('group-missing')).rejects.toThrow('not available');
    await expect(client.leaveGroup('group-missing')).rejects.toThrow('not available');
    await expect(client.proposeFork({ groupId: 'group-missing', kind: 'exit', label: 'L', detail: 'd' })).rejects.toThrow('not available');
    await expect(client.consentFork('group-missing', 'fork-1')).rejects.toThrow('not available');
    await expect(client.consentFork('group-garden', 'fork-missing')).rejects.toThrow('not available');
    await expect(client.welcomeMember('group-missing')).rejects.toThrow('not available');
    await expect(client.dismissGroupSuggestion('group-missing')).rejects.toThrow('not available');
    await expect(client.sendGroupMessage('group-missing', 'Hello')).rejects.toThrow('before writing');
  });

  it('requires explicit consent for rooms and counts each join once', async () => {
    const client = createDevCmsg();
    const { events } = collect(client);
    await expect(client.joinGroup('group-market')).rejects.toThrow('consent');
    const room = await client.joinGroup('group-market', true);
    expect(room.joined).toBe(true);
    expect(room.size).toBe(68);
    const again = await client.joinGroup('group-market', true);
    expect(again.size).toBe(68);
    await client.leaveGroup('group-market');
    expect((await client.groups()).find((g) => g.id === 'group-market')?.joined).toBe(false);
    await client.leaveGroup('group-market');
    expect((await client.groups()).find((g) => g.id === 'group-market')?.size).toBe(67);
    expect(events.filter((e) => e.type === 'groups').length).toBeGreaterThanOrEqual(3);
  });

  it('joins consent-free circles without a flag', async () => {
    const client = createDevCmsg();
    await client.leaveGroup('group-garden');
    const garden = await client.joinGroup('group-garden');
    expect(garden.joined).toBe(true);
    expect(garden.size).toBe(8);
  });

  it('proposes forks without moving anyone and consents into a new group', async () => {
    const client = createDevCmsg();
    await expect(client.proposeFork({ groupId: 'group-garden', kind: 'exit', label: '   ', detail: '' })).rejects.toThrow('Describe the fork');
    const before = await client.groups();
    const proposal = await client.proposeFork({ groupId: 'group-garden', kind: 'exit', label: 'Exit', detail: 'Leave quietly' });
    expect(proposal.forks?.[0]?.consented).toBe(false);
    expect(proposal.forks?.[0]?.proposedRoster).toEqual([]);
    expect((await client.groups()).length).toBe(before.length);
    const moved = await client.consentFork(proposal.id, proposal.forks![0]!.id);
    expect(moved.id).not.toBe(proposal.id);
    expect(moved.lineage).toContain('Community garden');
    expect(moved.opening).toBeUndefined();
    expect((await client.groups()).length).toBe(before.length + 1);
    const cached = await client.consentFork(proposal.id, proposal.forks![0]!.id);
    expect(cached.id).toBe(moved.id);
    expect((await client.groups()).length).toBe(before.length + 1);
  });

  it('keeps member rosters on proposals and opens consented openings', async () => {
    const client = createDevCmsg();
    const proposal = await client.proposeFork({ groupId: 'group-choir', kind: 'open', label: 'Open garden', detail: 'Join if you wish', memberIds: ['member-ana'] });
    expect(proposal.forks?.[0]?.proposedRoster).toEqual(['member-ana']);
    const next = await client.consentFork(proposal.id, proposal.forks![0]!.id);
    expect(next.level).toBe('opening');
    expect(next.opening?.deadlineLabel).toContain('21 days');
    expect(next.joinConsent).toMatch(/consent/);
  });

  it('welcomes only after joining and dismisses suggestions', async () => {
    const client = createDevCmsg();
    await expect(client.welcomeMember('group-choir')).rejects.toThrow('before welcoming');
    expect(await client.welcomeMember('group-garden')).toMatch(/Community garden/);
    await client.dismissGroupSuggestion('group-choir');
    expect((await client.groups()).find((g) => g.id === 'group-choir')?.suggestion).toBeNull();
  });

  it('refuses group messages before joining or without text', async () => {
    const client = createDevCmsg();
    await expect(client.sendGroupMessage('group-choir', 'Hello')).rejects.toThrow('before writing');
    await expect(client.sendGroupMessage('group-garden', '   ')).rejects.toThrow('Write a message');
  });

  it('queues group messages offline and stores them once connected', async () => {
    const offline = createDevCmsg();
    expect((await offline.sendGroupMessage('group-garden', 'Hello')).state).toBe('queued');
    const online = createDevCmsg({ connectDelayMs: 10 });
    await online.connect();
    const { events } = collect(online);
    const message = await online.sendGroupMessage('group-garden', 'Hello');
    expect(message.state).toBe('stored');
    expect(events.some((e) => e.type === 'message')).toBe(true);
    expect((await online.groups()).find((g) => g.id === 'group-garden')?.messages.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Devices and vault restore                                           */
/* ------------------------------------------------------------------ */

describe('core coverage: devices', () => {
  it('lists this device and isolates device snapshots', async () => {
    const client = createDevCmsg();
    const devices = await client.devices();
    expect(devices.some((d) => d.thisDevice && d.state === 'active')).toBe(true);
    devices[0]!.name = 'mutated';
    expect((await client.devices())[0]?.name).not.toBe('mutated');
  });

  it('adds a device as pending and approves it through a separate action', async () => {
    const client = createDevCmsg();
    const { events } = collect(client);
    await expect(client.addDevice('   ')).rejects.toThrow('name first');
    const pending = await client.addDevice('Spare phone');
    expect(pending.state).toBe('pending');
    expect((await client.devices()).some((d) => d.id === pending.id && d.state === 'pending')).toBe(true);
    await expect(client.addDevice('Another')).rejects.toThrow('pending device');
    await expect(client.approveDevice('device-missing')).rejects.toThrow('not waiting');
    const approved = await client.approveDevice(pending.id);
    expect(approved.state).toBe('active');
    approved.name = 'mutated';
    expect((await client.devices()).find((d) => d.id === pending.id)?.name).toBe('Spare phone');
    expect(events.filter((e) => e.type === 'devices').length).toBeGreaterThanOrEqual(2);
  });

  it('removes enrolled and pending devices but never this device directly', async () => {
    const client = createDevCmsg();
    await expect(client.removeDevice('device-missing')).rejects.toThrow('not available');
    await expect(client.removeDevice('device-1')).rejects.toThrow('another device');
    const pending = await client.addDevice('Spare phone');
    const approved = await client.approveDevice(pending.id);
    await client.removeDevice(approved.id);
    expect((await client.devices()).some((d) => d.id === approved.id)).toBe(false);
    const second = await client.addDevice('Tablet');
    await client.removeDevice(second.id);
    expect((await client.devices()).some((d) => d.id === second.id)).toBe(false);
  });

  it('renames enrolled and pending devices', async () => {
    const client = createDevCmsg();
    await expect(client.renameDevice('device-1', '   ')).rejects.toThrow('name first');
    await expect(client.renameDevice('device-missing', 'Phone')).rejects.toThrow('not available');
    await client.renameDevice('device-1', 'Main phone');
    expect((await client.devices())[0]?.name).toBe('Main phone');
    const pending = await client.addDevice('Tablet');
    await client.renameDevice(pending.id, 'Spare tablet');
    expect((await client.devices()).find((d) => d.id === pending.id)?.name).toBe('Spare tablet');
  });

  it('reports every deterministic vault outcome with its own message', async () => {
    expect((await createDevCmsg().restoreVault())).toMatchObject({ state: 'ready' });
    expect((await createDevCmsg().restoreVault()).message).toMatch(/recoverable/);
    expect((await createDevCmsg({ restoreState: 'unavailable' }).restoreVault()).message).toMatch(/Missing replicas/);
    expect((await createDevCmsg({ restoreState: 'locked' }).restoreVault())).toMatchObject({ state: 'locked' });
    const lost = await createDevCmsg({ restoreState: 'unrecoverable' }).restoreVault();
    expect(lost.state).toBe('unrecoverable');
    expect(lost.message).toMatch(/no operator recovery/);
  });
});

/* ------------------------------------------------------------------ */
/* Scoped admin and root calls                                         */
/* ------------------------------------------------------------------ */

describe('core coverage: admin and root scope', () => {
  it('refuses admin and root reads before the matching passkey sign-in', async () => {
    const client = createDevCmsg();
    await expect(client.adminSchema()).rejects.toThrow('Sign in');
    await expect(client.adminSaveSchema({ version: 3, fields: [] })).rejects.toThrow('Sign in');
    await expect(client.rootCommunities()).rejects.toThrow('Sign in');
    await expect(client.rootCommunity('garden-neighbours')).rejects.toThrow('Sign in');
    await expect(client.rootSetSetting('garden-neighbours', 'postingPace', 'inherit')).rejects.toThrow('Sign in');
    await expect(client.rootSetAdmin('garden-neighbours', 'admin-1', true)).rejects.toThrow('Sign in');
  });

  it('keeps admin and root scopes separate across sign-ins', async () => {
    const client = createDevCmsg();
    await client.signInRole('admin');
    await expect(client.rootCommunities()).rejects.toThrow('Sign in');
    await client.signInRole('root');
    await expect(client.adminSchema()).rejects.toThrow('Sign in');
    await client.signInRole('admin');
    expect((await client.adminSchema()).version).toBe(3);
  });

  it('validates every schema edit before saving', async () => {
    const client = createDevCmsg();
    await client.signInRole('admin');
    const schema = await client.adminSchema();
    await expect(client.adminSaveSchema({ ...schema, version: 2 })).rejects.toThrow('changed');
    await expect(client.adminSaveSchema({ ...schema, fields: [{ ...schema.fields[0]!, key: '  ' }] })).rejects.toThrow('unique key');
    await expect(client.adminSaveSchema({ ...schema, fields: [schema.fields[0]!, { ...schema.fields[0]! }] })).rejects.toThrow('unique key');
    await expect(client.adminSaveSchema({ ...schema, fields: [{ ...schema.fields[0]!, question: '  ' }] })).rejects.toThrow('unique key');
    await expect(
      client.adminSaveSchema({ ...schema, fields: [{ ...schema.fields[0]!, kind: 'bogus' as never }] }),
    ).rejects.toThrow('unavailable');
    await expect(
      client.adminSaveSchema({ ...schema, fields: [{ ...schema.fields[1]!, choices: [] }] }),
    ).rejects.toThrow('choice');
    await expect(
      client.adminSaveSchema({ ...schema, fields: [{ ...schema.fields[0]!, min: 90, max: 18 }] }),
    ).rejects.toThrow('minimum exceeds');
  });

  it('saves the schema, bumps the version and reports impact', async () => {
    const client = createDevCmsg();
    await client.signInRole('admin');
    const schema = await client.adminSchema();
    const impact = await client.adminSaveSchema({ ...schema, fields: [...schema.fields].reverse() });
    expect(impact.profilesNeedingChanges).toBeGreaterThanOrEqual(0);
    expect(impact.note).toMatch(/at once/);
    expect((await client.adminSchema()).version).toBe(4);
    await expect(client.adminSaveSchema(schema)).rejects.toThrow('changed');
  });

  it('lists root communities and isolates their snapshots', async () => {
    const client = createDevCmsg();
    await client.signInRole('root');
    const communities = await client.rootCommunities();
    expect(communities.map((c) => c.communityId).sort()).toEqual(['evening-choir', 'garden-neighbours']);
    const view = await client.rootCommunity('garden-neighbours');
    view.settings[0]!.effectiveValue = 'mutated';
    expect((await client.rootCommunity('garden-neighbours')).settings[0]?.effectiveValue).toBe('slow');
    expect((await client.rootCommunity('evening-choir')).settings[0]?.effectiveValue).toBe('weekly');
    await expect(client.rootCommunity('missing-community')).rejects.toThrow('not available');
  });

  it('applies inherit, empty and value modes to editable settings only', async () => {
    const client = createDevCmsg();
    await client.signInRole('root');
    const id = 'garden-neighbours';
    await expect(client.rootSetSetting('missing-community', 'postingPace', 'inherit')).rejects.toThrow('not available');
    await expect(client.rootSetSetting(id, 'missing-setting', 'inherit')).rejects.toThrow('not available');
    await expect(client.rootSetSetting(id, 'joining', 'empty')).rejects.toThrow('platform');
    await expect(client.rootSetSetting(id, 'postingPace', 'value', '   ')).rejects.toThrow('Enter a value');
    const emptied = await client.rootSetSetting(id, 'postingPace', 'empty');
    expect(emptied.settings[0]).toMatchObject({ inherited: false, overrideValue: null, effectiveValue: '' });
    const valued = await client.rootSetSetting(id, 'postingPace', 'value', 'daily');
    expect(valued.settings[0]?.effectiveValue).toBe('daily');
    expect(valued.settings[0]?.overrideValue).toBe('daily');
    const inherited = await client.rootSetSetting(id, 'postingPace', 'inherit');
    expect(inherited.settings[0]).toMatchObject({ inherited: true, overrideValue: null, effectiveValue: 'slow' });
  });

  it('adds and removes community admins without duplicating them', async () => {
    const client = createDevCmsg();
    await client.signInRole('root');
    const id = 'garden-neighbours';
    await expect(client.rootSetAdmin('missing-community', 'admin-9', true)).rejects.toThrow('not available');
    await expect(client.rootSetAdmin(id, '   ', true)).rejects.toThrow('Choose an admin');
    await client.rootSetAdmin(id, 'fixture-admin', true);
    await client.rootSetAdmin(id, 'fixture-admin', true);
    const added = await client.rootCommunity(id);
    expect(added.admins.filter((a) => a.id === 'fixture-admin').length).toBe(1);
    await client.rootSetAdmin(id, 'fixture-admin', false);
    expect((await client.rootCommunity(id)).admins.some((a) => a.id === 'fixture-admin')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Declared fixture failures and timer cleanup                         */
/* ------------------------------------------------------------------ */

describe('core coverage: declared fixture failures', () => {
  it('reports an explicit fixture failure for every failable action', async () => {
    const cases: Array<[string, (client: CmsgClient) => Promise<unknown>]> = [
      ['connectionStatus', (c) => c.connectionStatus()],
      ['connect', (c) => c.connect()],
      ['disconnect', (c) => c.disconnect()],
      ['joinWithVoucher', (c) => c.joinWithVoucher(JOIN)],
      ['lobby', (c) => c.lobby()],
      ['signIn', (c) => c.signIn()],
      ['completeGate', (c) => c.completeGate('voucher', 'input')],
      ['schema', (c) => c.schema()],
      ['ownProfile', (c) => c.ownProfile()],
      ['ownRules', (c) => c.ownRules()],
      ['saveRules', (c) => c.saveRules([])],
      ['validateProfile', (c) => c.validateProfile({})],
      ['publishProfile', (c) => c.publishProfile({ age: 34, neighbourhood: 'North' })],
      ['discover', (c) => c.discover([])],
      ['requestPrivateKey', (c) => c.requestPrivateKey('member-ana')],
      ['profileExchanges', (c) => c.profileExchanges()],
      ['waveSlots', (c) => c.waveSlots()],
      ['sendWave', (c) => c.sendWave('member-ana', 'hi')],
      ['incomingWaves', (c) => c.incomingWaves()],
      ['answerWave', (c) => c.answerWave('wave-seed-1', 'hi')],
      ['closeWave', (c) => c.closeWave('wave-seed-1')],
      ['punishWave', (c) => c.punishWave('wave-seed-1')],
      ['contacts', (c) => c.contacts()],
      ['blockMember', (c) => c.blockMember('member-ana')],
      ['unblockMember', (c) => c.unblockMember('member-ana')],
      ['threads', (c) => c.threads()],
      ['thread', (c) => c.thread('member-ana')],
      ['sendMessage', (c) => c.sendMessage('member-ana', 'hi')],
      ['closeConversation', (c) => c.closeConversation('member-ana')],
      ['punishConversation', (c) => c.punishConversation('member-ana')],
      ['requestReopen', (c) => c.requestReopen('member-ana')],
      ['groups', (c) => c.groups()],
      ['joinGroup', (c) => c.joinGroup('group-garden')],
      ['leaveGroup', (c) => c.leaveGroup('group-garden')],
      ['proposeFork', (c) => c.proposeFork({ groupId: 'group-garden', kind: 'exit', label: 'L', detail: 'd' })],
      ['consentFork', (c) => c.consentFork('group-garden', 'fork-1')],
      ['welcomeMember', (c) => c.welcomeMember('group-garden')],
      ['dismissGroupSuggestion', (c) => c.dismissGroupSuggestion('group-garden')],
      ['sendGroupMessage', (c) => c.sendGroupMessage('group-garden', 'hi')],
      ['devices', (c) => c.devices()],
      ['addDevice', (c) => c.addDevice('Phone')],
      ['approveDevice', (c) => c.approveDevice('device-x')],
      ['removeDevice', (c) => c.removeDevice('device-x')],
      ['renameDevice', (c) => c.renameDevice('device-1', 'Phone')],
      ['restoreVault', (c) => c.restoreVault()],
      ['signInRole', (c) => c.signInRole('admin')],
      ['adminSchema', (c) => c.adminSchema()],
      ['adminSaveSchema', (c) => c.adminSaveSchema({ version: 3, fields: [] })],
      ['rootCommunities', (c) => c.rootCommunities()],
      ['rootCommunity', (c) => c.rootCommunity('garden-neighbours')],
      ['rootSetSetting', (c) => c.rootSetSetting('garden-neighbours', 'postingPace', 'inherit')],
      ['rootSetAdmin', (c) => c.rootSetAdmin('garden-neighbours', 'admin-1', true)],
    ];
    for (const [action, run] of cases) {
      await expect(run(createDevCmsg({ failActions: [action] })), action).rejects.toThrow('Fixture failure');
    }
  });

  it('ignores unknown failure names and keeps working', async () => {
    const client = createDevCmsg({ failActions: ['no-such-action'] });
    await client.joinWithVoucher(JOIN);
    expect((await client.lobby()).handle).toBe('test-member');
  });

  it('cancels pending wave release and slot timers on disconnect', async () => {
    const client = createDevCmsg({ releaseDelayMs: 20, waveWaitMs: 20 });
    await client.joinWithVoucher(JOIN);
    const { events } = collect(client);
    await client.sendWave('member-ana', 'Hello');
    const [incoming] = await client.incomingWaves();
    await client.closeWave(incoming!.id);
    const count = events.length;
    await client.disconnect();
    await sleep(80);
    expect(events.length).toBe(count + 1);
    expect(events.at(-1)).toMatchObject({ type: 'connection' });
  });
});
