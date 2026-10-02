/**
 * TypeScript port of the `cmsg` local API.
 *
 * The frontend talks ONLY to cmsg's local API. This module holds no logic,
 * no keys and no crypto: it is one interface with typed requests, responses
 * and events, derived from CFRM-CMSG-CONTRACTS (cmsg member door).
 *
 * This handwritten interface is provisional. Reconcile it with the generated
 * cmsg API registry and adjust consumers before production integration.
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
  /** Optional typed input the screen collects and sends via completeGate. */
  action?: { label: string; inputLabel?: string };
}

export interface LobbyState {
  handle: Handle;
  /** Optional cmsg-supplied community display name, always shown with the handle. */
  displayName?: string;
  handleChange?: HandleChangeNotice;
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
  /**
   * Optional public display-name flag. Absence means false. Only a community
   * admin flagging an optional public text field enables it; the backend
   * (cmsg->crgs/cgrd) remains the authority for enforcement and validation.
   * The frontend never enforces uniqueness or handle policy.
   */
  shownAsName?: boolean;
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

export type ProfileValues = Record<string, string | number | boolean | LocationValue>;

/** Typed location value. Distance is measured by cmsg from the own profile. */
export interface LocationValue {
  latitude: number;
  longitude: number;
}

export interface OwnProfile {
  values: ProfileValues;
  revision: Revision;
  published: boolean;
}

/** A personal two-way rule: values the other member must satisfy. */
export interface MatchRule {
  field: string;
  /** Exact values (choice/yes-no) or { min, max } (number). */
  equals?: (string | number | boolean)[];
  min?: number;
  max?: number;
  /** Location distance in km, measured by cmsg from the own profile. */
  maxDistanceKm?: number;
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
  equals?: (string | number | boolean)[];
  min?: number;
  max?: number;
  /** Location distance in km, measured by cmsg from the own profile. */
  maxDistanceKm?: number;
}

/** Supplied only after cmsg verifies quorum and the current epoch proof. */
export type PublicRecord =
  | { status: 'withheld' }
  | { status: 'available'; accepted: number; declined: number; punished: number };

export interface PublicCard {
  memberId: MemberId;
  handle: Handle;
  /**
   * Optional cmsg-supplied public display name. Never derived by the
   * frontend from card.values and never a private field. Shown only as
   * `displayName · @handle`; absence means handle-only.
   */
  displayName?: string;
  /** Typed public values; never pictures. */
  values: ProfileValues;
  online: boolean;
  /**
   * cmsg owns quorum and epoch currentness. Values are relative shares, never
   * counts. Null/withheld exposes no figures; the UI never verifies a proof.
   */
  record: PublicRecord | null;
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
  /** Accepted peer profile for display. Never a raw key. */
  profile?: { schema: ProfileSchema; values: ProfileValues };
}

export interface ProfileExchange {
  id: string;
  peer: MemberId;
  handle: Handle;
  displayName?: string;
  direction: 'incoming' | 'outgoing';
  result: KeyRequestResult;
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
  fromDisplayName?: string;
  to: MemberId;
  message: string;
  state: WaveState;
  /** Slots still reserved while waiting. */
  senderSlotHeld: boolean;
  recipientSlotHeld: boolean;
  /** Reserved content is never shown by the UI. */
  releaseState?: 'reserved' | 'released';
  reason?: string;
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
  displayName?: string;
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
  peerDisplayName?: string;
  messages: ChatMessage[];
  /** Unmetered once established. */
  established: boolean;
  state?: 'active' | 'closed' | 'blocked' | 'reopen-pending';
}

/* ------------------------------------------------------------------ */
/* Groups (circle / ingroup / public room)                             */
/* ------------------------------------------------------------------ */

export type GroupLevel = 'circle' | 'ingroup' | 'room' | 'opening';

export interface ForkView {
  id: string;
  label: string;
  detail: string;
  proposedRoster: string[];
  consented: boolean;
}

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
  /** Opaque display data; UI never computes bands or transitions. */
  band?: { notifications: string; postingPace: string; joining: string };
  opening?: { progress: string; deadlineLabel: string };
  lineage?: string[];
  seatBudget?: { enabled: boolean; label: string };
  welcomePrompt?: string;
  members?: { id: string; handle: string; displayName?: string }[];
  forks?: ForkView[];
}

/**
 * Credit for welcoming or introducing, reported by cmsg. Amounts, caps and
 * time windows are backend policy; the UI renders status, explanation and value
 * verbatim and never claims credit before a receipt says so.
 */
export type CreditStatus = 'pending' | 'credited' | 'capped' | 'failed';

export interface CreditReceipt {
  kind: 'welcome' | 'introduction';
  status: CreditStatus;
  explanation: string;
  valueLabel?: string;
}

export interface WelcomeResult {
  reply: string;
  credit: CreditReceipt;
}

export interface GroupForkProposal {
  groupId: string;
  kind: 'exit' | 'split' | 'merge' | 'open' | 'add' | 'exclusion';
  label: string;
  detail: string;
  memberIds?: string[];
  targetGroupId?: string;
}

/* ------------------------------------------------------------------ */
/* Devices                                                             */
/* ------------------------------------------------------------------ */

export interface DeviceInfo {
  id: string;
  name: string;
  thisDevice: boolean;
  addedAt: number;
  state?: 'pending' | 'active';
}

export interface RestoreView {
  state: 'ready' | 'unavailable' | 'unrecoverable' | 'locked';
  message: string;
}

/* ------------------------------------------------------------------ */
/* Admin and root (forwarded frontend -> cmsg -> Foyer -> cvld)        */
/* ------------------------------------------------------------------ */

export interface SchemaImpact {
  profilesNeedingChanges: number;
  grandfathered: number;
  note: string;
}

export type MemberRole = 'member' | 'admin' | 'root';

export interface HandleChangeNotice {
  reason: string;
  deadlineLabel: string;
}

/**
 * Handle change eligibility, decided entirely by cmsg. The frontend renders
 * the state and never computes eligibility, deadlines or placeholders.
 */
export interface HandlePolicy {
  state: 'settling-in' | 'locked' | 'token' | 'required' | 'placeholder';
  canChange: boolean;
  summary: string;
  /** Human-readable end of the settling-in window or the required-change deadline. */
  deadlineLabel?: string;
  /** Private reason given to the member when an admin requires a change. */
  reason?: string;
  reservedNote: string;
}

export interface AdminAccess {
  communityId: string;
  assignableRoles: MemberRole[];
  canRequireHandleChange: boolean;
  members: { id: string; label: string; role: MemberRole; editable: boolean }[];
}

/** The root board uses a separate, unlinkable membership, not the role root. */
export interface RootBoardAccess {
  state: 'eligible' | 'active' | 'renewal-needed' | 'unavailable';
  message: string;
  renewalLabel: string;
  canEnter: boolean;
}

export interface RootCommunity {
  communityId: string;
  displayName: string;
}

export interface RootSetting {
  key: string;
  label: string;
  effectiveValue: string;
  overrideValue: string | null;
  inherited: boolean;
  editable: boolean;
  help: string;
}

export interface RootAdmin {
  id: string;
  label: string;
}

export interface RootCommunityView {
  communityId: string;
  settings: RootSetting[];
  admins: RootAdmin[];
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/**
 * Status of the passkey ceremony, which runs only in a short top-level pop-up
 * at the vault origin. The UI receives this status and nothing else: never
 * a credential, a PRF output or any key material.
 */
export type CeremonyState =
  | 'idle'
  | 'continue-needed'
  | 'popup-open'
  | 'done'
  | 'cancelled'
  | 'blocked'
  | 'timeout'
  | 'failed';

export interface CeremonyStatus {
  state: CeremonyState;
}

export type CmsgEvent =
  | { type: 'ceremony'; status: CeremonyStatus }
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
  completeGate(id: string, input: string): Promise<LobbyState>;

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
  profileExchanges(): Promise<ProfileExchange[]>;

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
  closeConversation(peer: MemberId): Promise<void>;
  punishConversation(peer: MemberId): Promise<void>;
  requestReopen(peer: MemberId): Promise<void>;

  /* Groups */
  groups(): Promise<GroupView[]>;
  joinGroup(id: string, consent?: boolean): Promise<GroupView>;
  leaveGroup(id: string): Promise<void>;
  proposeFork(proposal: GroupForkProposal): Promise<GroupView>;
  consentFork(groupId: string, forkId: string): Promise<GroupView>;
  welcomeMember(groupId: string): Promise<WelcomeResult>;
  introduceMembers(groupId: string, firstId: string, secondId: string): Promise<CreditReceipt>;
  dismissGroupSuggestion(groupId: string): Promise<void>;
  sendGroupMessage(id: string, text: string): Promise<ChatMessage>;

  /* Devices */
  devices(): Promise<DeviceInfo[]>;
  addDevice(name: string): Promise<DeviceInfo>;
  approveDevice(id: string): Promise<DeviceInfo>;
  removeDevice(id: string): Promise<void>;
  renameDevice(id: string, name: string): Promise<void>;
  restoreVault(): Promise<RestoreView>;

  /* Admin (community scope) */
  signInRole(role: 'admin' | 'root'): Promise<void>;
  handlePolicy(): Promise<HandlePolicy>;
  changeHandle(next: Handle): Promise<HandlePolicy>;
  adminAccess(communityId?: string): Promise<AdminAccess>;
  adminSetRole(memberId: string, role: MemberRole, communityId?: string): Promise<AdminAccess>;
  requireHandleChange(memberId: string, reason: string, communityId?: string): Promise<HandleChangeNotice>;
  rootBoardAccess(): Promise<RootBoardAccess>;
  enterRootBoard(): Promise<JoinWithVoucherResult>;
  adminSchema(): Promise<ProfileSchema>;
  adminSaveSchema(schema: ProfileSchema): Promise<SchemaImpact>;

  /* Root (platform scope) */
  rootCommunities(): Promise<RootCommunity[]>;
  rootCommunity(id: string): Promise<RootCommunityView>;
  rootSetSetting(
    id: string,
    key: string,
    mode: 'inherit' | 'empty' | 'value',
    value?: string,
  ): Promise<RootCommunityView>;
  rootSetAdmin(id: string, adminId: string, enabled: boolean): Promise<RootCommunityView>;
}
