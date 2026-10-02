/**
 * Development-only runtime stand-in for the CLI login page. It is imported
 * only behind `import.meta.env.DEV` and by tests; production builds exclude it.
 * It validates a fixture launch fragment the way the real runtime must: fail
 * closed, one-time consume, exact origin, literal loopback callback.
 */
import type { CliLoginInspection, CliLoginPort, CliLoginStatus } from './cli-login.js';
import { CLI_LOGIN_PREFIX } from './cli-login.js';

export interface DevCliLoginOptions {
  handoff?: 'done' | 'cancelled' | 'failed';
  now?: () => number;
}

const TOKEN = /^[A-Za-z0-9_-]{8,64}$/;

function loopbackCallback(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const port = Number(url.port);
  return (
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' &&
    url.username === '' &&
    url.password === '' &&
    Number.isInteger(port) &&
    port >= 1024 &&
    url.pathname === '/finish' &&
    url.search === '' &&
    url.hash === ''
  );
}

export function createDevCliLogin(options: DevCliLoginOptions = {}): CliLoginPort {
  const now = options.now ?? Date.now;
  const consumed = new Set<string>();
  let pending: string | null = null;
  let started = false;

  return {
    async inspect(launch: string, pageOrigin: string): Promise<CliLoginInspection> {
      if (!launch.startsWith(CLI_LOGIN_PREFIX)) return { ok: false, reason: 'malformed' };
      const params = new URLSearchParams(launch.slice(CLI_LOGIN_PREFIX.length));
      const session = params.get('session') ?? '';
      const nonce = params.get('nonce') ?? '';
      const origin = params.get('origin') ?? '';
      const callback = params.get('callback') ?? '';
      const expires = Number(params.get('expires'));
      if (!TOKEN.test(session) || !TOKEN.test(nonce) || !Number.isFinite(expires) || !loopbackCallback(callback)) {
        return { ok: false, reason: 'malformed' };
      }
      if (origin !== pageOrigin) return { ok: false, reason: 'origin-mismatch' };
      if (consumed.has(session)) return { ok: false, reason: 'replayed' };
      if (now() >= expires) return { ok: false, reason: 'expired' };
      pending = session;
      started = false;
      return {
        ok: true,
        request: {
          communityOrigin: origin,
          handoffLabel: 'the cmeet app on this computer',
          expiresLabel: 'This request expires in two minutes.',
        },
      };
    },

    async begin(): Promise<CliLoginStatus> {
      if (pending === null || started) {
        return { state: 'failed', retryable: false, message: 'This request was already used or is no longer open.' };
      }
      const state = options.handoff ?? 'done';
      if (state === 'cancelled') return { state, retryable: true, message: 'The sign-in was cancelled.' };
      started = true;
      consumed.add(pending);
      if (state === 'done') return { state, retryable: false };
      return { state, retryable: false, message: 'The local app did not receive the sign-in.' };
    },

    async cancel(): Promise<CliLoginStatus> {
      if (pending !== null) consumed.add(pending);
      pending = null;
      return { state: 'cancelled', retryable: false, message: 'The sign-in was cancelled.' };
    },
  };
}
