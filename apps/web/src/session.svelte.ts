import { createDevCmsg } from '../../../core/src/dev-adapter.js';
import type {
  CmsgClient,
  CmsgEvent,
  ConnectionStatus,
} from '../../../core/src/cmsg.js';

// The app talks to cmsg ONLY through this port. Today it is backed by the
// in-memory development adapter (UI development and component tests). The
// real generated client replaces `createClient` without changing components.
export function createClient(): CmsgClient {
  return createDevCmsg();
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
  switch (head) {
    case 'lobby': return { name: 'lobby' };
    case 'profile': return { name: 'profile' };
    case 'forum': return { name: 'forum' };
    case 'waves': return { name: 'waves' };
    case 'contacts': return { name: 'contacts' };
    case 'chat': return { name: 'chat', peer: decodeURIComponent(tail ?? '') };
    case 'groups': return tail ? { name: 'group', id: decodeURIComponent(tail) } : { name: 'groups' };
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
}

export class Session {
  client: CmsgClient;
  snapshot: SessionSnapshot = $state({
    connection: { phase: 'starting', progress: 0, backend: 'tor', message: 'Preparing the network.' },
    joined: false,
    unreadWaves: 0,
  });
  private detach: (() => void) | null = null;

  constructor(client?: CmsgClient) {
    this.client = client ?? createClient();
  }

  private onEvent = (event: CmsgEvent) => {
    if (event.type === 'connection') {
      this.snapshot = { ...this.snapshot, connection: event.status };
    }
    if (event.type === 'wave-incoming' || event.type === 'wave-updated') {
      void this.refreshWaves();
    }
  };

  async start() {
    this.detach?.();
    this.detach = this.client.subscribe(this.onEvent);
    this.snapshot = { ...this.snapshot, connection: await this.client.connectionStatus() };
    const status = await this.client.connect();
    this.snapshot = { ...this.snapshot, connection: status };
    await this.refreshWaves();
  }

  async retry() {
    await this.start();
  }

  private async refreshWaves() {
    try {
      const waves = await this.client.incomingWaves();
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
