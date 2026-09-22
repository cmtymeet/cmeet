// CI-only controlled clock. All cryptography, encrypted IndexedDB persistence,
// account transport, signed enrollment and release gates are production code.
import * as cmsg from '@corbet-labs/cmsg';
import wasmUrl from '@corbet-labs/cmsg/wasm-binary?url';
import { createWallet } from '@corbet-labs/cvld/client';
import { createAccountingSession } from '../../src/lib/accounting.js';
import { openWalletStore } from '../../src/lib/wallet-store.js';
import { encode, utf8 } from '../../src/lib/encoding.js';

let fixtureNow = 1000;
Date.now = () => fixtureNow * 1000;
const NativeWorker = globalThis.Worker, workers = new Set();
globalThis.Worker = class extends NativeWorker {
  constructor(url, options) {
    const bootstrap = `let now = ${fixtureNow}; Date.now = () => now * 1000;
      addEventListener('message', event => { if (event.data?.kind === 'fixtureClock') {
        now = event.data.now; event.stopImmediatePropagation(); } });
      await import(${JSON.stringify(new URL(url, location.href).href)});`;
    const objectUrl = URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' }));
    super(objectUrl, { ...options, type: 'module' });
    this.objectUrl = objectUrl; workers.add(this);
  }
  terminate() { super.terminate(); URL.revokeObjectURL(this.objectUrl); workers.delete(this); }
};
const json = value => utf8.encode(JSON.stringify(value));
const random = () => crypto.getRandomValues(new Uint8Array(32));
const check = async (value, label) => { if (!value) throw new Error(label); await window.fixtureReport(label); };
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
    authority: { admission, authorization }, memberId: identity.memberId(), guarded: 0, staged: false };
  value.key = await wallet.storageKey('fixture-conversation'); value.context = utf8.encode('cmeet.accounting-fixture.conversation.v1');
  value.persist = inboxStore.persist(value.memberId);
  value.args = [value.key, value.context, value.persist];
  value.open = () => createAccountingSession({ api: { request }, store, wallet, device: value.device,
    authority: value.authority, config, async beforeAccountApply() {
      if (value.staged) await value.inbox.invalidateReservation(...value.args);
      value.guarded++;
    } });
  value.session = await value.open(); clients.push(value); return value;
}
const contexts = value => JSON.parse(value.inbox.reservationContexts());
const verifier = value => (bytes, context, own) => value.session.verifyPeer(bytes, context, own);

window.runAccountingFixture = async config => {
  await cmsg.init({ module_or_path: wasmUrl });
  inboxStore = await cmsg.openIndexedDbInboxStore('cmeet-accounting-contract-inboxes');
  const a = await client(config), b = await client(config);
  try {
    const started = await a.session.start();
    await check(started.status === 'eligible' && started.acceptedVersion === 0, 'real Worker factory proves and durably accepts genesis');
    const pending = await b.session.start();
    await check(pending.status === 'pending' && pending.eligibleAt === 1100, 'frozen common roster reports pending without a second genesis');
    await advance(1100);
    const preserved = await a.session.maintain(), joined = await b.session.maintain();
    await check(preserved.acceptedVersion === 0 && joined.acceptedVersion === 0,
      'verified roster refresh preserves accepted state and admits the pending member next slot');
    const nonce = random(), openedAt = fixtureNow, expiresAt = fixtureNow + config.accounting.policy.abandonAfter;
    const cp = { response_deadline: expiresAt, max_intro_bytes: 2048 };
    const rp = { statePolicyDigest: started.statePolicyDigest, openedAt, abandonAfter: config.accounting.policy.abandonAfter };
    await a.inbox.createGroup(...a.args);
    const packageBytes = await b.inbox.keyPackage(...b.args);
    const invitation = await a.inbox.add(packageBytes, ...a.args); packageBytes.fill(0);
    let offered, staged;
    try {
      await a.inbox.beginFirstContact(b.memberId, nonce, 'initiator', expiresAt, cp.max_intro_bytes, ...a.args);
      offered = JSON.parse(await a.inbox.requireActiveReservations(JSON.stringify(rp), ...a.args));
      staged = JSON.parse(await b.inbox.stageAccountedInvitation(invitation.welcome, nonce, JSON.stringify(cp), JSON.stringify(rp), ...b.args));
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
    const closeWire = await b.inbox.closeContact(...b.args);
    closeWire.fill(0); // This lane tests the authenticated local Close evidence, not delivery.
    const receipt = await b.session.receipt({ inbox: b.inbox, peer: a.memberId });
    const settled = await b.session.settle({ event: incoming.event, receipt });
    await check(settled.acceptedVersion === 3, 'actual cmsg P256 Close receipt settles the recipient through the real account circuit');
    await refuses(() => a.session.settle({ event: outgoing.event, receipt }), 'recipient Close cannot accelerate the initiator fixed refund date');
    await advance(1300);
    const fresh = cmsg.BrowserMember.restore(a.unbound, a.copyKey, a.copyContext);
    const authorization = JSON.parse(a.identity.authorizeDevice(fresh.chatPublicKey(), fixtureNow, 9000));
    const admission = await window.fixtureControl('grant', { memberId: a.memberId, chatPublicKey: encode(fresh.chatPublicKey()) });
    fresh.bindDeviceAdmission(JSON.stringify(admission), JSON.stringify(config.admissionTrust), JSON.stringify(authorization));
    const renewed = await a.session.renew({ device: fresh, authority: { admission, authorization } });
    a.device.free(); a.device = fresh; a.authority = { admission, authorization };
    await check(renewed.acceptedVersion === 3 && renewed.refilled === true && renewed.currentRootAccepted === true,
      'same-key delegation renewal plus a due zero-credit refill accepts the new common root');
    await refuses(() => a.session.verifyPeer(json(outgoing.proof), JSON.stringify(contexts(a).outgoing), true), 'superseded own proof cannot authorize release after a successor');
    await advance(1700);
    const expired = await a.session.maintain();
    await check(expired.slots.some(slot => slot.event === outgoing.event && slot.phase === 5), 'outgoing obligation retires only after its original common lease');
    await refuses(() => a.session.activeReservation(outgoingInput), 'retired event tombstone cannot be reused as a fresh reservation');
    const persisted = await a.store.read();
    await check(typeof persisted.accountingJournal.ciphertext === 'string' && persisted.accountingMaterial.envelope.version === 1
      && !JSON.stringify(persisted).includes('ownerSecret'), 'main-thread wallet records contain encrypted key material and account journal only');
    await window.fixtureControl('verifyTransport', { guarded: a.guarded + b.guarded });
    return { checksComplete: true, accounts: 2, releaseScope: 'real staged admission and Close settlement; no live message or Tor claim' };
  } finally {
    for (const value of clients) {
      await value.session.close().catch(() => {});
      value.inbox.free(); value.device.free(); value.identity.free(); value.store.close();
      value.key.fill(0); value.copyKey.fill(0); value.unbound.fill(0);
    }
    inboxStore.close();
  }
};
