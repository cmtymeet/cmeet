/**
 * DEVELOPMENT ADAPTER ONLY.
 *
 * In-memory `CmsgClient` used solely for UI development and component tests.
 * It simulates connection preload, lobby gates, two-way matching, waves,
 * contacts, threads, groups, devices and admin/root reads with seeded data.
 *
 * NEVER shipped as production behaviour. The real generated client replaces
 * this file without changing components: both implement `CmsgClient`.
 *
 * Temporary handwritten presentation port; these deterministic fixtures are
 * not an implementation of production admission, cryptography or transport.
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
  ForkView,
  GroupView,
  GroupForkProposal,
  JoinWithVoucherRequest,
  JoinWithVoucherResult,
  KeyRequestResult,
  LobbyState,
  LocationValue,
  MatchPage,
  MatchRule,
  MemberId,
  OwnProfile,
  ProfileExchange,
  ProfileSchema,
  ProfileValues,
  PublicCard,
  PublishProfileResult,
  RestoreView,
  RootCommunity,
  RootCommunityView,
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
  /** Deterministic vault restore outcome. Default 'ready'. */
  restoreState?: RestoreView['state'];
  /** Forum page size. Default 20. */
  pageSize?: number;
  /** Explicit fixture failures, e.g. ['sendWave', 'adminSaveSchema']. Never production. */
  failActions?: string[];
  gateState?: 'complete' | 'action-needed' | 'waiting';
  messageState?: ChatMessage['state'];
  incomingReleaseState?: 'reserved' | 'released';
  releaseDelayMs?: number;
  groups?: GroupView[];
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
    {
      key: 'location',
      question: 'Where do you usually meet?',
      kind: 'location',
      visibility: 'public',
      required: false,
      filterable: true,
    },
  ],
};

const ZURICH: LocationValue = { latitude: 47.3769, longitude: 8.5417 };
const ZURICH_NEAR: LocationValue = { latitude: 47.3775, longitude: 8.5425 };
const FAR_AWAY: LocationValue = { latitude: 40.7128, longitude: -74.006 };

const SEED_MEMBERS: SeedMember[] = [
  {
    memberId: 'member-ana',
    handle: 'ana-walks',
    values: {
      age: 34,
      neighbourhood: 'North',
      weekend: 'Hiking',
      lookingFor: 'Activity partners',
      location: ZURICH,
    },
    rules: [{ field: 'age', min: 25, max: 45 }],
    online: true,
    record: { accepted: 0.7, declined: 0.25, punished: 0.05 },
  },
  {
    memberId: 'member-tom',
    handle: 'tom-cooks',
    values: {
      age: 41,
      neighbourhood: 'East',
      weekend: 'Cooking',
      lookingFor: 'Friendship',
      location: ZURICH_NEAR,
    },
    rules: [{ field: 'neighbourhood', equals: ['East', 'North'] }],
    online: true,
    record: null,
  },
  {
    memberId: 'member-rin',
    handle: 'rin-reads',
    values: {
      age: 29,
      neighbourhood: 'Riverside',
      weekend: 'Reading',
      lookingFor: 'Deep talks',
      location: FAR_AWAY,
    },
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

function isLocation(value: unknown): value is LocationValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LocationValue).latitude === 'number' &&
    typeof (value as LocationValue).longitude === 'number'
  );
}

function haversineKm(a: LocationValue, b: LocationValue): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthKm * Math.asin(Math.sqrt(h));
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const RESTORE_MESSAGES: Record<RestoreView['state'], string> = {
  ready: 'A recoverable vault copy is available on a surviving replica.',
  unavailable: 'No vault replica answered. Missing replicas stay visible as a failure.',
  unrecoverable: 'No recoverable device or network copy remains. Identity and data cannot be restored by any enrolled passkey; there is no operator recovery.',
  locked: 'The vault is locked. Sign in with your passkey to continue.',
};

export function createDevCmsg(options: DevAdapterOptions = {}): CmsgClient {
  let waveCounter = 1, messageCounter = 1, forkCounter = 1, exchangeCounter = 1;
  let gateState = options.gateState ?? 'complete';
  let connectionGeneration = 0;
  const connectDelayMs = options.connectDelayMs ?? 600;
  const waveWaitMs = options.waveWaitMs ?? 1500;
  const pageSize = options.pageSize ?? 20;
  const failActions = new Set(options.failActions ?? []);
  const handlers = new Set<CmsgEventHandler>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const failIf = (action: string) => {
    if (failActions.has(action)) throw new Error(`Fixture failure for ${action}.`);
  };

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
  const roles = new Set<'admin' | 'root'>();
  let waves: Wave[] = [
    {
      id: 'wave-seed-1',
      from: 'member-tom',
      fromHandle: 'tom-cooks',
      to: 'me',
      message: options.incomingReleaseState === 'reserved' ? '' : 'Hello! I saw we both like quiet weekends. Would you like to talk?',
      state: 'pending',
      senderSlotHeld: true,
      recipientSlotHeld: true,
      releaseState: options.incomingReleaseState ?? 'released',
    },
  ];
  let threads = new Map<string, Thread>();
  let exchanges: ProfileExchange[] = [
    {
      id: 'exchange-seed-1',
      peer: 'member-ana',
      handle: 'ana-walks',
      direction: 'incoming',
      result: { status: 'accepted' },
    },
  ];
  let groups: GroupView[] = [
    {
      id: 'group-garden',
      name: 'Community garden',
      level: 'circle',
      size: 8,
      whatChangesNext: 'At 13 members, a consented fork can become an Ingroup.',
      description: 'Neighbours sharing tools, seeds and Saturday mornings.',
      joinConsent: null,
      joined: true,
      newcomerHistory: 'Newcomers start fresh; earlier messages stay with the group.',
      messages: [],
      suggestion: null,
      band: {
        notifications: 'Every message, with quiet hours respected.',
        postingPace: '90 messages per hour; burst of 15.',
        joining: 'Invitation through an own contact; movers consent to a fork.',
      },
      lineage: ['garden-neighbours'],
      seatBudget: { enabled: false, label: 'No seat budget in this circle.' },
      members: [
        { id: 'member-ana', handle: 'ana-walks' },
        { id: 'member-tom', handle: 'tom-cooks' },
      ],
      forks: [],
    },
    {
      id: 'group-choir',
      name: 'Evening choir',
      level: 'ingroup',
      size: 24,
      whatChangesNext: 'An opening fork can gather consent to become a public room.',
      description: 'A hidden singing group; newcomers hear the last 7 days.',
      joinConsent: null,
      joined: false,
      newcomerHistory: 'Newcomers receive the last 7 days (up to 200 messages).',
      messages: [],
      suggestion: 'This group is growing steadily. A split is not needed yet.',
      band: {
        notifications: 'Mentions and replies; a digest every 3 hours.',
        postingPace: '30 messages per hour; burst of 8.',
        joining: 'One vouch from a member who has the joiner as a contact.',
      },
      forks: [],
    },
    {
      id: 'group-market',
      name: 'Saturday market',
      level: 'room',
      size: 67,
      whatChangesNext: 'At 36 or fewer members, this room becomes a hidden Ingroup.',
      description: 'The listed meeting place for weekend plans.',
      joinConsent:
        'Members see each other\u2019s private profiles. Joining means consenting to that visibility.',
      joined: false,
      newcomerHistory: 'Newcomers receive the last 12 hours (up to 50 messages).',
      messages: [],
      suggestion: null,
      band: {
        notifications: 'Mentions only; a daily digest.',
        postingPace: '12 messages per hour; burst of 4.',
        joining: 'Explicit visibility consent; at most 6 joins per hour.',
      },
      forks: [],
    },
    {
      id: 'group-opening',
      name: 'Newcomers opening',
      level: 'opening',
      size: 28,
      whatChangesNext: 'Reach 43 within 21 days to become public; otherwise return to a hidden Ingroup.',
      description: 'A consented public fork gathering members before its opening deadline.',
      joinConsent: "Members see each other's private profiles. Joining means consenting to that visibility.",
      joined: false,
      newcomerHistory: 'History starts when the group opens.',
      messages: [],
      suggestion: 'Invite people who would enjoy this conversation.',
      opening: { progress: '28 of 43 members.', deadlineLabel: 'Opening window: 21 days.' },
      welcomePrompt: 'Welcome! Say hello and tell the group one weekend habit.',
      members: [],
      forks: [],
    },
  ];
  if (options.groups) groups = structuredClone(options.groups);
  const proposals = new Map<string, GroupForkProposal>();
  const consentedForks = new Map<string, GroupView>();
  let devices: DeviceInfo[] = [
    { id: 'device-1', name: 'My phone', thisDevice: true, addedAt: Date.now(), state: 'active' },
  ];
  let pendingDevice: DeviceInfo | null = null;
  let schema: ProfileSchema = structuredClone(SEED_SCHEMA);
  let senderSlots = 3;
  let recipientSlots = 3;
  const rootViews = new Map<string, RootCommunityView>([
    [
      'garden-neighbours',
      {
        communityId: 'garden-neighbours',
        settings: [
          {
            key: 'postingPace',
            label: 'Posting pace',
            effectiveValue: 'slow',
            overrideValue: null,
            inherited: true,
            editable: true,
            help: 'How often members may post.',
          },
          {
            key: 'joining',
            label: 'Joining',
            effectiveValue: 'consent',
            overrideValue: null,
            inherited: true,
            editable: false,
            help: 'Managed by the platform.',
          },
        ],
        admins: [{ id: 'admin-1', label: 'Garden admin' }],
      },
    ],
    [
      'evening-choir',
      {
        communityId: 'evening-choir',
        settings: [
          {
            key: 'postingPace',
            label: 'Posting pace',
            effectiveValue: 'weekly',
            overrideValue: null,
            inherited: true,
            editable: true,
            help: 'How often members may post.',
          },
        ],
        admins: [],
      },
    ],
  ]);

  const rootDefaults = structuredClone(rootViews);
  const emit = (event: CmsgEvent) => {
    for (const handler of handlers) handler(structuredClone(event));
  };

  function lobbyState(): LobbyState {
    return {
      handle,
      gates: [
        {
          id: 'voucher',
          label: 'Invitation voucher',
          detail: 'Checked when you joined.',
          state: gateState,
          action: gateState === 'action-needed' ? { label: 'Check voucher', inputLabel: 'Invitation voucher' } : undefined,
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
      devices: structuredClone(devices),
      admitted,
      expiryWarning: admitted
        ? null
        : 'Finish joining soon. If registration expires you cannot return to this community.',
    };
  }

  function ruleMatches(
    value: string | number | boolean | LocationValue | undefined,
    rule: MatchRule,
    ownValue: string | number | boolean | LocationValue | undefined,
  ): boolean {
    if (rule.maxDistanceKm !== undefined) {
      if (!isLocation(value) || !isLocation(ownValue)) return false;
      return haversineKm(ownValue, value) <= rule.maxDistanceKm;
    }
    if (isLocation(value)) return true;
    if (rule.equals && !rule.equals.includes(value as string | number | boolean)) return false;
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
      if (!ruleMatches(otherValues[rule.field], rule, ownValues[rule.field])) return false;
    }
    for (const rule of otherRules) {
      if (!ruleMatches(ownValues[rule.field], rule, otherValues[rule.field])) return false;
    }
    return true;
  }

  function filterMatches(values: ProfileValues, filters: DiscoveryFilter[], ownValues: ProfileValues): boolean {
    for (const filter of filters) {
      const value = values[filter.field];
      const ownValue = ownValues[filter.field];
      if (filter.maxDistanceKm !== undefined) {
        if (!isLocation(value) || !isLocation(ownValue)) return false;
        if (haversineKm(ownValue, value) > filter.maxDistanceKm) return false;
        continue;
      }
      if (isLocation(value)) continue;
      if (filter.equals && !filter.equals.includes(value as string | number | boolean)) return false;
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
      values: structuredClone(Object.fromEntries(Object.entries(member.values).filter(([key]) => schema.fields.some(field => field.key === key && field.visibility === 'public')))),
      online: member.online,
      record: structuredClone(member.record),
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

  function ensureThread(peer: MemberId, peerHandle: string): Thread {
    const existing = threads.get(peer);
    if (existing) return existing;
    const created: Thread = {
      id: `thread-${peer}`,
      peer,
      peerHandle,
      messages: [],
      established: relations.get(peer) === 'established',
      state:
        relations.get(peer) === 'blocked'
          ? 'blocked'
          : relations.get(peer) === 'closed'
            ? 'closed'
            : 'active',
    };
    threads.set(peer, created);
    return created;
  }

  function requireRoot() {
    if (!roles.has('root')) {
      throw new Error('Sign in with your passkey as root first.');
    }
  }

  return {
    async connectionStatus() {
      failIf('connectionStatus');
      return { ...connection };
    },

    async connect() {
      failIf('connect');
      const generation = ++connectionGeneration;
      connection = { phase: 'bootstrapping', progress: 0.3, backend: 'tor', message: 'Starting Tor bootstrap.' };
      emit({ type: 'connection', status: { ...connection } });
      await delay(connectDelayMs / 2);
      if (generation !== connectionGeneration) return { ...connection };
      connection = { phase: 'publishing', progress: 0.7, backend: 'tor', message: 'Publishing reachability.' };
      emit({ type: 'connection', status: { ...connection } });
      await delay(connectDelayMs / 2);
      if (generation !== connectionGeneration) return { ...connection };
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
      failIf('disconnect');
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      ++connectionGeneration;
      connection = { phase: 'starting', progress: 0, backend: 'tor', message: 'Disconnected.' };
      emit({ type: 'connection', status: connection });
      handlers.clear();
      roles.clear();
    },

    subscribe(handler: CmsgEventHandler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    async joinWithVoucher(request: JoinWithVoucherRequest) {
      failIf('joinWithVoucher');
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
      // Registered but not admitted: the profile gate is still open.
      admitted = false;
      const lobby = lobbyState();
      emit({ type: 'lobby', lobby });
      return { lobby };
    },

    async lobby() {
      failIf('lobby');
      if (!joined) throw new Error('Join with a voucher first.');
      return lobbyState();
    },

    async signIn() {
      failIf('signIn');
      await delay(150);
      if (!joined) throw new Error('No member on this device yet. Join with a voucher first.');
      return { lobby: lobbyState() };
    },

    async completeGate(id: string, input: string) {
      failIf('completeGate');
      if (!joined) throw new Error('Join with a voucher first.');
      if (id !== 'voucher') throw new Error('This step is not available.');
      if (gateState !== 'action-needed') throw new Error('This step is not waiting for input.');
      if (input !== 'VOUCHER-TEST-123') throw new Error('This voucher was not accepted.');
      gateState = 'complete';
      admitted = profile.published;
      const lobby = lobbyState();
      emit({ type: 'lobby', lobby });
      return lobby;
    },

    async schema() {
      failIf('schema');
      return structuredClone(schema);
    },

    async ownProfile() {
      failIf('ownProfile');
      return structuredClone(profile);
    },

    async ownRules() {
      failIf('ownRules');
      return structuredClone(rules);
    },

    async saveRules(next: MatchRule[]) {
      failIf('saveRules');
      rules = structuredClone(next);
    },

    async validateProfile(values: ProfileValues) {
      failIf('validateProfile');
      const issues: ValidationIssue[] = [];
      for (const field of schema.fields) {
        const value = values[field.key];
        if (field.required && (value === undefined || value === '')) {
          issues.push({ field: field.key, message: `${field.question} Answer this question.` });
          continue;
        }
        if (value !== undefined && field.kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
          issues.push({ field: field.key, message: 'Enter a finite number.' });
        }
        if (field.kind === 'yes-no' && value !== undefined && typeof value !== 'boolean') issues.push({ field: field.key, message: 'Choose Yes or No.' });
        if ((field.kind === 'short-text' || field.kind === 'long-text') && value !== undefined && typeof value !== 'string') issues.push({field: field.key, message: 'Enter text.'});
        if (field.kind === 'number' && typeof value === 'number') {
          if (field.min !== undefined && value < field.min) {
            issues.push({ field: field.key, message: `${field.question} Use ${field.min} or more.` });
          }
          if (field.max !== undefined && value > field.max) {
            issues.push({ field: field.key, message: `${field.question} Use ${field.max} or less.` });
          }
        }
        if (field.kind === 'choice' && value !== undefined && value !== '') {
          if (typeof value === 'object') {
            issues.push({ field: field.key, message: `${field.question} Choose one of the offered answers.` });
          } else if (!field.choices?.includes(String(value))) {
            issues.push({ field: field.key, message: `${field.question} Choose one of the offered answers.` });
          }
        }
        if (field.kind === 'location' && value !== undefined) {
          if (!isLocation(value) || !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) || Math.abs(value.latitude) > 90 || Math.abs(value.longitude) > 180) {
            issues.push({ field: field.key, message: `${field.question} Enter valid latitude and longitude.` });
          }
        }
      }
      return issues;
    },

    async publishProfile(values: ProfileValues) {
      failIf('publishProfile');
      const issues = await this.validateProfile(values);
      if (issues.length > 0) throw new Error(issues[0]?.message ?? 'The profile is not complete yet.');
      await delay(150);
      profile = { values: structuredClone(values), revision: profile.revision + 1, published: true };
      admitted = gateState === 'complete';
      emit({ type: 'lobby', lobby: lobbyState() });
      return { profile: structuredClone(profile), pinsSpent: [] };
    },

    async discover(filters: DiscoveryFilter[], cursor?: string | null) {
      failIf('discover');
      if (!admitted) throw new Error('Enter the forum after admission.');
      const start = cursor ? Number(cursor) : 0;
      const matched = visibleMembers().filter(
        (member) =>
          filterMatches(member.values, filters, profile.values) &&
          pairMatches(profile.values, rules, member.values, member.rules),
      );
      const pageEntries = matched.slice(start, start + pageSize).map(toCard);
      const next = start + pageSize < matched.length ? String(start + pageSize) : null;
      const page: MatchPage = { entries: pageEntries, cursor: next };
      return page;
    },

    async requestPrivateKey(peer: MemberId) {
      failIf('requestPrivateKey');
      const member = SEED_MEMBERS.find((m) => m.memberId === peer);
      if (!member || !member.online || blocked.has(peer)) throw new Error('This member is not available.');
      // Automatic release by rules only; the requester shares their key first.
      const accepted = pairMatches(profile.values, rules, member.values, member.rules);
      await delay(200);
      const result: KeyRequestResult = accepted
        ? {
            status: 'accepted',
            profile: { schema: structuredClone(schema), values: structuredClone(member.values) },
          }
        : { status: 'rejected', failingField: (rules.find(rule => !ruleMatches(member.values[rule.field], rule, profile.values[rule.field])) ?? member.rules.find(rule => !ruleMatches(profile.values[rule.field], rule, member.values[rule.field])))!.field };
      const exchange: ProfileExchange = {
        id: `exchange-${exchangeCounter++}`,
        peer,
        handle: member.handle,
        direction: 'outgoing',
        result: structuredClone(result),
      };
      exchanges.push(exchange);
      emit({ type: 'key-decision', peer, result });
      return result;
    },

    async profileExchanges() {
      failIf('profileExchanges');
      return structuredClone(exchanges);
    },

    async waveSlots() {
      failIf('waveSlots');
      return { introductionsAvailable: senderSlots, incomingAvailable: recipientSlots } satisfies WaveSlots;
    },

    async sendWave(to: MemberId, message: string) {
      failIf('sendWave');
      if (blocked.has(to)) throw new Error('This conversation is blocked.');
      if (!message.trim()) throw new Error('Write a message first.');
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
        releaseState: 'reserved',
        reason: 'Waiting for fixture release.',
      };
      waves.push(wave);
      const timer = setTimeout(() => {
        timers.delete(timer);
        wave.releaseState = 'released';
        wave.reason = 'The introduction was released.';
        emit({ type: 'wave-updated', wave });
      }, options.releaseDelayMs ?? 400);
      timers.add(timer);
      return { ...wave };
    },

    async incomingWaves() {
      failIf('incomingWaves');
      return waves.filter((wave) => wave.to === 'me').map((wave) => ({ ...wave }));
    },

    async answerWave(id: string, message: string) {
      failIf('answerWave');
      const wave = waves.find((w) => w.id === id);
      if (!wave || wave.state !== 'pending') throw new Error('This wave is no longer waiting.');
      if (wave.releaseState !== 'released' || wave.to !== 'me') throw new Error('This introduction is not released for you.');
      if (!message.trim()) throw new Error('Write a reply first.');
      if (blocked.has(wave.from)) throw new Error('This conversation is blocked.');
      wave.state = 'answered';
      wave.reason = 'Your reply opened the conversation.';
      wave.releaseState = 'released';
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
        state: 'active',
      };
      threads.set(wave.from, thread);
      for (const m of thread.messages) emit({ type: 'message', message: { ...m } });
      emit({ type: 'wave-updated', wave: { ...wave } });
      return { ...wave };
    },

    async closeWave(id: string) {
      failIf('closeWave');
      const wave = waves.find((w) => w.id === id);
      if (!wave || wave.state !== 'pending') throw new Error('This wave is no longer waiting.');
      if (wave.to !== 'me' || wave.releaseState !== 'released') throw new Error('This introduction is not released for you.');
      // Close returns the recipient slot at once; the sender slot follows the waiting period.
      wave.state = 'closed';
      wave.reason = 'Closed without a reply. The sender waits for their introduction slot.';
      wave.recipientSlotHeld = false;
      recipientSlots = Math.min(3, recipientSlots + 1);
      emit({ type: 'wave-updated', wave: { ...wave } });
      const timer = setTimeout(() => {
        wave.senderSlotHeld = false;
        senderSlots += 1;
        timers.delete(timer);
        emit({ type: 'wave-updated', wave: { ...wave } });
      }, waveWaitMs);
      timers.add(timer);
      return { ...wave };
    },

    async punishWave(id: string) {
      failIf('punishWave');
      const wave = waves.find((w) => w.id === id);
      if (!wave || wave.state !== 'pending') throw new Error('This wave is no longer waiting.');
      if (wave.to !== 'me' || wave.releaseState !== 'released') throw new Error('This introduction is not released for you.');
      // Punish burns both slots and blocks the sender.
      wave.state = 'punished';
      wave.reason = 'Punished and blocked. Both slots were spent.';
      wave.senderSlotHeld = false;
      wave.recipientSlotHeld = false;
      blocked.add(wave.from);
      relations.set(wave.from, 'blocked');
      const existing = threads.get(wave.from);
      if (existing) {
        existing.established = false;
        existing.state = 'blocked';
        threads.set(wave.from, existing);
      }
      emit({ type: 'wave-updated', wave: { ...wave } });
      return { ...wave };
    },

    async contacts() {
      failIf('contacts');
      const known = new Map<string, string>();
      for (const [memberId] of relations) {
        const member = SEED_MEMBERS.find((m) => m.memberId === memberId);
        if (member) known.set(memberId, member.handle);
      }
      for (const thread of threads.values()) known.set(thread.peer, thread.peerHandle);
      return [...known].map(([memberId, contactHandle]) => ensureContact(memberId, contactHandle));
    },

    async blockMember(peer: MemberId) {
      failIf('blockMember');
      blocked.add(peer);
      relations.set(peer, 'blocked');
      const existing = threads.get(peer);
      if (existing) {
        existing.established = false;
        existing.state = 'blocked';
        threads.set(peer, existing);
      }
      emit({
        type: 'contacts',
        contacts: await this.contacts(),
      });
    },

    async unblockMember(peer: MemberId) {
      failIf('unblockMember');
      blocked.delete(peer);
      if (relations.get(peer) === 'blocked') relations.set(peer, 'closed');
      const existing = threads.get(peer);
      if (existing) {
        existing.established = false;
        existing.state = 'closed';
        threads.set(peer, existing);
      }
      emit({
        type: 'contacts',
        contacts: await this.contacts(),
      });
    },

    async threads() {
      failIf('threads');
      return [...threads.values()].map((thread) => structuredClone(thread));
    },

    async thread(peer: MemberId) {
      failIf('thread');
      const existing = threads.get(peer);
      if (existing) return structuredClone(existing);
      const member = SEED_MEMBERS.find((m) => m.memberId === peer);
      if (!member) throw new Error('This member is not available.');
      const created = ensureThread(peer, member.handle);
      return structuredClone(created);
    },

    async sendMessage(peer: MemberId, text: string) {
      failIf('sendMessage');
      const thread = ensureThread(peer, SEED_MEMBERS.find((m) => m.memberId === peer)?.handle ?? peer);
      if (thread.state !== 'active' || !thread.established) throw new Error('This conversation is not open.');
      if (!text.trim()) throw new Error('Write a message first.');
      const message: ChatMessage = {
        id: `msg-${messageCounter++}`,
        threadId: thread.id,
        from: 'me',
        text,
        at: Date.now(),
        outgoing: true,
        state: options.messageState ?? (connection.phase === 'ready' ? 'stored' : 'queued'),
      };
      thread.messages.push(message);
      threads.set(peer, thread);
      emit({ type: 'message', message: { ...message } });
      return { ...message };
    },

    async closeConversation(peer: MemberId) {
      failIf('closeConversation');
      relations.set(peer, 'closed');
      const member = SEED_MEMBERS.find((m) => m.memberId === peer);
      const thread = ensureThread(peer, member?.handle ?? peer);
      thread.established = false;
      thread.state = 'closed';
      threads.set(peer, thread);
      emit({ type: 'contacts', contacts: await this.contacts() });
    },

    async punishConversation(peer: MemberId) {
      failIf('punishConversation');
      blocked.add(peer);
      relations.set(peer, 'blocked');
      const member = SEED_MEMBERS.find((m) => m.memberId === peer);
      const thread = ensureThread(peer, member?.handle ?? peer);
      thread.established = false;
      thread.state = 'blocked';
      threads.set(peer, thread);
      emit({ type: 'contacts', contacts: await this.contacts() });
    },

    async requestReopen(peer: MemberId) {
      failIf('requestReopen');
      const relation = relations.get(peer);
      if (relation !== 'closed') throw new Error('Reopening needs a closed conversation first.');
      const member = SEED_MEMBERS.find((m) => m.memberId === peer);
      const thread = ensureThread(peer, member?.handle ?? peer);
      // Explicit request only; never unilaterally established.
      thread.established = false;
      thread.state = 'reopen-pending';
      relations.set(peer, 'pending');
      threads.set(peer, thread);
      emit({ type: 'contacts', contacts: await this.contacts() });
    },

    async groups() {
      failIf('groups');
      return groups.map((group) => structuredClone({ ...group, messages: group.messages }));
    },

    async joinGroup(id: string, consent?: boolean) {
      failIf('joinGroup');
      const group = groups.find((g) => g.id === id);
      if (!group) throw new Error('This group is not available.');
      if (group.joinConsent && consent !== true) {
        throw new Error('Joining needs your explicit consent.');
      }
      if (!group.joined) group.size += 1;
      group.joined = true;
      emit({ type: 'groups', groups: await this.groups() });
      return structuredClone(group);
    },

    async leaveGroup(id: string) {
      failIf('leaveGroup');
      const group = groups.find((g) => g.id === id);
      if (!group) throw new Error('This group is not available.');
      if (group.joined) group.size -= 1;
      group.joined = false;
      emit({ type: 'groups', groups: await this.groups() });
    },

    async proposeFork(proposal) {
      failIf('proposeFork');
      const group = groups.find((g) => g.id === proposal.groupId);
      if (!group) throw new Error('This group is not available.');
      if (!proposal.label.trim()) throw new Error('Describe the fork first.');
      const forkId = `${group.id}-fork-${forkCounter++}`;
      const view: ForkView = {
        id: forkId,
        label: proposal.label,
        detail: proposal.detail,
        proposedRoster: proposal.memberIds ? [...proposal.memberIds] : [],
        consented: false,
      };
      proposals.set(forkId, structuredClone(proposal));
      group.forks = [...(group.forks ?? []), view];
      emit({ type: 'groups', groups: await this.groups() });
      return structuredClone(group);
    },

    async consentFork(groupId: string, forkId: string) {
      failIf('consentFork');
      const group = groups.find((g) => g.id === groupId);
      if (!group) throw new Error('This group is not available.');
      const forks = group.forks ?? [];
      const fork = forks.find((f) => f.id === forkId);
      if (!fork) throw new Error('This fork proposal is not available.');
      const existing = consentedForks.get(forkId);
      if (existing) return structuredClone(existing);
      fork.consented = true;
      const next: GroupView = { ...structuredClone(group), id: forkId, name: fork.label,
        lineage: [...(group.lineage ?? []), group.name], forks: [], joined: true };
      // Explicit fixture outcome for the opening journey, not a size algorithm.
      if (proposals.get(forkId)?.kind === 'open') {
        next.level = 'opening';
        next.opening = { progress: '28 of 43 members.', deadlineLabel: 'Opening window: 21 days.' };
        next.whatChangesNext = 'Reach 43 within 21 days to become public; otherwise return to a hidden Ingroup.';
        next.joinConsent = "Members see each other's private profiles. Joining means consenting to that visibility.";
      }
      consentedForks.set(forkId, next);
      groups.push(next);
      emit({ type: 'groups', groups: await this.groups() });
      return structuredClone(next);
    },

    async welcomeMember(groupId: string) {
      failIf('welcomeMember');
      const group = groups.find((g) => g.id === groupId);
      if (!group) throw new Error('This group is not available.');
      if (!group.joined) throw new Error('Join the group before welcoming.');
      return `Welcome to ${group.name}!`;
    },

    async dismissGroupSuggestion(groupId: string) {
      failIf('dismissGroupSuggestion');
      const group = groups.find((g) => g.id === groupId);
      if (!group) throw new Error('This group is not available.');
      group.suggestion = null;
      emit({ type: 'groups', groups: await this.groups() });
    },

    async sendGroupMessage(id: string, text: string) {
      failIf('sendGroupMessage');
      const group = groups.find((g) => g.id === id);
      if (!group || !group.joined) throw new Error('Join the group before writing.');
      if (!text.trim()) throw new Error('Write a message first.');
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
      failIf('devices');
      return [...devices, ...(pendingDevice ? [pendingDevice] : [])].map((device) => ({ ...device }));
    },

    async addDevice(name: string) {
      failIf('addDevice');
      const clean = name.trim();
      if (!clean) throw new Error('Give the device a name first.');
      if (pendingDevice) throw new Error('Review the pending device first.');
      // Pending only; a separate explicit approveDevice call enrolls it.
      pendingDevice = {
        id: `device-${Date.now()}-${devices.length}`,
        name: clean,
        thisDevice: false,
        addedAt: Date.now(),
        state: 'pending',
      };
      emit({ type: 'devices', devices: await this.devices() });
      return { ...pendingDevice };
    },

    async approveDevice(id: string) {
      failIf('approveDevice');
      if (pendingDevice?.id !== id) throw new Error('This device request is not waiting.');
      const approved: DeviceInfo = { ...pendingDevice, state: 'active' };
      devices.push(approved);
      pendingDevice = null;
      emit({ type: 'devices', devices: await this.devices() });
      return { ...approved };
    },

    async removeDevice(id: string) {
      failIf('removeDevice');
      if (devices.find(device => device.id === id)?.thisDevice) throw new Error('Use another device to remove this one.');
      if (!devices.some(device => device.id === id) && pendingDevice?.id !== id) throw new Error('This device is not available.');
      // Removing a device rotates keys and starts a new epoch on real clients.
      devices = devices.filter((device) => device.id !== id || device.thisDevice);
      if (pendingDevice?.id === id) pendingDevice = null;
      emit({ type: 'devices', devices: await this.devices() });
    },

    async renameDevice(id: string, name: string) {
      failIf('renameDevice');
      const clean = name.trim();
      if (!clean) throw new Error('Give the device a name first.');
      const device = devices.find((d) => d.id === id);
      if (device) {
        device.name = clean;
      } else if (pendingDevice?.id === id) {
        pendingDevice.name = clean;
      } else {
        throw new Error('This device is not available.');
      }
      emit({ type: 'devices', devices: await this.devices() });
    },

    async restoreVault() {
      failIf('restoreVault');
      const state = options.restoreState ?? 'ready';
      const view: RestoreView = { state, message: RESTORE_MESSAGES[state] };
      return view;
    },

    async signInRole(role: 'admin' | 'root') {
      failIf('signInRole');
      // Fixture passkey ceremony: any enrolled device key works equally.
      roles.clear();
      roles.add(role);
    },

    async adminSchema() {
      failIf('adminSchema');
      if (!roles.has('admin')) throw new Error('Sign in with your passkey as admin first.');
      return structuredClone(schema);
    },

    async adminSaveSchema(next: ProfileSchema) {
      failIf('adminSaveSchema');
      if (!roles.has('admin')) throw new Error('Sign in with your passkey as admin first.');
      if (next.version !== schema.version) throw new Error('The schema changed. Reload it before saving.');
      const keys = new Set<string>();
      for (const field of next.fields) {
        if (!field.key.trim() || keys.has(field.key) || !field.question.trim()) throw new Error('Every question needs a unique key and label.');
        keys.add(field.key);
        if (!['choice', 'number', 'yes-no', 'location', 'short-text', 'long-text'].includes(field.kind)) throw new Error('This answer style is unavailable.');
        if (field.kind === 'choice' && !field.choices?.length) throw new Error('Add at least one choice.');
        if (field.min !== undefined && field.max !== undefined && field.min > field.max) throw new Error('The minimum exceeds the maximum.');
      }
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
      failIf('rootCommunities');
      requireRoot();
      const communities: RootCommunity[] = [
        { communityId: 'garden-neighbours', displayName: 'Garden neighbours' },
        { communityId: 'evening-choir', displayName: 'Evening choir' },
      ];
      return communities;
    },

    async rootCommunity(id: string) {
      failIf('rootCommunity');
      requireRoot();
      const view = rootViews.get(id);
      if (!view) throw new Error('This community is not available.');
      return structuredClone(view);
    },

    async rootSetSetting(id: string, key: string, mode: 'inherit' | 'empty' | 'value', value?: string) {
      failIf('rootSetSetting');
      requireRoot();
      const view = rootViews.get(id);
      if (!view) throw new Error('This community is not available.');
      const setting = view.settings.find((s) => s.key === key);
      if (!setting) throw new Error('This setting is not available.');
      if (!setting.editable) throw new Error('This setting is managed by the platform.');
      if (mode === 'value' && (value === undefined || !value.trim())) {
        throw new Error('Enter a value for this setting.');
      }
      if (mode === 'inherit') {
        setting.inherited = true;
        setting.overrideValue = null;
        setting.effectiveValue = rootDefaults.get(id)!.settings.find(item => item.key === key)!.effectiveValue;
      } else if (mode === 'empty') {
        setting.inherited = false;
        setting.overrideValue = null;
        setting.effectiveValue = '';
      } else {
        setting.inherited = false;
        setting.overrideValue = value!.trim();
        setting.effectiveValue = value!.trim();
      }
      return structuredClone(view);
    },

    async rootSetAdmin(id: string, adminId: string, enabled: boolean) {
      failIf('rootSetAdmin');
      requireRoot();
      const view = rootViews.get(id);
      if (!view) throw new Error('This community is not available.');
      if (!adminId.trim()) throw new Error('Choose an admin first.');
      if (enabled) {
        if (!view.admins.some((a) => a.id === adminId)) {
          view.admins.push({ id: adminId, label: adminId });
        }
      } else {
        view.admins = view.admins.filter((a) => a.id !== adminId);
      }
      return structuredClone(view);
    },
  };
}
