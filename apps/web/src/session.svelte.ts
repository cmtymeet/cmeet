import type {
  CmsgClient,
  CmsgEvent,
  ConnectionStatus,
  LobbyState,
} from '../../../core/src/cmsg.js';

// This fixture is available only in the development server. A production
// build stays unavailable until the generated browser cmsg client is wired.
export async function createClient(): Promise<CmsgClient | null> {
  if (import.meta.env.DEV) {
    const { createDevCmsg } = await import('../../../core/src/dev-adapter.js');
    const params = new URLSearchParams(window.location.search);
    const delay = Number(params.get('dev-connect-delay'));
    const gate = params.get('dev-gate');
    const restore = params.get('dev-restore');
    const message = params.get('dev-message');
    return createDevCmsg({
      connectDelayMs: Number.isSafeInteger(delay) && delay > 0 ? delay : undefined,
      failConnect: params.get('dev-network') === 'failed',
      gateState: gate === 'waiting' || gate === 'action-needed' ? gate : undefined,
      restoreState: restore === 'locked' || restore === 'unavailable' || restore === 'unrecoverable' ? restore : undefined,
      incomingReleaseState: params.get('dev-incoming') === 'reserved' ? 'reserved' : undefined,
      messageState: message === 'queued' || message === 'stored' || message === 'received' ? message : undefined,
      failActions: params.getAll('dev-fail'),
    });
  }
  return null;
}

export type Route =
  | { name: 'arrival' }
  | { name: 'lobby' }
  | { name: 'profile' }
  | { name: 'forum' }
  | { name: 'waves' }
  | { name: 'contacts' }
  | { name: 'chat'; peer: string }
  | { name: 'groups' }
  | { name: 'group'; id: string }
  | { name: 'devices' }
  | { name: 'admin-schema' }
  | { name: 'root' }
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [head, tail] = path.split('/');
  let decoded = '';
  try { decoded = decodeURIComponent(tail ?? ''); } catch { return { name: 'arrival' }; }
  switch (head) {
    case 'lobby': return { name: 'lobby' };
    case 'profile': return { name: 'profile' };
    case 'forum': return { name: 'forum' };
    case 'waves': return { name: 'waves' };
    case 'contacts': return { name: 'contacts' };
    case 'chat': return { name: 'chat', peer: decoded };
    case 'groups': return tail ? { name: 'group', id: decoded } : { name: 'groups' };
    case 'devices': return { name: 'devices' };
    case 'admin': return { name: 'admin-schema' };
    case 'root': return { name: 'root' };
    case 'settings': return { name: 'settings' };
    default: return { name: 'arrival' };
  }
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case 'arrival': return '#/arrival';
    case 'lobby': return '#/lobby';
    case 'profile': return '#/profile';
    case 'forum': return '#/forum';
    case 'waves': return '#/waves';
    case 'contacts': return '#/contacts';
    case 'chat': return `#/chat/${encodeURIComponent(route.peer)}`;
    case 'groups': return '#/groups';
    case 'group': return `#/groups/${encodeURIComponent(route.id)}`;
    case 'devices': return '#/devices';
    case 'admin-schema': return '#/admin/schema';
    case 'root': return '#/root';
    case 'settings': return '#/settings';
  }
}

export interface SessionSnapshot {
  connection: ConnectionStatus;
  joined: boolean;
  unreadWaves: number;
  lobby: LobbyState | null;
}

export class Session {
  client: CmsgClient;
  snapshot: SessionSnapshot = $state({
    connection: { phase: 'starting', progress: 0, backend: 'tor', message: 'Preparing the network.' },
    joined: false,
    unreadWaves: 0,
    lobby: null,
  });
  private generation = 0;
  private detach: (() => void) | null = null;

  constructor(client: CmsgClient) {
    this.client = client;
  }

  private onEvent = (event: CmsgEvent) => {
    if (event.type === 'connection') {
      this.snapshot = { ...this.snapshot, connection: event.status };
    }
    if (event.type === 'lobby') this.snapshot = { ...this.snapshot, lobby: event.lobby };
    if (event.type === 'wave-incoming' || event.type === 'wave-updated') {
      void this.refreshWaves();
    }
  };

  async start() {
    const generation = ++this.generation;
    this.detach?.();
    this.detach = this.client.subscribe(this.onEvent);
    try {
      const initial = await this.client.connectionStatus();
      if (generation !== this.generation) return;
      this.snapshot = { ...this.snapshot, connection: initial };
      const status = await this.client.connect();
      if (generation !== this.generation) return;
      this.snapshot = { ...this.snapshot, connection: status };
      if (this.snapshot.joined) await this.refreshWaves();
    } catch (error) {
      if (generation !== this.generation) return;
      this.snapshot = { ...this.snapshot, connection: { ...this.snapshot.connection,
        phase: 'failed', message: error instanceof Error ? error.message : 'Connection unavailable.' } };
    }
  }

  stop() {
    ++this.generation;
    this.detach?.();
    this.detach = null;
    void this.client.disconnect().catch(() => {});
  }

  async retry() {
    await this.start();
  }

  private async refreshWaves() {
    const generation = this.generation;
    try {
      const waves = await this.client.incomingWaves();
      if (generation !== this.generation) return;
      const unread = waves.filter((w) => w.state === 'pending').length;
      if (unread !== this.snapshot.unreadWaves) {
        this.snapshot = { ...this.snapshot, unreadWaves: unread };
      }
    } catch {
      // Waves load after joining; ignore until then.
    }
  }

  markJoined() {
    this.snapshot = { ...this.snapshot, joined: true };
    void this.refreshWaves();
  }

  get ready(): boolean {
    return this.snapshot.connection.phase === 'ready';
  }

  get failed(): boolean {
    return this.snapshot.connection.phase === 'failed';
  }
}
