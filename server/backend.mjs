import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

export class NativeBackendError extends Error {
  constructor(code = 'backend_unavailable') { super('Native cfrm backend request failed'); this.code = code; }
}
function limit(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError('Explicit backend bound required');
  return value;
}
function principalWire(principal) {
  if (principal?.kind === 'anonymous') return { kind: 'anonymous' };
  if (principal?.kind === 'member' && typeof principal.memberId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(principal.memberId)) {
    return { kind: 'member', memberId: principal.memberId };
  }
  throw new NativeBackendError('unauthorized');
}

/** Trusted local process boundary. One request is outstanding at a time. A
 * broken protocol terminates the adapter; restarting belongs to the supervisor,
 * so an uncertain operation is never silently retried. */
export function createCfrmBackend({ binaryPath, configPath, maxRequestBytes, maxResponseBytes, maxPending, deadlineMs, maxStderrBytes }) {
  if (typeof binaryPath !== 'string' || typeof configPath !== 'string' || !isAbsolute(binaryPath) || !isAbsolute(configPath)) throw new TypeError('Absolute backend paths required');
  limit(maxRequestBytes); limit(maxResponseBytes); limit(maxPending, 64); limit(deadlineMs, 300_000); limit(maxStderrBytes, 1_048_576);
  const child = spawn(binaryPath, ['--config', configPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buffer = Buffer.alloc(0), active, failure, sequence = 0, pending = 0, stderrSize = 0, closed = false;
  const failureListeners = new Set();
  let chain = Promise.resolve();
  function fail(error = new NativeBackendError()) {
    if (failure) return;
    failure = error;
    if (active) { clearTimeout(active.timer); active.reject(error); active = undefined; }
    buffer = Buffer.alloc(0);
    child.kill('SIGKILL');
    if (!closed) for (const listener of failureListeners) { try { listener(error); } catch {} }
  }
  child.once('error', () => fail());
  child.once('close', () => fail());
  child.stdin.on('error', () => fail());
  child.stderr.on('data', chunk => {
    stderrSize += chunk.length;
    if (stderrSize > maxStderrBytes) fail(new NativeBackendError('stderr_limit'));
  });
  child.stdout.on('data', chunk => {
    if (failure) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > maxResponseBytes) { fail(new NativeBackendError('response_limit')); return; }
    const end = buffer.indexOf(10);
    if (end === -1) return;
    if (!active || end !== buffer.length - 1) { fail(); return; }
    let response;
    try { response = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, end))); }
    catch { fail(); return; }
    if (!response || response.id !== active.id || typeof response.ok !== 'boolean') { fail(); return; }
    const current = active; active = undefined; clearTimeout(current.timer); buffer = Buffer.alloc(0);
    if (response.ok) current.resolve(response.result);
    else current.reject(new NativeBackendError('backend_rejected'));
  });
  function dispatch(op, payload, principal) {
    if (failure) return Promise.reject(failure);
    if (pending >= maxPending) return Promise.reject(new NativeBackendError('capacity'));
    let body, id;
    try {
      id = String(++sequence);
      body = JSON.stringify({ id, op, payload, principal }) + '\n';
      if (Buffer.byteLength(body) > maxRequestBytes) throw new NativeBackendError('request_limit');
    } catch (error) { return Promise.reject(error); }
    pending++;
    const admittedAt = Date.now();
    const run = chain.then(() => new Promise((resolve, reject) => {
      if (failure) { reject(failure); return; }
      const remaining = deadlineMs - (Date.now() - admittedAt);
      if (remaining <= 0) { reject(new NativeBackendError('deadline_exceeded')); return; }
      active = { id, resolve, reject, timer: setTimeout(() => fail(new NativeBackendError('deadline_exceeded')), remaining) };
      child.stdin.write(body, error => { if (error) fail(); });
    }));
    chain = run.catch(() => {});
    return run.finally(() => { pending--; });
  }
  function callOperation(op, payload, { principal } = {}) {
    try {
      if (!['health', 'discovery', 'account', 'presence_apply', 'presence_lookup', 'presence_directory', 'key_issue', 'key_redeem', 'verify_accounting_delegation'].includes(op)) throw new NativeBackendError('unsupported');
      return dispatch(op, payload, principalWire(principal));
    } catch (error) { return Promise.reject(error); }
  }
  const kinds = { discovery: 'discovery', account: 'account', presence: 'presence_apply', presenceLookup: 'presence_lookup', presenceDirectory: 'presence_directory', keyIssue: 'key_issue' };
  return Object.freeze({
    get healthy() { return !closed && !failure; },
    onFailure(listener) {
      if (typeof listener !== 'function') throw new TypeError('Backend failure listener required');
      failureListeners.add(listener);
      if (failure && !closed) queueMicrotask(() => { if (failureListeners.has(listener)) { try { listener(failure); } catch {} } });
      return () => failureListeners.delete(listener);
    },
    callOperation,
    // This capability is held only by the trusted enrollment publisher. The
    // generic call/callOperation interfaces cannot manufacture this principal.
    installEnrollmentCheckpoint: payload => dispatch('install_enrollment_checkpoint', payload, { kind: 'trusted' }),
    call(backend, payload, options) {
      const kind = kinds[backend];
      return kind ? callOperation(kind, payload, options) : Promise.reject(new NativeBackendError('unsupported'));
    },
    ready: () => callOperation('health', {}, { principal: { kind: 'anonymous' } }),
    close: () => { closed = true; failureListeners.clear(); fail(); },
  });
}
export const createNativeCfrmBackend = createCfrmBackend;
