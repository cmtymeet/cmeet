/**
 * TypeScript port of the `cmsg` local API.
 *
 * The frontend talks ONLY to cmsg's local API. This module holds no logic,
 * no keys and no crypto: it is one interface with typed requests, responses
 * and events, derived from CFRM-CMSG-CONTRACTS (cmsg member door).
 *
 * The real generated client replaces the development adapter later without
 * changing components: both implement {@link CmsgClient}.
 *
 * Families mirror the contract: connection preload, lobby/gates, profiles and
 * schema, forum discovery, key exchange, waves, contacts, threads, groups and
 * rooms, devices, admin schema editing, root settings.
 */

export type MemberId = string;
export type Handle = string;
export type Revision = number;

/** Opaque community identifier. Never a cross-community identity. */
export interface CommunityRef {
  communityId: string;
  displayName: string;
}

/* ------------------------------------------------------------------ */
/* Connection preload (Mesh readiness)                                 */
/* ------------------------------------------------------------------ */

export type ConnectionPhase =
  | 'starting'
  | 'bootstrapping'
  | 'publishing'
  | 'ready'
  | 'failed';

export interface ConnectionStatus {
  phase: ConnectionPhase;
  /** 0..1 progress for calm progress display. */
  progress: number;
  backend: 'tor' | 'veilid';
  message: string;
  /** Minimum client version published by the servers, when known. */
  minVersion?: string;
}

/* ------------------------------------------------------------------ */
/* Lobby and gates                                                     */
/* ------------------------------------------------------------------ */

export interface GateStep {
  id: string;
  label: string;
  detail: string;
  state: 'complete' | 'action-needed' | 'waiting';
}

export interface LobbyState {
  handle: Handle;
  gates: GateStep[];
  profileComplete: boolean;
  devices: DeviceInfo[];
  /** True once admission succeeded and the forum may be entered. */
  admitted: boolean;
  /** Shown before registration expiry: leaving means no return. */
  expiryWarning: string | null;
}

export interface JoinWithVoucherRequest {
  voucher: string;
  handle: Handle;
}

export interface JoinWithVoucherResult {
  lobby: LobbyState;
}

/* ------------------------------------------------------------------ */
/* Schema and profiles                                                 */
/* ------------------------------------------------------------------ */

export type FieldKind =
  | 'choice'
  | 'number'
  | 'yes-no'
  | 'location'
  | 'short-text'
  | 'long-text';

export type FieldVisibility = 'public' | 'private';

export interface SchemaField {
  key: string;
  /** Admin-facing question text. */
  question: string;
  kind: FieldKind;
  visibility: FieldVisibility;
  required: boolean;
  filterable: boolean;
  /** Allowed values for choice fields. */
  choices?: string[];
  /** Numeric bounds for number fields. */
  min?: number;
  max?: number;
  /** Restricted fields need a pin/budget change. */
  restricted?: boolean;
}

export interface ProfileSchema {
  version: number;
  fields: SchemaField[];
}

export type ProfileValues = Record<string, string | number | boolean>;

export interface OwnProfile {
  values: ProfileValues;
  revision: Revision;
  published: boolean;
}

/** A personal two-way rule: values the other member must satisfy. */
export interface MatchRule {
  field: string;
  /** Exact values (choice) or { min, max } (number). */
  equals?: (string | number)[];
  min?: number;
  max?: number;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface PublishProfileResult {
  profile: OwnProfile;
  /** Pins spent for restricted-field changes. */
  pinsSpent: string[];
}

/* ------------------------------------------------------------------ */
/* Forum discovery                                                     */
/* ------------------------------------------------------------------ */

export interface DiscoveryFilter {
  field: string;
  equals?: (string | number)[];
  min?: number;
  max?: number;
}

export interface PublicCard {
  memberId: MemberId;
  handle: Handle;
  /** Typed public values; never pictures. */
  values: ProfileValues;
  online: boolean;
  /** Relative shares only, after quorum; null before quorum. */
  record: { accepted: number; declined: number; punished: number } | null;
}

export interface MatchPage {
  entries: PublicCard[];
  /** Opaque cursor for the next page; null when exhausted. */
  cursor: string | null;
}

export interface KeyRequestResult {
  status: 'accepted' | 'rejected';
  /** Requester learns only the failing field, never the rule. */
  failingField?: string;
  /** Owner sees the full reason. Present only for the owner side. */
  reason?: string;
}

/* ------------------------------------------------------------------ */
/* Waves (first contact)                                               */
/* ------------------------------------------------------------------ */

export type WaveState =
  | 'pending'
  | 'answered'
  | 'closed'
  | 'silent'
  | 'punished';

export interface Wave {
  id: string;
  from: MemberId;
  fromHandle: Handle;
  to: MemberId;
  message: string;
  state: WaveState;
  /** Slots still reserved while waiting. */
  senderSlotHeld: boolean;
  recipientSlotHeld: boolean;
}

export interface WaveSlots {
  introductionsAvailable: number;
  incomingAvailable: number;
}

/* ------------------------------------------------------------------ */
/* Contacts and blocks                                                 */
/* ------------------------------------------------------------------ */

export type RelationState =
  | 'unknown'
  | 'pending'
  | 'established'
  | 'closed'
  | 'blocked';

export interface Contact {
  memberId: MemberId;
  handle: Handle;
  relation: RelationState;
  /** Peer-to-peer presence; never stored in the forum. */
  online: boolean;
  blockedByMe: boolean;
}

/* ------------------------------------------------------------------ */
/* Threads (one-to-one chat)                                           */
/* ------------------------------------------------------------------ */

export type MessageState = 'queued' | 'stored' | 'received';

export interface ChatMessage {
  id: string;
  threadId: string;
  from: MemberId;
  text: string;
  at: number;
  outgoing: boolean;
  state: MessageState;
}

export interface Thread {
  id: string;
  peer: MemberId;
  peerHandle: Handle;
  messages: ChatMessage[];
  /** Unmetered once established. */
  established: boolean;
}

/* ------------------------------------------------------------------ */
/* Groups (circle / ingroup / public room)                             */
/* ------------------------------------------------------------------ */

export type GroupLevel = 'circle' | 'ingroup' | 'room';

export interface GroupView {
  id: string;
  name: string;
  level: GroupLevel;
  size: number;
  /** What changes next at the current size (band or level fork). */
  whatChangesNext: string;
  description: string;
  /** Consent text shown on the public-room join screen. */
  joinConsent: string | null;
  joined: boolean;
  newcomerHistory: string;
  messages: ChatMessage[];
  /** Device suggestions: split/merge banners, never forced moves. */
  suggestion: string | null;
}

export interface GroupForkProposal {
  groupId: string;
  kind: 'exit' | 'split' | 'merge' | 'open';
  label: string;
  detail: string;
}

/* ------------------------------------------------------------------ */
/* Devices                                                             */
/* ------------------------------------------------------------------ */

export interface DeviceInfo {
  id: string;
  name: string;
  thisDevice: boolean;
  addedAt: number;
}

/* ------------------------------------------------------------------ */
/* Admin and root (forwarded frontend -> cmsg -> Foyer -> cvld)        */
/* ------------------------------------------------------------------ */

export interface SchemaImpact {
  profilesNeedingChanges: number;
  grandfathered: number;
  note: string;
}

export interface RootCommunity {
  communityId: string;
  displayName: string;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export type CmsgEvent =
  | { type: 'connection'; status: ConnectionStatus }
  | { type: 'lobby'; lobby: LobbyState }
  | { type: 'matches'; page: MatchPage; reset: boolean }
  | { type: 'wave-incoming'; wave: Wave }
  | { type: 'wave-updated'; wave: Wave }
  | { type: 'key-decision'; peer: MemberId; result: KeyRequestResult }
  | { type: 'contacts'; contacts: Contact[] }
  | { type: 'message'; message: ChatMessage }
  | { type: 'groups'; groups: GroupView[] }
  | { type: 'devices'; devices: DeviceInfo[] };

export type CmsgEventHandler = (event: CmsgEvent) => void;

/* ------------------------------------------------------------------ */
/* The port: one interface                                             */
/* ------------------------------------------------------------------ */

export interface CmsgClient {
  /* Connection */
  connectionStatus(): Promise<ConnectionStatus>;
  /** Establish the network first; the app waits for `ready`. */
  connect(): Promise<ConnectionStatus>;
  disconnect(): Promise<void>;
  subscribe(handler: CmsgEventHandler): () => void;

  /* Lobby */
  joinWithVoucher(request: JoinWithVoucherRequest): Promise<JoinWithVoucherResult>;
  lobby(): Promise<LobbyState>;
  signIn(): Promise<JoinWithVoucherResult>;

  /* Schema and profile */
  schema(): Promise<ProfileSchema>;
  ownProfile(): Promise<OwnProfile>;
  ownRules(): Promise<MatchRule[]>;
  saveRules(rules: MatchRule[]): Promise<void>;
  validateProfile(values: ProfileValues): Promise<ValidationIssue[]>;
  publishProfile(values: ProfileValues): Promise<PublishProfileResult>;

  /* Forum */
  discover(filters: DiscoveryFilter[], cursor?: string | null): Promise<MatchPage>;
  requestPrivateKey(peer: MemberId): Promise<KeyRequestResult>;

  /* Waves */
  waveSlots(): Promise<WaveSlots>;
  sendWave(to: MemberId, message: string): Promise<Wave>;
  incomingWaves(): Promise<Wave[]>;
  answerWave(id: string, message: string): Promise<Wave>;
  closeWave(id: string): Promise<Wave>;
  punishWave(id: string): Promise<Wave>;

  /* Contacts */
  contacts(): Promise<Contact[]>;
  blockMember(peer: MemberId): Promise<void>;
  unblockMember(peer: MemberId): Promise<void>;

  /* Threads */
  threads(): Promise<Thread[]>;
  thread(peer: MemberId): Promise<Thread>;
  sendMessage(peer: MemberId, text: string): Promise<ChatMessage>;

  /* Groups */
  groups(): Promise<GroupView[]>;
  joinGroup(id: string): Promise<GroupView>;
  leaveGroup(id: string): Promise<void>;
  proposeFork(proposal: GroupForkProposal): Promise<GroupView>;
  sendGroupMessage(id: string, text: string): Promise<ChatMessage>;

  /* Devices */
  devices(): Promise<DeviceInfo[]>;
  addDevice(name: string): Promise<DeviceInfo>;
  approveDevice(id: string): Promise<DeviceInfo>;
  removeDevice(id: string): Promise<void>;

  /* Admin (community scope) */
  adminSchema(): Promise<ProfileSchema>;
  adminSaveSchema(schema: ProfileSchema): Promise<SchemaImpact>;

  /* Root (platform scope) */
  rootCommunities(): Promise<RootCommunity[]>;
}
