/**
 * DEVELOPMENT ADAPTER ONLY.
 *
 * In-memory `CmsgClient` used solely for UI development and component tests.
 * It simulates connection preload, lobby gates, two-way matching, waves,
 * contacts, threads, groups, devices and admin/root reads with seeded data.
 *
 * NEVER shipped as production behaviour. The real generated client replaces
 * this file without changing components: both implement `CmsgClient`.
 */

import type {
  ChatMessage,
  CmsgClient,
  CmsgEvent,
  CmsgEventHandler,
  ConnectionStatus,
  Contact,
  DeviceInfo,
  DiscoveryFilter,
  GroupView,
  JoinWithVoucherRequest,
  JoinWithVoucherResult,
  KeyRequestResult,
  LobbyState,
  MatchPage,
  MatchRule,
  OwnProfile,
  ProfileSchema,
  ProfileValues,
  PublicCard,
  PublishProfileResult,
  RootCommunity,
  SchemaImpact,
  Thread,
  ValidationIssue,
  Wave,
  WaveSlots,
} from './cmsg.js';

export interface DevAdapterOptions {
  /** Simulated network setup delay in ms. Default 600. */
  connectDelayMs?: number;
  /** When true, connect() reports failure so the UI can show it. */
  failConnect?: boolean;
  /** Waiting period for a sender slot to return, in ms. Default 1500. */
  waveWaitMs?: number;
}

interface SeedMember {
  memberId: string;
  handle: string;
  values: ProfileValues;
  rules: MatchRule[];
  online: boolean;
  record: PublicCard['record'];
}

const SEED_SCHEMA: ProfileSchema = {
  version: 3,
  fields: [
    {
      key: 'age',
      question: 'How old are you?',
      kind: 'number',
      visibility: 'public',
      required: true,
      filterable: true,
      min: 18,
      max: 99,
    },
    {
      key: 'neighbourhood',
      question: 'Which neighbourhood do you live in?',
      kind: 'choice',
      visibility: 'public',
      required: true,
      filterable: true,
      choices: ['North', 'East', 'South', 'West', 'Riverside'],
    },
    {
      key: 'weekend',
      question: 'What does a good weekend look like?',
      kind: 'choice',
      visibility: 'public',
      required: false,
      filterable: true,
      choices: ['Hiking', 'Cooking', 'Music', 'Reading', 'Sport'],
    },
    {
      key: 'lookingFor',
      question: 'Who would you like to meet?',
      kind: 'choice',
      visibility: 'public',
      required: false,
      filterable: false,
      choices: ['Friendship', 'Activity partners', 'Deep talks'],
    },
    {
      key: 'about',
      question: 'Anything else others should know?',
      kind: 'short-text',
      visibility: 'private',
      required: false,
      filterable: false,
    },
  ],
};

const SEED_MEMBERS: SeedMember[] = [
  {
    memberId: 'member-ana',
    handle: 'ana-walks',
    values: { age: 34, neighbourhood: 'North', weekend: 'Hiking', lookingFor: 'Activity partners' },
    rules: [{ field: 'age', min: 25, max: 45 }],
    online: true,
    record: { accepted: 0.7, declined: 0.25, punished: 0.05 },
  },
  {
    memberId: 'member-tom',
    handle: 'tom-cooks',
    values: { age: 41, neighbourhood: 'East', weekend: 'Cooking', lookingFor: 'Friendship' },
    rules: [{ field: 'neighbourhood', equals: ['East', 'North'] }],
    online: true,
    record: null,
  },
  {
    memberId: 'member-rin',
    handle: 'rin-reads',
    values: { age: 29, neighbourhood: 'Riverside', weekend: 'Reading', lookingFor: 'Deep talks' },
    rules: [{ field: 'weekend', equals: ['Reading', 'Music'] }],
    online: true,
    record: { accepted: 0.8, declined: 0.2, punished: 0 },
  },
  {
    memberId: 'member-jo',
    handle: 'jo-runs',
    values: { age: 52, neighbourhood: 'South', weekend: 'Sport', lookingFor: 'Activity partners' },
    rules: [{ field: 'age', min: 40 }],
    online: false,
    record: null,
  },
];

function levelForSize(size: number): GroupView['level'] {
  if (size >= 43) return 'room';
  if (size >= 13) return 'ingroup';
  return 'circle';
}

function whatChangesNext(size: number, level: GroupView['level']): string {
  if (level === 'circle') {
    if (size === 12) return 'One more member asks everyone for consent to become an ingroup.';
    return `At 13 members this circle becomes an ingroup with newcomer consent. (${12 - size} to go.)`;
  }
  if (level === 'ingroup') {
    if (size >= 36) return 'Shrinking to 36 or fewer returns more privacy automatically.';
    if (size === 42) return 'One more member asks everyone for consent to become a public room.';
    return `At 43 members this ingroup may fork into a public room, only with consent. (${43 - size} to go.)`;
  }
  if (size <= 36) return 'At 36 or fewer this room becomes a hidden ingroup automatically.';
  return 'Above 59 members, at most six joins per hour keep the room calm.';
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let waveCounter = 1;
let messageCounter = 1;

export function createDevCmsg(options: DevAdapterOptions = {}): CmsgClient {
  const connectDelayMs = options.connectDelayMs ?? 600;
  const waveWaitMs = options.waveWaitMs ?? 1500;
  const handlers = new Set<CmsgEventHandler>();

  let connection: ConnectionStatus = {
    phase: 'starting',
    progress: 0,
    backend: 'tor',
    message: 'Preparing the network.',
  };
  let joined = false;
  let handle = '';
  let admitted = false;
  let profile: OwnProfile = { values: {}, revision: 0, published: false };
  let rules: MatchRule[] = [];
  let blocked = new Set<string>();
  let relations = new Map<string, Contact['relation']>();
  let waves: Wave[] = [
    {
      id: 'wave-seed-1',
      from: 'member-tom',
      fromHandle: 'tom-cooks',
      to: 'me',
      message: 'Hello! I saw we both like quiet weekends. Would you like to talk?',
      state: 'pending',
      senderSlotHeld: true,
      recipientSlotHeld: true,
    },
  ];
  let threads = new Map<string, Thread>();
  let groups: GroupView[] = [
    {
      id: 'group-garden',
      name: 'Community garden',
      level: 'circle',
      size: 8,
      whatChangesNext: whatChangesNext(8, 'circle'),
      description: 'Neighbours sharing tools, seeds and Saturday mornings.',
      joinConsent: null,
      joined: true,
      newcomerHistory: 'Newcomers start fresh; earlier messages stay with the group.',
      messages: [],
      suggestion: null,
    },
    {
      id: 'group-choir',
      name: 'Evening choir',
      level: 'ingroup',
      size: 24,
      whatChangesNext: whatChangesNext(24, 'ingroup'),
      description: 'A hidden singing group; newcomers hear the last 7 days.',
      joinConsent: null,
      joined: false,
      newcomerHistory: 'Newcomers receive the last 7 days (up to 200 messages).',
      messages: [],
      suggestion: 'This group is growing steadily. A split is not needed yet.',
    },
    {
      id: 'group-market',
      name: 'Saturday market',
      level: 'room',
      size: 67,
      whatChangesNext: whatChangesNext(67, 'room'),
      description: 'The listed meeting place for weekend plans.',
      joinConsent:
        'Members see each other\u2019s private profiles. Joining means consenting to that visibility.',
      joined: false,
      newcomerHistory: 'Newcomers receive the last 24 hours (up to 100 messages).',
      messages: [],
      suggestion: null,
    },
  ];
  let devices: DeviceInfo[] = [
    { id: 'device-1', name: 'My phone', thisDevice: true, addedAt: Date.now() },
  ];
  let pendingDevice: DeviceInfo | null = null;
  let schema: ProfileSchema = structuredClone(SEED_SCHEMA);
  let senderSlots = 3;
  let recipientSlots = 3;

  const emit = (event: CmsgEvent) => {
    for (const handler of handlers) handler(event);
  };

  function lobbyState(): LobbyState {
    return {
      handle,
      gates: [
        {
          id: 'voucher',
          label: 'Invitation voucher',
          detail: 'Checked when you joined.',
          state: 'complete',
        },
        {
          id: 'profile',
          label: 'Profile',
          detail: profile.published
            ? 'Published and checked.'
            : 'Answer the community questions.',
          state: profile.published ? 'complete' : 'action-needed',
        },
      ],
      profileComplete: profile.published,
      devices: [...devices],
      admitted,
      expiryWarning: admitted
        ? null
        : 'Finish joining soon. If registration expires you cannot return to this community.',
    };
  }

  function ruleMatches(value: string | number | boolean | undefined, rule: MatchRule): boolean {
    if (rule.equals && !rule.equals.includes(value as string | number)) return false;
    if (typeof value === 'number') {
      if (rule.min !== undefined && value < rule.min) return false;
      if (rule.max !== undefined && value > rule.max) return false;
    } else if (rule.min !== undefined || rule.max !== undefined) {
      return false;
    }
    return true;
  }

  function pairMatches(
    ownValues: ProfileValues,
    ownRules: MatchRule[],
    otherValues: ProfileValues,
    otherRules: MatchRule[],
  ): boolean {
    for (const rule of ownRules) {
      if (!ruleMatches(otherValues[rule.field], rule)) return false;
    }
    for (const rule of otherRules) {
      if (!ruleMatches(ownValues[rule.field], rule)) return false;
    }
    return true;
  }

  function filterMatches(values: ProfileValues, filters: DiscoveryFilter[]): boolean {
    for (const filter of filters) {
      const value = values[filter.field];
      if (filter.equals && !filter.equals.includes(value as string | number)) return false;
      if (typeof value === 'number') {
        if (filter.min !== undefined && value < filter.min) return false;
        if (filter.max !== undefined && value > filter.max) return false;
      } else if (filter.min !== undefined || filter.max !== undefined) {
        return false;
      }
    }
    return true;
  }

  function visibleMembers(): SeedMember[] {
    return SEED_MEMBERS.filter(
      (member) => member.online && !blocked.has(member.memberId),
    );
  }

  function toCard(member: SeedMember): PublicCard {
    return {
      memberId: member.memberId,
      handle: member.handle,
      values: member.values,
      online: member.online,
      record: member.record,
    };
  }

  function ensureContact(memberId: string, contactHandle: string): Contact {
    const existing = relations.get(memberId);
    return {
      memberId,
      handle: contactHandle,
      relation: existing ?? 'unknown',
      online: SEED_MEMBERS.find((m) => m.memberId === memberId)?.online ?? false,
      blockedByMe: blocked.has(memberId),
    };
  }

  return {
    async connectionStatus() {
      return { ...connection };
    },

    async connect() {
      connection = { phase: 'bootstrapping', progress: 0.3, backend: 'tor', message: 'Starting Tor bootstrap.' };
      emit({ type: 'connection', status: { ...connection } });
      await delay(connectDelayMs / 2);
      connection = { phase: 'publishing', progress: 0.7, backend: 'tor', message: 'Publishing reachability.' };
      emit({ type: 'connection', status: { ...connection } });
      await delay(connectDelayMs / 2);
      if (options.failConnect) {
        connection = { phase: 'failed', progress: 0.7, backend: 'tor', message: 'The network could not be reached. Check the connection and try again.' };
        emit({ type: 'connection', status: { ...connection } });
        return { ...connection };
      }
      connection = { phase: 'ready', progress: 1, backend: 'tor', message: 'Connected.' };
      emit({ type: 'connection', status: { ...connection } });
      return { ...connection };
    },

    async disconnect() {
      connection = { phase: 'starting', progress: 0, backend: 'tor', message: 'Disconnected.' };
      emit({ type: 'connection', status: { ...connection } });
    },

    subscribe(handler: CmsgEventHandler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    async joinWithVoucher(request: JoinWithVoucherRequest) {
      const voucher = request.voucher.trim();
      const name = request.handle.trim();
      if (!voucher.startsWith('VOUCHER-') || voucher.length < 12) {
        throw new Error('This voucher was not accepted. Check the invitation and try again.');
      }
      if (name.length < 8 || name.length > 32) {
        throw new Error('Handles are 8 to 32 characters long.');
      }
      await delay(150);
      joined = true;
      handle = name;
      admitted = true;
      const lobby = lobbyState();
      emit({ type: 'lobby', lobby });
      return { lobby };
    },

    async lobby() {
      if (!joined) throw new Error('Join with a voucher first.');
      return lobbyState();
    },

    async signIn() {
      await delay(150);
      if (!joined) throw new Error('No member on this device yet. Join with a voucher first.');
      return { lobby: lobbyState() };
    },

    async schema() {
      return structuredClone(schema);
    },

    async ownProfile() {
      return structuredClone(profile);
    },

    async ownRules() {
      return structuredClone(rules);
    },

    async saveRules(next: MatchRule[]) {
      rules = structuredClone(next);
    },

    async validateProfile(values: ProfileValues) {
      const issues: ValidationIssue[] = [];
      for (const field of schema.fields) {
        const value = values[field.key];
        if (field.required && (value === undefined || value === '')) {
          issues.push({ field: field.key, message: `${field.question} Answer this question.` });
          continue;
        }
        if (field.kind === 'number' && typeof value === 'number') {
          if (field.min !== undefined && value < field.min) {
            issues.push({ field: field.key, message: `${field.question} Use ${field.min} or more.` });
          }
          if (field.max !== undefined && value > field.max) {
            issues.push({ field: field.key, message: `${field.question} Use ${field.max} or less.` });
          }
        }
        if (field.kind === 'choice' && value !== undefined && value !== '') {
          if (!field.choices?.includes(String(value))) {
            issues.push({ field: field.key, message: `${field.question} Choose one of the offered answers.` });
          }
        }
      }
      return issues;
    },

    async publishProfile(values: ProfileValues) {
      const issues = await this.validateProfile(values);
      if (issues.length > 0) throw new Error(issues[0]?.message ?? 'The profile is not complete yet.');
      await delay(150);
      profile = { values: structuredClone(values), revision: profile.revision + 1, published: true };
      admitted = true;
      emit({ type: 'lobby', lobby: lobbyState() });
      return { profile: structuredClone(profile), pinsSpent: [] };
    },

    async discover(filters: DiscoveryFilter[], cursor?: string | null) {
      if (!admitted) throw new Error('Enter the forum after admission.');
      const start = cursor ? Number(cursor) : 0;
      const matched = visibleMembers().filter(
        (member) =>
          filterMatches(member.values, filters) &&
          pairMatches(profile.values, rules, member.values, member.rules),
      );
      const pageEntries = matched.slice(start, start + 20).map(toCard);
      const next = start + 20 < matched.length ? String(start + 20) : null;
      const page: MatchPage = { entries: pageEntries, cursor: next };
      return page;
    },

    async requestPrivateKey(peer: MemberId) {
      const member = SEED_MEMBERS.find((m) => m.memberId === peer);
      if (!member) throw new Error('This member is not available.');
      // Automatic release by rules only; the requester shares their key first.
      const accepted = pairMatches(profile.values, rules, member.values, member.rules);
      await delay(200);
      const result: KeyRequestResult = accepted
        ? { status: 'accepted' }
        : { status: 'rejected', failingField: 'age' };
      emit({ type: 'key-decision', peer, result });
      return result;
    },

    async waveSlots() {
      return { introductionsAvailable: senderSlots, incomingAvailable: recipientSlots } satisfies WaveSlots;
    },

    async sendWave(to: MemberId, message: string) {
      if (senderSlots < 1) throw new Error('No introductions left right now. Wait for an answer first.');
      const member = SEED_MEMBERS.find((m) => m.memberId === to);
      if (!member || !member.online) throw new Error('First contact needs you both to be online.');
      senderSlots -= 1;
      const wave: Wave = {
        id: `wave-${waveCounter++}`,
        from: 'me',
        fromHandle: handle || 'you',
        to,
        message,
        state: 'pending',
        senderSlotHeld: true,
        recipientSlotHeld: true,
      };
      waves.push(wave);
      return { ...wave };
    },

    async incomingWaves() {
      return waves.filter((wave) => wave.to === 'me').map((wave) => ({ ...wave }));
    },

    async answerWave(id: string, message: string) {
      const wave = waves.find((w) => w.id === id);
      if (!wave || wave.state !== 'pending') throw new Error('This wave is no longer waiting.');
      wave.state = 'answered';
      wave.senderSlotHeld = false;
      wave.recipientSlotHeld = false;
      senderSlots += 1;
      recipientSlots = Math.min(3, recipientSlots + 1);
      relations.set(wave.from, 'established');
      const thread: Thread = {
        id: `thread-${wave.from}`,
        peer: wave.from,
        peerHandle: wave.fromHandle,
        messages: [
          {
            id: `msg-${messageCounter++}`,
            threadId: `thread-${wave.from}`,
            from: wave.from,
            text: wave.message,
            at: Date.now(),
            outgoing: false,
            state: 'received',
          },
          {
            id: `msg-${messageCounter++}`,
            threadId: `thread-${wave.from}`,
            from: 'me',
            text: message,
            at: Date.now(),
            outgoing: true,
            state: 'received',
          },
        ],
        established: true,
      };
      threads.set(wave.from, thread);
      for (const m of thread.messages) emit({ type: 'message', message: { ...m } });
      emit({ type: 'wave-updated', wave: { ...wave } });
      return { ...wave };
    },

    async closeWave(id: string) {
      const wave = waves.find((w) => w.id === id);
      if (!wave || wave.state !== 'pending') throw new Error('This wave is no longer waiting.');
      // Close returns the recipient slot at once; the sender slot follows the waiting period.
      wave.state = 'closed';
      wave.recipientSlotHeld = false;
      recipientSlots = Math.min(3, recipientSlots + 1);
      emit({ type: 'wave-updated', wave: { ...wave } });
      void delay(waveWaitMs).then(() => {
        wave.senderSlotHeld = false;
        senderSlots += 1;
        emit({ type: 'wave-updated', wave: { ...wave } });
      });
      return { ...wave };
    },

    async punishWave(id: string) {
      const wave = waves.find((w) => w.id === id);
      if (!wave || wave.state !== 'pending') throw new Error('This wave is no longer waiting.');
      // Punish burns both slots and blocks the sender.
      wave.state = 'punished';
      wave.senderSlotHeld = false;
      wave.recipientSlotHeld = false;
      blocked.add(wave.from);
      relations.set(wave.from, 'blocked');
      emit({ type: 'wave-updated', wave: { ...wave } });
      return { ...wave };
    },

    async contacts() {
      const known = new Map<string, string>();
      for (const [memberId] of relations) {
        const member = SEED_MEMBERS.find((m) => m.memberId === memberId);
        if (member) known.set(memberId, member.handle);
      }
      for (const thread of threads.values()) known.set(thread.peer, thread.peerHandle);
      return [...known].map(([memberId, contactHandle]) => ensureContact(memberId, contactHandle));
    },

    async blockMember(peer: MemberId) {
      blocked.add(peer);
      relations.set(peer, 'blocked');
      emit({
        type: 'contacts',
        contacts: await this.contacts(),
      });
    },

    async unblockMember(peer: MemberId) {
      blocked.delete(peer);
      if (relations.get(peer) === 'blocked') relations.set(peer, 'closed');
      emit({
        type: 'contacts',
        contacts: await this.contacts(),
      });
    },

    async threads() {
      return [...threads.values()].map((thread) => structuredClone(thread));
    },

    async thread(peer: MemberId) {
      const existing = threads.get(peer);
      if (existing) return structuredClone(existing);
      const member = SEED_MEMBERS.find((m) => m.memberId === peer);
      const created: Thread = {
        id: `thread-${peer}`,
        peer,
        peerHandle: member?.handle ?? peer,
        messages: [],
        established: relations.get(peer) === 'established',
      };
      threads.set(peer, created);
      return structuredClone(created);
    },

    async sendMessage(peer: MemberId, text: string) {
      const thread = await this.thread(peer);
      const message: ChatMessage = {
        id: `msg-${messageCounter++}`,
        threadId: thread.id,
        from: 'me',
        text,
        at: Date.now(),
        outgoing: true,
        state: connection.phase === 'ready' ? 'stored' : 'queued',
      };
      thread.messages.push(message);
      threads.set(peer, thread);
      emit({ type: 'message', message: { ...message } });
      return { ...message };
    },

    async groups() {
      return groups.map((group) => structuredClone({ ...group, messages: group.messages }));
    },

    async joinGroup(id: string) {
      const group = groups.find((g) => g.id === id);
      if (!group) throw new Error('This group is not available.');
      group.joined = true;
      group.size += 1;
      group.level = levelForSize(group.size);
      group.whatChangesNext = whatChangesNext(group.size, group.level);
      emit({ type: 'groups', groups: await this.groups() });
      return structuredClone(group);
    },

    async leaveGroup(id: string) {
      const group = groups.find((g) => g.id === id);
      if (!group) throw new Error('This group is not available.');
      group.joined = false;
      group.size = Math.max(3, group.size - 1);
      group.level = levelForSize(group.size);
      group.whatChangesNext = whatChangesNext(group.size, group.level);
      emit({ type: 'groups', groups: await this.groups() });
    },

    async proposeFork(proposal) {
      const group = groups.find((g) => g.id === proposal.groupId);
      if (!group) throw new Error('This group is not available.');
      const fork: GroupView = {
        ...structuredClone(group),
        id: `${group.id}-fork-${Date.now()}`,
        name: `${group.name} (fork)`,
        size: 3,
        level: 'circle',
        whatChangesNext: whatChangesNext(3, 'circle'),
        joined: true,
        messages: [],
        suggestion: 'A quiet transition line marks where the fork began. Earlier history stays with you.',
      };
      groups.push(fork);
      emit({ type: 'groups', groups: await this.groups() });
      return structuredClone(fork);
    },

    async sendGroupMessage(id: string, text: string) {
      const group = groups.find((g) => g.id === id);
      if (!group || !group.joined) throw new Error('Join the group before writing.');
      const message: ChatMessage = {
        id: `msg-${messageCounter++}`,
        threadId: id,
        from: 'me',
        text,
        at: Date.now(),
        outgoing: true,
        state: connection.phase === 'ready' ? 'stored' : 'queued',
      };
      group.messages.push(message);
      emit({ type: 'message', message: { ...message } });
      return { ...message };
    },

    async devices() {
      return [...devices, ...(pendingDevice ? [pendingDevice] : [])].map((device) => ({ ...device }));
    },

    async addDevice(name: string) {
      const clean = name.trim();
      if (!clean) throw new Error('Give the device a name first.');
      pendingDevice = { id: `device-${Date.now()}`, name: clean, thisDevice: false, addedAt: Date.now() };
      emit({ type: 'devices', devices: await this.devices() });
      return { ...pendingDevice };
    },

    async approveDevice(id: string) {
      if (pendingDevice?.id !== id) throw new Error('This device request is not waiting.');
      const approved = { ...pendingDevice };
      devices.push(approved);
      pendingDevice = null;
      emit({ type: 'devices', devices: await this.devices() });
      return approved;
    },

    async removeDevice(id: string) {
      // Removing a device rotates keys and starts a new epoch on real clients.
      devices = devices.filter((device) => device.id !== id || device.thisDevice);
      if (pendingDevice?.id === id) pendingDevice = null;
      emit({ type: 'devices', devices: await this.devices() });
    },

    async adminSchema() {
      return structuredClone(schema);
    },

    async adminSaveSchema(next: ProfileSchema) {
      schema = structuredClone(next);
      schema.version += 1;
      const impact: SchemaImpact = {
        profilesNeedingChanges: 2,
        grandfathered: 0,
        note: 'Hidden or removed public fields stop matching at once. Loosened fields need no action.',
      };
      return impact;
    },

    async rootCommunities() {
      const communities: RootCommunity[] = [
        { communityId: 'garden-neighbours', displayName: 'Garden neighbours' },
        { communityId: 'evening-choir', displayName: 'Evening choir' },
      ];
      return communities;
    },
  };
}
