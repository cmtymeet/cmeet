// CI-only controlled clock. All cryptography, encrypted IndexedDB persistence,
// account transport, signed enrollment and release gates are production code.
import * as cmsg from '@corbet-labs/cmsg';
import wasmUrl from '@corbet-labs/cmsg/wasm-binary?url';
import { createWallet } from '@corbet-labs/cvld/client';
import { createAccountingSession } from '../../src/lib/accounting.js';
import { openWalletStore } from '../../src/lib/wallet-store.js';
import { encode, utf8 } from '../../src/lib/encoding.js';

// The driver supplies the same trusted CI clock before any member is created.
let fixtureNow = 5000;
Date.now = () => fixtureNow * 1000;
const NativeWorker = globalThis.Worker, workers = new Set();
globalThis.Worker = class extends NativeWorker {
  constructor(url, options) {
    const bootstrap = `let now = ${fixtureNow}, ready = false; const pending = [];
      Date.now = () => now * 1000;
      postMessage({ kind: 'fixtureBootstrap', phase: 'import-start' });
      addEventListener('message', event => {
        if (event.data?.kind === 'fixtureClock') {
          now = event.data.now; event.stopImmediatePropagation();
        } else if (!ready) {
          pending.push(event.data); event.stopImmediatePropagation();
        }
      });
      await import(${JSON.stringify(new URL(url, location.href).href)});
      ready = true;
      postMessage({ kind: 'fixtureBootstrap', phase: 'import-complete' });
      for (const data of pending) dispatchEvent(new MessageEvent('message', { data }));`;
    const objectUrl = URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' }));
    super(objectUrl, { ...options, type: 'module' });
    this.addEventListener('message', event => {
      const { data } = event;
      if (data?.kind === 'fixtureBootstrap') {
        event.stopImmediatePropagation();
        if (['import-start', 'import-complete'].includes(data.phase)) window.fixtureStage(`worker bootstrap ${data.phase}`).catch(() => {});
        return;
      }
      if (data?.kind === 'rpc' && ['loadMaterial', 'saveMaterial', 'loadJournal', 'saveJournal', 'account', 'enrollment'].includes(data.method)) {
        window.fixtureStage(`worker RPC ${data.method}`).catch(() => {});
      } else if (data?.kind === 'result') window.fixtureStage(`worker result ${data.ok === true ? 'accepted' : 'rejected'}`).catch(() => {});
    });
    this.objectUrl = objectUrl; workers.add(this);
  }
  terminate() { super.terminate(); URL.revokeObjectURL(this.objectUrl); workers.delete(this); }
};
const json = value => utf8.encode(JSON.stringify(value));
const random = () => crypto.getRandomValues(new Uint8Array(32));
const check = async (value, label) => { if (!value) throw new Error(label); await window.fixtureReport(label); };
async function stage(label, operation) {
  await window.fixtureStage(label);
  try {
    const value = await operation();
    await window.fixtureStage(label + ' complete');
    return value;
  } catch (error) { throw new Error(`${label}: ${String(error)}`); }
}
async function refuses(action, label) {
  let rejected = false; try { await action(); } catch { rejected = true; }
  await check(rejected, label);
}
async function advance(now) {
  await window.fixtureControl('advance', { now });
  fixtureNow = now;
  for (const worker of workers) worker.postMessage({ kind: 'fixtureClock', now });
}
async function request(path, { body } = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('Fixture public transport rejected');
  return response.json();
}
const sameBytes = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
// Scripted frame delivery only: all frames, signatures, release decisions and
// durable ACKs come from the generated cmsg implementation.
function framedPair(owners, { maxFrameBytes = 65_536, maxQueuedFrames = 16, readDeadlineMs = 10_000 } = {}) {
  const states = owners.map(() => ({ queue: [], reader: null }));
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    for (const state of states) {
      for (const bytes of state.queue.splice(0)) bytes.fill(0);
      state.reader?.reject(new Error('Scripted framed transport closed'));
    }
  }
  return states.map((state, index) => ({
    dropNext: false, dropped: 0,
    get closed() { return closed; },
    async send(bytes) {
      if (closed || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length > maxFrameBytes) throw new Error('Scripted frame bound');
      if (this.dropNext) { this.dropNext = false; this.dropped++; return; }
      const peer = states[1 - index], copy = bytes.slice();
      if (peer.reader) peer.reader.resolve(copy);
      else if (peer.queue.length < maxQueuedFrames) peer.queue.push(copy);
      else { copy.fill(0); close(); throw new Error('Scripted frame queue bound'); }
    },
    receive() {
      if (closed || state.reader || owners[index].scheduled) return Promise.reject(new Error('Scripted read state'));
      if (state.queue.length) return Promise.resolve(state.queue.shift());
      return new Promise((resolve, reject) => {
        const finish = action => value => { clearTimeout(timer); state.reader = null; action(value); };
        const timer = setTimeout(close, readDeadlineMs);
        state.reader = { resolve: finish(resolve), reject: finish(reject) };
      });
    },
    close,
  }));
}
async function restoreInbox(value) {
  await value.schedule('control', async () => {
    const record = await inboxStore.read(value.memberId);
    if (!(record?.checkpoint instanceof Uint8Array)) throw new Error('Missing durable Inbox checkpoint');
    try {
      const restored = cmsg.BrowserInbox.restore(record.checkpoint, value.key, value.context);
      value.inbox.free(); value.inbox = restored;
    } finally { record.checkpoint.fill(0); for (const wire of record.outbound) wire.fill(0); }
  });
}
async function firstMessage(a, b, until) {
  const streams = framedPair([a, b]), live = [];
  const openings = [a, b].map((value, index) => cmsg.LiveInboxStream.open(streams[index], value.inbox, {
    peerDevice: [b, a][index].inbox.chatPublicKey(), until, key: value.key, context: value.context,
    persist: value.persist, schedule: value.schedule,
  }).then(opened => { live[index] = opened; return opened; }));
  const payload = utf8.encode('First contact through real account proofs and MLS.');
  let messageId;
  try {
    await stage('open actual live MLS session over scripted frames', () => Promise.all(openings));
    await stage('send accounted first live message', () => live[0].send(payload));
    const sent = await a.schedule('control', () => JSON.parse(a.inbox.liveDeliveries()));
    await check(sent.length === 1 && sent[0].outgoing && sent[0].status === 'pending',
      'encrypted transport write alone leaves the first message unconfirmed');
    messageId = Uint8Array.from(sent[0].messageId);
    streams[1].dropNext = true;
    const received = await stage('authenticate and persist first live message', () => live[1].receive());
    try {
      const bytes = received.bytes;
      try { await check(received.kind === 'bytes' && received.memberId === a.memberId && sameBytes(bytes, payload),
        'real Active proofs release the exact first plaintext with its authenticated author'); }
      finally { bytes.fill(0); }
    } finally { received.free(); }
    await check(streams[1].dropped === 1 && JSON.parse(a.inbox.liveDeliveries())[0].status === 'pending',
      'a lost real delivery ACK never reports sender acceptance');
  } finally {
    streams[0].close();
    await Promise.allSettled(openings);
    const closing = await Promise.allSettled(live.map(value => value.close()));
    if (closing.some(result => result.status === 'rejected')) throw new Error('Durable live-session close failed');
  }
  await stage('restore encrypted live delivery journals', async () => {
    await restoreInbox(a); await restoreInbox(b);
  });
  const history = b.inbox.acceptedLiveHistory();
  try {
    const bytes = history[0]?.bytes;
    try { await check(history.length === 1 && history[0].memberId === a.memberId && bytes && sameBytes(bytes, payload)
      && JSON.parse(a.inbox.liveDeliveries())[0].status === 'canceledUnconfirmed'
      && a.inbox.liveSessions().length === 0 && b.inbox.liveSessions().length === 0,
      'encrypted checkpoint recovery retains authenticated history without restoring live transmission permission'); }
    finally { bytes?.fill(0); }
  } finally { for (const entry of history) entry.free(); payload.fill(0); }
  const recovery = framedPair([a, b]);
  try {
    await stage('recover original authenticated delivery ACK', async () => {
      const wire = await b.schedule('control', () => b.inbox.retransmitLiveAck(messageId, ...b.args));
      try { await recovery[1].send(wire); } finally { wire.fill(0); }
      const incoming = await recovery[0].receive();
      try {
        const received = await a.schedule('receive', () => a.inbox.receive(incoming, ...a.args));
        try { await check(received.kind === 'liveControl', 'recovered delivery ACK is authenticated control, never an application reply'); }
        finally { received.free(); }
      } finally { incoming.fill(0); }
      await b.schedule('control', () => b.inbox.clearLiveControls(...b.args));
    });
    await restoreInbox(a);
    const deliveries = JSON.parse(a.inbox.liveDeliveries());
    await check(deliveries.length === 1 && deliveries[0].status === 'accepted'
      && sameBytes(deliveries[0].messageId, messageId), 'retransmitted real ACK durably confirms the original message after restart');
    await check(!a.inbox.inboundResolutionReceipt(b.memberId) && !b.inbox.outboundResolutionReceipt(a.memberId),
      'first-message delivery ACK does not create Answer settlement evidence');
  } finally { recovery[0].close(); messageId.fill(0); }
}
const clients = [];
let inboxStore;
async function client(config) {
  const identity = new cmsg.BrowserIdentity(config.communityId), device = new cmsg.BrowserMember();
  const wallet = await createWallet({ prfOutput: random(), scope: `accounting-contract/${identity.memberId()}` });
  const copyKey = await wallet.storageKey('fixture-device-copy'), copyContext = utf8.encode('cmeet.accounting-fixture.device.v1');
  const unbound = device.snapshot(copyKey, copyContext);
  const authorization = JSON.parse(identity.authorizeDevice(device.chatPublicKey(), fixtureNow, 9000));
  const admission = await window.fixtureControl('grant', { memberId: identity.memberId(), chatPublicKey: encode(device.chatPublicKey()) });
  device.bindDeviceAdmission(JSON.stringify(admission), JSON.stringify(config.admissionTrust), JSON.stringify(authorization));
  const snapshot = device.snapshot(copyKey, copyContext);
  let copy = cmsg.BrowserMember.restore(snapshot, copyKey, copyContext);
  const inbox = cmsg.BrowserInbox.newAccounted(copy); copy = null; snapshot.fill(0);
  const store = await openWalletStore({ wallet, communityId: config.communityId, memberId: identity.memberId() });
  const value = { identity, device, wallet, store, inbox, copyKey, copyContext, unbound,
    authority: { admission, authorization }, memberId: identity.memberId(), guarded: 0, staged: false, scheduled: false };
  let inboxQueue = Promise.resolve();
  value.schedule = (category, operation) => {
    if (!['send', 'receive', 'control'].includes(category)) return Promise.reject(new Error('Unknown Inbox operation'));
    const next = inboxQueue.catch(() => {}).then(async () => {
      value.scheduled = true;
      try { return await operation(); } finally { value.scheduled = false; }
    });
    inboxQueue = next.catch(() => {}); return next;
  };
  value.key = await wallet.storageKey('fixture-conversation'); value.context = utf8.encode('cmeet.accounting-fixture.conversation.v1');
  value.persist = inboxStore.persist(value.memberId);
  value.args = [value.key, value.context, value.persist];
  value.open = () => createAccountingSession({ api: { request }, store, wallet, device: value.device,
    authority: value.authority, config, async beforeAccountApply() {
      if (value.staged) await value.schedule('control', () => value.inbox.invalidateReservation(...value.args));
      value.guarded++;
    } });
  value.session = await value.open(); clients.push(value); return value;
}
const contexts = value => JSON.parse(value.inbox.reservationContexts());
const verifier = value => (bytes, context, own) => value.session.verifyPeer(bytes, context, own);

window.runAccountingFixture = async config => {
  if (config.fixtureStart !== fixtureNow || fixtureNow <= 3600) throw new Error('Trusted fixture clock mismatch');
  await cmsg.init({ module_or_path: wasmUrl });
  inboxStore = await cmsg.openIndexedDbInboxStore('cmeet-accounting-contract-inboxes');
  const a = await client(config), b = await client(config);
  try {
    await window.fixtureStage('first account initialization submitted');
    const started = await a.session.start();
    await check(started.status === 'eligible' && started.acceptedVersion === 0, 'real Worker factory proves and durably accepts genesis');
    const pending = await b.session.start();
    await check(pending.status === 'pending' && pending.eligibleAt === config.fixtureStart + 100, 'frozen common roster reports pending without a second genesis');
    await advance(config.fixtureStart + 100);
    const preserved = await a.session.maintain(), joined = await b.session.maintain();
    await check(preserved.acceptedVersion === 0 && joined.acceptedVersion === 0,
      'verified roster refresh preserves accepted state and admits the pending member next slot');
    const nonce = random(), openedAt = fixtureNow, expiresAt = fixtureNow + config.accounting.policy.abandonAfter;
    const cp = { response_deadline: expiresAt, max_intro_bytes: 2048 };
    const rp = { statePolicyDigest: started.statePolicyDigest, openedAt, abandonAfter: config.accounting.policy.abandonAfter };
    await stage('create actual MLS group', () => a.inbox.createGroup(...a.args));
    const packageBytes = await stage('create actual MLS key package', () => b.inbox.keyPackage(...b.args));
    let invitation;
    try { invitation = await stage('add actual MLS key package', () => a.inbox.add(packageBytes, ...a.args)); }
    finally { packageBytes.fill(0); }
    let offered, staged;
    try {
      await stage('begin first-contact contract', () => a.inbox.beginFirstContact(b.memberId, nonce, 'initiator', expiresAt, cp.max_intro_bytes, ...a.args));
      offered = JSON.parse(await stage('require actual account reservations', () => a.inbox.requireActiveReservations(JSON.stringify(rp), ...a.args)));
      staged = JSON.parse(await stage('stage actual accounted MLS invitation', () => b.inbox.stageAccountedInvitation(invitation.welcome, nonce, JSON.stringify(cp), JSON.stringify(rp), ...b.args)));
    } finally { invitation.free(); }
    a.staged = b.staged = true;
    await a.inbox.setOwnReservationChallenge(Uint8Array.from(staged.outgoing.expected.challenge), ...a.args);
    await b.inbox.setOwnReservationChallenge(Uint8Array.from(offered.incoming.expected.challenge), ...b.args);
    const outgoingInput = { role: 0, peerId: b.memberId, context: contexts(a).outgoing, openedAt, expiresAt };
    await window.fixtureControl('loseNextApply', { memberId: a.memberId });
    await refuses(() => a.session.activeReservation(outgoingInput), 'lost accepted reserve response retains the exact signed pending state');
    const outgoing = await a.session.activeReservation(outgoingInput);
    await check(outgoing.acceptedVersion === 2, 'exact signed retry installs the reserve once and activates the same event');
    await b.session.verifyPeer(json(outgoing.proof), JSON.stringify(contexts(b).outgoing), false);
    await check(true, 'real peer factory proof verifies against the signed native acceptance');
    const wrong = structuredClone(contexts(b).outgoing); wrong.expected.challenge[0] ^= 1;
    await refuses(() => b.session.verifyPeer(json(outgoing.proof), JSON.stringify(wrong), false), 'fresh challenge substitution rejects');
    const corrupt = structuredClone(outgoing.proof); corrupt.proof = (corrupt.proof[0] === '0' ? '1' : '0') + corrupt.proof.slice(1);
    await refuses(() => b.session.verifyPeer(json(corrupt), JSON.stringify(contexts(b).outgoing), false), 'actual peer cryptographic verification rejects corrupted proof');
    await refuses(() => b.session.verifyPeer(json(outgoing.proof), JSON.stringify(contexts(b).outgoing), true), 'own-state verification rejects another accepted account');
    await b.inbox.authorizeIncomingReservation(json(outgoing.proof), verifier(b), ...b.args);
    const incoming = await b.session.activeReservation({ role: 1, peerId: a.memberId, context: contexts(b).incoming, openedAt, expiresAt });
    await b.inbox.completeAccountedInvitation(json(outgoing.proof), json(incoming.proof), verifier(b), ...b.args);
    await a.inbox.bindActiveReservations(json(outgoing.proof), json(incoming.proof), verifier(a), ...a.args);
    await check(incoming.acceptedVersion === 2, 'actual paired Active proofs complete the persisted cmsg staged admission');
    const repeated = await a.session.activeReservation(outgoingInput);
    await check(repeated.event === outgoing.event && repeated.acceptedVersion === 2, 'same reservation retry does not spend capacity again');
    await a.session.close(); a.session = await a.open();
    const restored = await a.session.start();
    await check(restored.acceptedVersion === 2, 'new Worker restores the encrypted accepted opening without reset or new genesis');
    await firstMessage(a, b, expiresAt);
    const closeWire = await b.inbox.closeContact(...b.args);
    closeWire.fill(0); // This lane tests the authenticated local Close evidence, not delivery.
    const receipt = await b.session.receipt({ inbox: b.inbox, peer: a.memberId });
    const settled = await b.session.settle({ event: incoming.event, receipt });
    await check(settled.acceptedVersion === 3, 'actual cmsg P256 Close receipt settles the recipient through the real account circuit');
    await refuses(() => a.session.settle({ event: outgoing.event, receipt }), 'recipient Close cannot accelerate the initiator fixed refund date');
    await advance(config.fixtureStart + 300);
    const fresh = cmsg.BrowserMember.restore(a.unbound, a.copyKey, a.copyContext);
    const authorization = JSON.parse(a.identity.authorizeDevice(fresh.chatPublicKey(), fixtureNow, 9000));
    const admission = await window.fixtureControl('grant', { memberId: a.memberId, chatPublicKey: encode(fresh.chatPublicKey()) });
    fresh.bindDeviceAdmission(JSON.stringify(admission), JSON.stringify(config.admissionTrust), JSON.stringify(authorization));
    const renewed = await a.session.renew({ device: fresh, authority: { admission, authorization } });
    a.device.free(); a.device = fresh; a.authority = { admission, authorization };
    await check(renewed.acceptedVersion === 3 && renewed.refilled === true && renewed.currentRootAccepted === true,
      'same-key delegation renewal plus a due zero-credit refill accepts the new common root');
    await refuses(() => a.session.verifyPeer(json(outgoing.proof), JSON.stringify(contexts(a).outgoing), true), 'superseded own proof cannot authorize release after a successor');
    const renewedInput = { ...outgoingInput, context: contexts(a).outgoing };
    const renewedReservation = await stage('prove existing Active reservation after delegation renewal', () => a.session.activeReservation(renewedInput));
    await stage('verify renewed original-slot proof against current own account', () =>
      a.session.verifyPeer(json(renewedReservation.proof), JSON.stringify(renewedInput.context), true));
    await check(renewedReservation.event === outgoing.event && renewedReservation.acceptedVersion === 3,
      'renewed roster verifies a fresh proof for the original slot authorities without spending capacity again');
    await advance(config.fixtureStart + 700);
    const expired = await a.session.maintain();
    await check(expired.slots.some(slot => slot.event === outgoing.event && slot.phase === 5), 'outgoing obligation retires only after its original common lease');
    await refuses(() => a.session.activeReservation(outgoingInput), 'retired event tombstone cannot be reused as a fresh reservation');
    const persisted = await a.store.read();
    await check(typeof persisted.accountingJournal.ciphertext === 'string' && persisted.accountingMaterial.envelope.version === 1
      && !JSON.stringify(persisted).includes('ownerSecret'), 'main-thread wallet records contain encrypted key material and account journal only');
    await window.fixtureControl('verifyTransport', { guarded: a.guarded + b.guarded });
    let productionConversations;
    if (config.conversationContract === true) {
      const { runProductionConversations } = await import('./conversations.mjs');
      productionConversations = await runProductionConversations({ clients, request, check, stage,
        config: { ...config, accounting: { ...config.accounting, statePolicyDigest: started.statePolicyDigest } },
        createTransport: () => framedPair([{}, {}], { maxFrameBytes: 1_048_576, maxQueuedFrames: 16, readDeadlineMs: 30_000 }),
      });
    }
    return { checksComplete: true, accounts: 2,
      productionConversations,
      releaseScope: 'real staged admission, encrypted first message, durable delivery ACK recovery and Close settlement over scripted frames; no Tor or UI claim' };
  } finally {
    await window.fixtureStage('close fixture workers');
    for (const value of clients) {
      await value.session.close().catch(() => {});
      value.inbox.free(); value.device.free(); value.identity.free(); value.store.close();
      value.key.fill(0); value.copyKey.fill(0); value.unbound.fill(0);
    }
    inboxStore.close();
  }
};
