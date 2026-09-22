import { isAbsolute } from 'node:path';

const remoteKeys = ['url', 'authToken', 'authTokenPath', 'networkTimeoutMs'];
const positive = value => Number.isSafeInteger(value) && value > 0;
const absolute = value => typeof value === 'string' && isAbsolute(value);

/** Private operator configuration only. The selector never accepts a client,
 * browser-provided URL, embedded replica, or implicit in-memory database. */
export async function loadStorage(input, { readPrivateFile, allowLegacySqlite = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.hasOwn(input, 'client') || Object.hasOwn(input, 'fetch')) throw new Error('Explicit storage configuration required');
  const driver = input.driver ?? (allowLegacySqlite && absolute(input.path) ? 'sqlite' : undefined);
  if (driver === 'sqlite') {
    if (remoteKeys.some(key => Object.hasOwn(input, key))) throw new Error('Mixed storage configuration rejected');
    return Object.freeze({ driver });
  }
  if (driver !== 'turso' || Object.hasOwn(input, 'path') || Object.hasOwn(input, 'busyTimeoutMs')
      || typeof input.url !== 'string' || input.url.length > 2048
      || !positive(input.networkTimeoutMs) || input.networkTimeoutMs > 60_000) throw new Error('Explicit Turso configuration required');
  let target;
  try { target = new URL(input.url); } catch { throw new Error('Turso endpoint rejected'); }
  if (!['https:', 'libsql:'].includes(target.protocol) || !target.hostname || target.username
      || target.password || target.search || target.hash || !['', '/'].includes(target.pathname)) throw new Error('Turso endpoint rejected');
  const inline = Object.hasOwn(input, 'authToken'), fromFile = Object.hasOwn(input, 'authTokenPath');
  if (inline === fromFile) throw new Error('Exactly one private Turso credential source required');
  let authToken;
  if (inline) authToken = input.authToken;
  else {
    if (!absolute(input.authTokenPath) || typeof readPrivateFile !== 'function') throw new Error('Private Turso credential file required');
    const bytes = await readPrivateFile(input.authTokenPath, 2050, true);
    try { authToken = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r?\n$/, ''); }
    finally { bytes.fill(0); }
  }
  if (typeof authToken !== 'string' || authToken.length < 1 || authToken.length > 2048
      || !/^[\x21-\x7e]+$/.test(authToken)) throw new Error('Turso credential rejected');
  return Object.freeze({ driver, url: new URL(target.href.replace(/^libsql:/, 'https:')).href, authToken,
    networkTimeoutMs: input.networkTimeoutMs });
}

export function requireSameStorage(website, native) {
  if (website.driver !== native.driver || (website.driver === 'turso' && website.url !== native.url)) {
    throw new Error('Website and native durable storage differ');
  }
}

/** All services inherit the one selected remote endpoint. SQLite retains its
 * explicit per-service paths for the existing local contract fixtures. */
export function storeConnectionOptions(storage, input, { sharedSelector = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Store configuration required');
  if (Object.hasOwn(input, 'client') || Object.hasOwn(input, 'fetch')
      || (!sharedSelector && ['driver', ...remoteKeys].some(key => Object.hasOwn(input, key)))) throw new Error('Per-service storage override rejected');
  if (storage.driver === 'turso') {
    if (Object.hasOwn(input, 'path') || Object.hasOwn(input, 'busyTimeoutMs')) throw new Error('SQLite options rejected for Turso');
    return { url: storage.url, authToken: storage.authToken, networkTimeoutMs: storage.networkTimeoutMs };
  }
  if (storage.driver !== 'sqlite' || !absolute(input.path) || !positive(input.busyTimeoutMs)) throw new Error('Explicit SQLite path and timeout required');
  return { path: input.path, busyTimeoutMs: input.busyTimeoutMs };
}
