import { encode, decode, utf8, positive, exact } from './encoding.js';

/** Isolated holder worker. Only encrypted local records and explicitly public
 * account/enrollment envelopes are accepted on the reverse RPC channel. */
export async function createAccountingSession({ api, store, wallet, device, authority, config, beforeAccountApply }) {
  const settings = structuredClone(config.accounting);
  if (!settings || !api?.request || !store?.read || !store?.update || !wallet?.storageKey
      || typeof beforeAccountApply !== 'function') throw new Error('Accounting configuration and release guard required');
  positive(settings.workerDeadlineMs); positive(settings.workerMaxPending, 16);
  positive(settings.maxCiphertextBytes, 32 * 1024 * 1024);
  const worker = new Worker(new URL('./accounting-worker.js', import.meta.url), { type: 'module' });
  const calls = new Map();
  let sequence = 0, closed = false, closing, queued = 0, chain = Promise.resolve(), initialized;
  function terminate() {
    if (closed) return;
    closed = true; worker.terminate();
    for (const { reject, timer } of calls.values()) { clearTimeout(timer); reject(new Error('Accounting worker closed')); }
    calls.clear();
  }
  function close() {
    if (closing) return closing;
    if (closed) return Promise.resolve();
    closing = (async () => {
      try {
        // A busy prover is cancelled by terminating its Worker; the durable
        // pending request remains available for exact recovery next session.
        if (queued === 0 && calls.size === 0) await invoke('close', {});
      } finally { terminate(); }
    })();
    return closing;
  }
  async function reverse(method, input) {
    if (method === 'account') {
      exact(input, ['action', 'grant', 'authorization', 'request']);
      if (!['apply', 'status'].includes(input.action)) throw new Error('Accounting RPC action');
      // This callback durably invalidates cached own-state release gates in all
      // local conversations before an operator can accept any successor. It is
      // also required for an exact signed retry after an uncertain response.
      if (input.action === 'apply') await beforeAccountApply();
      if (closed) throw new Error('Accounting worker closed');
      return api.request('/v1/account', { method: 'POST', body: input });
    }
    if (method === 'enrollment') {
      exact(input, input?.action === 'enroll' ? ['action', 'delegation']
        : input?.action === 'checkpoint' ? ['action', 'slot'] : ['action']);
      if (!['enroll', 'current', 'checkpoint'].includes(input.action)
          || (input.action === 'checkpoint' && (!Number.isSafeInteger(input.slot) || input.slot < 0))) throw new Error('Enrollment RPC action');
      return api.request('/v1/account/enrollment', { method: 'POST', body: input });
    }
    if (method === 'loadJournal') {
      const value = (await store.read()).accountingJournal ?? null;
      return value === null ? null : { revision: value.revision, ciphertext: decode(value.ciphertext, settings.maxCiphertextBytes) };
    }
    if (method === 'saveJournal') {
      exact(input, ['expectedRevision', 'record']); exact(input.record, ['revision', 'ciphertext']);
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
          || input.record.revision !== input.expectedRevision + 1
          || !(input.record.ciphertext instanceof Uint8Array)
          || input.record.ciphertext.length > settings.maxCiphertextBytes) throw new Error('Encrypted account journal rejected');
      await store.update(previous => {
        if ((previous.accountingJournal?.revision ?? 0) !== input.expectedRevision) throw new Error('Account state changed in another session');
        return { ...previous, accountingJournal: { revision: input.record.revision, ciphertext: encode(input.record.ciphertext) } };
      });
      return true;
    }
    if (method === 'loadMaterial') return (await store.read()).accountingMaterial ?? null;
    if (method === 'saveMaterial') {
      exact(input, ['expectedRevision', 'record']); exact(input.record, ['revision', 'envelope']);
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
          || input.record.revision !== input.expectedRevision + 1
          || utf8.encode(JSON.stringify(input.record.envelope)).length > settings.maxCiphertextBytes) throw new Error('Encrypted account key record rejected');
      await store.update(previous => {
        if ((previous.accountingMaterial?.revision ?? 0) !== input.expectedRevision) throw new Error('Accounting key state changed in another session');
        return { ...previous, accountingMaterial: structuredClone(input.record) };
      });
      return true;
    }
    throw new Error('Unsupported accounting worker RPC');
  }
  worker.onmessage = async ({ data }) => {
    if (closed || !data || typeof data !== 'object') return;
    if (data.kind === 'rpc') {
      try { worker.postMessage({ kind: 'rpcResult', id: data.id, ok: true, value: await reverse(data.method, data.input) }); }
      catch { if (!closed) worker.postMessage({ kind: 'rpcResult', id: data.id, ok: false }); }
      return;
    }
    if (data.kind !== 'result') { terminate(); return; }
    const pending = calls.get(data.id);
    if (!pending) { terminate(); return; }
    clearTimeout(pending.timer); calls.delete(data.id);
    if (data.ok === true) pending.resolve(data.value);
    else pending.reject(new Error('Accounting operation failed; pending state is retained'));
  };
  worker.onerror = terminate;
  worker.onmessageerror = terminate;
  function invoke(method, input) {
    if (closed) return Promise.reject(new Error('Accounting worker closed'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(terminate, settings.workerDeadlineMs);
      calls.set(id, { resolve, reject, timer });
      worker.postMessage({ kind: 'call', id, method, input });
    });
  }
  function call(method, input = {}) {
    if (closed || closing || queued >= settings.workerMaxPending) return Promise.reject(new Error('Accounting worker capacity'));
    const snapshot = structuredClone(input); queued++;
    const next = chain.catch(() => {}).then(() => invoke(method, snapshot));
    chain = next.finally(() => { queued--; }).catch(() => {});
    return next;
  }
  async function start() {
    if (initialized) return initialized;
    initialized = (async () => {
      const key = await wallet.storageKey('accounting-private-state');
      const copyKey = await wallet.storageKey('accounting-device-copy');
      const context = utf8.encode(JSON.stringify(['cmeet.accounting-device.v1', config.communityId, authority.admission.memberId]));
      let snapshot;
      try {
        snapshot = device.snapshot(copyKey, context);
        return await call('initialize', { settings, communityId: config.communityId,
          trust: config.admissionTrust, authority, snapshot, copyKey, context, key });
      } finally { snapshot?.fill(0); copyKey.fill(0); key.fill(0); }
    })();
    try { return await initialized; } catch (error) { terminate(); throw error; }
  }
  async function renew(next) {
    await start();
    const nextAuthority = structuredClone(next.authority);
    if (nextAuthority.admission.memberId !== authority.admission.memberId
        || nextAuthority.admission.communityId !== config.communityId) throw new Error('Account authority identity mismatch');
    const copyKey = await wallet.storageKey('accounting-device-copy');
    const context = utf8.encode(JSON.stringify(['cmeet.accounting-device.v1', config.communityId, authority.admission.memberId]));
    let snapshot;
    try {
      snapshot = next.device.snapshot(copyKey, context);
      const result = await call('renew', { authority: nextAuthority, snapshot, copyKey, context });
      authority = nextAuthority; device = next.device; initialized = Promise.resolve(result);
      return result;
    } catch (error) { terminate(); throw error; }
    finally { snapshot?.fill(0); copyKey.fill(0); }
  }
  async function evidence(method, { inbox, peer, answer }) {
    await start();
    const key = await wallet.storageKey('accounting-conversation-copy');
    const context = utf8.encode(JSON.stringify(['cmeet.accounting-conversation.v1', config.communityId, authority.admission.memberId]));
    let snapshot;
    try {
      snapshot = inbox.snapshot(key, context);
      return await call(method, { snapshot, key, context, peer, ...(answer === undefined ? {} : { answer }) });
    } finally { snapshot?.fill(0); key.fill(0); }
  }
  return Object.freeze({ start, renew,
    peerIndex: async peerId => { await start(); return call('peerIndex', { peerId }); },
    activeReservation: async value => { await start(); return call('activeReservation', value); },
    provePeer: async (event, context) => { await start(); return call('provePeer', { event, context }); },
    verifyPeer: async (evidenceBytes, contextJson, own) => { await start(); return call('verifyPeer', { evidenceBytes, contextJson, own }); },
    receipt: value => evidence('receipt', value),
    acknowledgment: value => evidence('acknowledgment', value),
    settle: async value => { await start(); return call('settle', value); },
    maintain: async () => {
      await start();
      const result = await call('maintain');
      initialized = Promise.resolve(result);
      return result;
    },
    close,
  });
}
