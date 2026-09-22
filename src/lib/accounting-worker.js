import * as cmsg from '@corbet-labs/cmsg';
import cmsgWasmUrl from '@corbet-labs/cmsg/wasm-binary?url';
import { sealLocalState, openLocalState } from '@corbet-labs/cvld/client';
import { createAccountProver, createAccountActor, createEnrollmentClient, artifactFetcher,
  statePolicyDigest, validityHorizon } from 'cfrm/accounting';
import { encode, decode, utf8, decoder, exact, positive } from './encoding.js';

const pending = new Map();
let sequence = 0, busy = false, settings, authority, trustJson, community, ownerId;
let runtime, anchor, accountingKey, actor, enrollmentClient, verified, material, materialRevision = 0;
let walletKey, privateContext, keyContext, stateDigest;
const now = () => Math.floor(Date.now() / 1000);
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const unhex = value => {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(value)) throw new Error('Accounting hex encoding');
  return Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
};
const field = value => unhex(BigInt(value).toString(16).padStart(64, '0'));
const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
function rpc(method, input = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Accounting host deadline')); }, settings.workerDeadlineMs);
    pending.set(id, { resolve, reject, timer });
    postMessage({ kind: 'rpc', id, method, input });
  });
}
function requestExpiry(at = now()) {
  const expires = Math.min(now() + settings.requestSeconds, Number(validityHorizon(at, settings.policy)),
    authority.admission.expiresAt, authority.authorization.expiresAt);
  if (expires <= now()) throw new Error('Account proof window expired'); return expires;
}
async function saveMaterial() {
  const revision = materialRevision + 1;
  const plaintext = utf8.encode(JSON.stringify({ revision, material }));
  let envelope;
  try {
    if (plaintext.length > settings.maxJournalBytes) throw new Error('Accounting material bound');
    envelope = await sealLocalState({ data: plaintext, key: walletKey, context: privateContext });
  }
  finally { plaintext.fill(0); }
  const record = { revision, envelope };
  if (await rpc('saveMaterial', { expectedRevision: materialRevision, record }) !== true) throw new Error('Accounting key persistence failed');
  materialRevision = record.revision;
}
async function renewDelegation() {
  const expires = Math.min(authority.admission.expiresAt, authority.authorization.expiresAt, settings.policy.policyValidUntil);
  if (expires <= now()) throw new Error('Fresh member authority required');
  const previous = material.delegation;
  if (previous && previous.expiresAt > now() && canonical(previous.admission) === canonical(authority.admission)
      && canonical(previous.authorization) === canonical(authority.authorization)) {
    cmsg.verifyAccountingDelegation(JSON.stringify(previous), trustJson, now());
    return false;
  }
  const secret = unhex(material.ownerSecret);
  let commitment;
  try { commitment = await runtime.hashes.secretHash(community, secret); } finally { secret.fill(0); }
  const delegation = JSON.parse(anchor.delegateAccounting(accountingKey, 'poseidon2-bn254-fixed-128-v1', commitment, expires));
  if (delegation.accountPublicKey !== material.publicKey || delegation.stateSecretCommitment !== hex(commitment)
      || canonical(delegation.admission) !== canonical(authority.admission)
      || canonical(delegation.authorization) !== canonical(authority.authorization)) throw new Error('Accounting anchor authority differs');
  cmsg.verifyAccountingDelegation(JSON.stringify(delegation), trustJson, now());
  // Only the publication candidate changes. Existing accepted slot headers keep
  // their original authority, and no account state or key is recreated.
  material.delegation = delegation;
  await saveMaterial();
  return true;
}
async function initialize(input) {
  if (runtime || actor) throw new Error('Accounting worker already initialized');
  settings = structuredClone(input.settings); authority = structuredClone(input.authority);
  positive(settings.workerDeadlineMs); positive(settings.requestSeconds);
  positive(settings.checkpointPeriodSeconds); positive(settings.maxJournalBytes); positive(settings.maxCiphertextBytes);
  exact(settings.artifactLimits, ['maxArtifactBytes', 'maxTotalBytes', 'maxProofBytes', 'memoryPages']);
  for (const value of Object.values(settings.artifactLimits)) positive(value);
  exact(input.trust, ['community_id', 'policy_digest', 'issuer_public_key']);
  if (input.trust.community_id !== input.communityId || authority.admission.communityId !== input.communityId) throw new Error('Accounting community mismatch');
  trustJson = JSON.stringify(input.trust);
  ownerId = authority.admission.memberId;
  community = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(input.communityId)));
  walletKey = new Uint8Array(input.key);
  if (walletKey.length !== 32) throw new Error('Accounting wallet key');
  privateContext = `cmeet.accounting.private.v1/${hex(new Uint8Array(await crypto.subtle.digest('SHA-256',
    utf8.encode(JSON.stringify(['cmeet.accounting.private.v1', input.communityId, ownerId])))))}`;
  keyContext = utf8.encode(JSON.stringify(['cmeet.accounting.p256.v1', input.communityId, ownerId]));
  await cmsg.init({ module_or_path: new URL(cmsgWasmUrl, import.meta.url).href });
  let copied;
  try {
    copied = cmsg.BrowserMember.restore(input.snapshot, input.copyKey, input.context);
    if (copied.memberId() !== ownerId || encode(copied.chatPublicKey()) !== authority.admission.chatPublicKey) throw new Error('Accounting device binding');
    anchor = cmsg.BrowserInbox.newAccounted(copied); copied = null;
  } finally { copied?.free(); input.copyKey.fill(0); input.key.fill(0); input.snapshot.fill(0); }
  const readArtifact = artifactFetcher(new URL(settings.artifactBaseUrl, self.location.href));
  const manifestBytes = await readArtifact('manifest.json', Math.min(settings.artifactLimits.maxArtifactBytes, 1024 * 1024));
  runtime = await createAccountProver({ manifestBytes, manifestSha256: settings.manifestSha256,
    readArtifact, limits: settings.artifactLimits, peerReservations: true, operatorPublicKey: decode(settings.operatorPublicKey, 32) });
  const saved = await rpc('loadMaterial');
  if (saved) {
    exact(saved, ['revision', 'envelope']); positive(saved.revision);
    const plaintext = await openLocalState({ envelope: saved.envelope, key: walletKey, context: privateContext });
    try {
      if (plaintext.length > settings.maxJournalBytes) throw new Error('Accounting material bound');
      const opened = JSON.parse(decoder.decode(plaintext));
      exact(opened, ['revision', 'material']);
      if (opened.revision !== saved.revision) throw new Error('Accounting material revision');
      material = opened.material;
    } finally { plaintext.fill(0); }
    exact(material, ['version', 'ownerSecret', 'publicKey', 'sealedKey', 'delegation']);
    if (material.version !== 1 || unhex(material.ownerSecret).length !== 32 || unhex(material.publicKey).length !== 64) throw new Error('Accounting material rejected');
    accountingKey = cmsg.BrowserAccountingKey.restore(decode(material.sealedKey, settings.maxCiphertextBytes),
      walletKey, input.communityId, ownerId, unhex(material.publicKey), keyContext);
    materialRevision = saved.revision;
  } else {
    accountingKey = new cmsg.BrowserAccountingKey(anchor);
    const secret = crypto.getRandomValues(new Uint8Array(32));
    material = { version: 1, ownerSecret: hex(secret), publicKey: hex(accountingKey.publicKey()),
      sealedKey: encode(accountingKey.seal(walletKey, keyContext)), delegation: null };
    secret.fill(0);
    await saveMaterial();
  }
  await renewDelegation();
  const operator = await crypto.subtle.importKey('raw', decode(settings.operatorPublicKey, 32), 'Ed25519', false, ['verify']);
  enrollmentClient = createEnrollmentClient({ communityId: input.communityId, policyDigest: input.trust.policy_digest,
    community, hashes: runtime.hashes, clock: now, checkpointPeriodSeconds: settings.checkpointPeriodSeconds,
    transport: envelope => rpc('enrollment', envelope),
    verifyDelegation: ({ delegation, now: at }) => cmsg.verifyAccountingDelegation(JSON.stringify(delegation), trustJson, at),
    async verifyPublication(publication, { bytes }) {
      if (!await crypto.subtle.verify('Ed25519', operator, decode(publication.signature, 64), bytes)) throw new Error('Common enrollment signature');
      return true;
    },
  });
  stateDigest = await statePolicyDigest(community, settings.policy);
  return acquireAccount();
}
async function acquireAccount() {
  verified = await enrollmentClient.acquire(material.delegation);
  if (verified.status === 'pending') return { status: 'pending', eligibleAt: verified.eligibleAt,
    statePolicyDigest: Array.from(stateDigest) };
  const ownerIndex = verified.entries.findIndex(entry => entry.memberId === ownerId);
  const secret = unhex(material.ownerSecret);
  try {
    actor = await createAccountActor({ runtime, community, policy: settings.policy, enrollment: verified.checkpoint,
      expectedEnrollmentRoot: Uint8Array.from(verified.publication.root), ownerIndex, ownerSecret: secret,
      operatorPublicKey: decode(settings.operatorPublicKey, 32), clock: now,
      authority: () => ({ grant: authority.admission, authorization: authority.authorization }),
      authorizeRequest: value => anchor.authorizeAccountRequest(Uint8Array.from(value.requestId), Uint8Array.from(value.circuitDigest),
        Uint8Array.from(value.verifyingKeyDigest), Uint8Array.from(value.statementDigest), Uint8Array.from(value.proofDigest), value.issuedAt, value.expiresAt),
      authorizeStatus: value => anchor.authorizeAccountStatus(value.requestId === null ? undefined : Uint8Array.from(value.requestId),
        Uint8Array.from(value.challenge), value.issuedAt, value.expiresAt),
      transport: envelope => rpc('account', envelope), checkpointLimits: settings.checkpointLimits,
      maxJournalBytes: settings.maxJournalBytes, maxCiphertextBytes: settings.maxCiphertextBytes,
      storage: {
        load: () => rpc('loadJournal'),
        compareAndSwap: (expectedRevision, record) => rpc('saveJournal', { expectedRevision, record }),
        async seal(data) { return utf8.encode(JSON.stringify(await sealLocalState({ data, key: walletKey, context: `${privateContext}/journal` }))); },
        async open(bytes) { return openLocalState({ envelope: JSON.parse(decoder.decode(bytes)), key: walletKey, context: `${privateContext}/journal` }); },
      },
    });
  } finally { secret.fill(0); }
  await actor.recover({ expiresAt: requestExpiry() });
  if (!actor.accepted()) await actor.genesis({ expiresAt: requestExpiry() });
  return publicAccount();
}
function publicAccount() {
  const accepted = actor.accepted();
  return { status: 'eligible', accepted, acceptedVersion: accepted?.statement.nextVersion ?? null,
    statePolicyDigest: Array.from(stateDigest) };
}
function requireCurrentEnrollment() {
  const at = now();
  if (!verified || verified.status !== 'eligible' || at < verified.publication.notBefore
      || at >= verified.publication.expiresAt) throw new Error('Current common enrollment required');
}
async function peerContext(nativeInput, acceptance, event = null) {
  requireCurrentEnrollment();
  const native = typeof nativeInput === 'string' ? JSON.parse(nativeInput) : structuredClone(nativeInput);
  exact(native, ['now', 'devicePublicKey', 'expected']);
  const expected = native.expected;
  if (!equal(expected.community, Array.from(community))) throw new Error('Peer community mismatch');
  const owner = encode(Uint8Array.from(expected.owner));
  const ownerIsLocal = owner === ownerId;
  if (!ownerIsLocal && encode(Uint8Array.from(expected.peer)) !== ownerId) throw new Error('Peer reservation participant');
  // cmsg exposes both directions of one reservation. For the local account
  // actor, a context owned by the peer is the opposite role and names the
  // local member as its peer. Resolve that context back to the authenticated
  // retained slot before selecting its historical authority.
  const actorRole = ownerIsLocal ? expected.role : 1 - expected.role;
  const actorPeer = ownerIsLocal ? expected.peer : expected.owner;
  if (![0, 1].includes(actorRole) || !Array.isArray(actorPeer) || actorPeer.length !== 32) throw new Error('Peer reservation role');
  const retained = actor.reservation({ role: actorRole, peer: Uint8Array.from(actorPeer),
    nonce: Uint8Array.from(expected.nonce), group: Uint8Array.from(expected.group),
    contactPolicy: Uint8Array.from(expected.contactPolicyDigest), openedAt: expected.openedAt, expiresAt: expected.expiresAt });
  if ((ownerIsLocal && !retained) || (event !== null && (!ownerIsLocal || retained?.event !== BigInt(event).toString()))) {
    throw new Error('Peer reservation is not retained');
  }
  const index = verified.entries.findIndex(entry => entry.memberId === owner);
  const wrapper = verified.publication.delegations.find(item => item.entry.memberId === owner);
  if (index < 0 || !wrapper) throw new Error('Peer is absent from verified enrollment');
  const delegation = wrapper.delegation;
  const digest = cmsg.verifyAccountingDelegation(JSON.stringify(delegation), trustJson, now());
  if (hex(digest) !== verified.entries[index].delegationDigest
      || !equal(decode(delegation.authorization.devicePublicKey, 32), native.devicePublicKey)
      || delegation.accountPublicKey !== verified.entries[index].accountKey) throw new Error('Peer device differs from enrolled authority');
  // A recipient verifies the offered outgoing proof before consenting to any
  // local reservation. Only that initial peer path uses the current roster.
  // Once a local slot exists, both directions retain their original authority.
  const retainedAuthority = retained ? (ownerIsLocal ? retained.ownerAuthority : retained.peerAuthority)
    : Array.from(field(verified.checkpoint.entries[index].leaf));
  if (!Array.isArray(retainedAuthority) || retainedAuthority.length !== 32) throw new Error('Peer reservation authority');
  return { now: native.now, expected: { ...expected,
    ownerAuthority: retainedAuthority, statePolicyDigest: Array.from(stateDigest),
    stateVersion: acceptance.statement.nextVersion, stateCommitment: acceptance.statement.nextState },
    accountPolicy: settings.policy, enrollmentRoot: verified.publication.root,
    authorityExpiresAt: Math.min(delegation.expiresAt, delegation.admission.expiresAt, delegation.authorization.expiresAt,
      verified.publication.expiresAt) };
}
async function provePeer(event, context) {
  const result = await actor.provePeer(event, await peerContext(context, actor.accepted(), event), { expiresAt: requestExpiry() });
  requireCurrentEnrollment();
  return result;
}
async function conversationEvidence(method, input) {
  let inbox;
  try {
    requireCurrentEnrollment();
    inbox = cmsg.BrowserInbox.restore(input.snapshot, input.key, input.context);
    if (inbox.memberId() !== ownerId || !equal(inbox.chatPublicKey(), anchor.chatPublicKey())) throw new Error('Accounting conversation signer mismatch');
    // A renewed delegation may be queued for the next common slot. Sign with
    // the currently published authority so replacement membership is provable.
    const published = verified.publication.delegations.find(value => value.entry.memberId === ownerId);
    if (!published || published.delegation.accountPublicKey !== material.publicKey) throw new Error('Current receipt authority unavailable');
    cmsg.verifyAccountingDelegation(JSON.stringify(published.delegation), trustJson, now());
    const delegation = JSON.stringify(published.delegation);
    const result = method === 'receipt' ? inbox.accountingReceipt(input.peer, accountingKey, delegation)
      : inbox.accountingAcknowledgment(input.peer, accountingKey, delegation, JSON.stringify(input.answer));
    return JSON.parse(result);
  } finally { inbox?.free(); input.key.fill(0); input.snapshot.fill(0); }
}
async function settle(input) {
  const retained = actor.settlementAuthorities(input.event), receipt = input.receipt;
  const slot = actor.slots().find(value => value.event === BigInt(input.event).toString());
  if (!slot) throw new Error('Unknown accounting settlement');
  function receiptAuthority(delegation, digest, member, originalDigest) {
    if (equal(digest, originalDigest)) return { digest, enrollment: undefined };
    requireCurrentEnrollment();
    const index = verified.entries.findIndex(value => value.memberId === encode(Uint8Array.from(member))
      && value.delegationDigest === hex(digest));
    if (index < 0) throw new Error('Replacement receipt authority is not currently enrolled');
    if (!equal(cmsg.verifyAccountingDelegation(JSON.stringify(delegation), trustJson, now()), digest)) throw new Error('Replacement receipt authority');
    return { digest, enrollment: verified.checkpoint.entries[index] };
  }
  const unsignedReceipt = cmsg.accountingReceiptSigningBytes(JSON.stringify(receipt));
  if (unsignedReceipt.length !== 357) throw new Error('Accounting receipt transcript');
  const recipient = receiptAuthority(receipt.delegation, unsignedReceipt.slice(219, 251), retained.role === 1 ? retained.owner : retained.peer,
    retained.role === 1 ? retained.ownerDelegationDigest : retained.peerDelegationDigest);
  const recipientDigest = recipient.digest;
  const bytes = cmsg.verifyHistoricalAccountingReceipt(JSON.stringify(receipt), trustJson, recipientDigest, now());
  if (bytes.length !== 357) throw new Error('Accounting receipt transcript');
  const matched = actor.reservation({ peer: Uint8Array.from(retained.peer), role: retained.role,
    nonce: bytes.slice(155, 187), group: bytes.slice(187, 219), contactPolicy: bytes.slice(251, 283),
    openedAt: slot.openedAt, expiresAt: slot.expiresAt });
  if (matched?.event !== slot.event || !equal(bytes.slice(59, 91), retained.role === 1 ? retained.owner : retained.peer)
      || !equal(bytes.slice(91, 123), retained.role === 0 ? retained.owner : retained.peer)) throw new Error('Accounting receipt obligation mismatch');
  const integer = value => new DataView(value.buffer, value.byteOffset, value.byteLength).getBigUint64(0);
  const resolution = { kind: bytes[347], issuedAt: integer(bytes.slice(349)), historyDigest: bytes.slice(283, 315),
    ed25519ReceiptDigest: bytes.slice(315, 347), signature: Uint8Array.from(receipt.signature) };
  let acknowledgment;
  let initiator;
  if (input.acknowledgment !== undefined && input.acknowledgment !== null) {
    const ack = input.acknowledgment;
    const unsignedAck = cmsg.accountingAcknowledgmentSigningBytes(JSON.stringify(ack));
    if (unsignedAck.length !== 255) throw new Error('Accounting ACK transcript');
    initiator = receiptAuthority(ack.delegation, unsignedAck.slice(215, 247), retained.role === 0 ? retained.owner : retained.peer,
      retained.role === 0 ? retained.ownerDelegationDigest : retained.peerDelegationDigest);
    const transcript = cmsg.verifyHistoricalAccountingAcknowledgment(JSON.stringify(ack), trustJson, recipientDigest, initiator.digest, now());
    if (transcript.length !== 255 || !equal(cmsg.accountingReceiptSigningBytes(JSON.stringify(ack.answer)), bytes)
        || !equal(ack.answer.signature, receipt.signature)) throw new Error('Accounting ACK answer binding');
    acknowledgment = { issuedAt: integer(transcript.slice(247)), signature: Uint8Array.from(ack.signature) };
  }
  // An uncertain apply may already have been installed by recover. This is an
  // idempotent report of the retained accepted phase, never another settlement.
  if (slot.phase === 3) return { acceptance: actor.accepted(), event: slot.event, alreadySettled: true,
    acceptedVersion: actor.accepted().statement.nextVersion };
  const result = await actor.settle({ event: BigInt(input.event), resolution, acknowledgment,
    peerEnrollment: retained.role === 0 ? recipient.enrollment : initiator?.enrollment,
    receiptOwnerEnrollment: retained.role === 1 ? recipient.enrollment : undefined }, { expiresAt: requestExpiry() });
  return { ...result, acceptedVersion: result.acceptance.statement.nextVersion };
}
async function run(method, input) {
  if (method === 'initialize') return initialize(input);
  if (method === 'close') {
    await actor?.close(); await runtime?.destroy();
    accountingKey?.free(); anchor?.free(); walletKey?.fill(0);
    actor = runtime = accountingKey = anchor = walletKey = material = verified = null;
    return true;
  }
  if (method === 'renew') {
    if (!anchor || !enrollmentClient) throw new Error('Accounting worker is not initialized');
    const nextAuthority = structuredClone(input.authority);
    let copied, nextAnchor;
    try {
      copied = cmsg.BrowserMember.restore(input.snapshot, input.copyKey, input.context);
      if (copied.memberId() !== ownerId || nextAuthority.admission.memberId !== ownerId
          || !equal(copied.chatPublicKey(), anchor.chatPublicKey())
          || encode(copied.chatPublicKey()) !== nextAuthority.admission.chatPublicKey) throw new Error('Accounting same-device renewal');
      nextAnchor = cmsg.BrowserInbox.newAccounted(copied); copied = null;
      anchor.free(); anchor = nextAnchor; nextAnchor = null; authority = nextAuthority;
      await renewDelegation();
      return actor ? run('maintain', {}) : acquireAccount();
    } finally { copied?.free(); nextAnchor?.free(); input.copyKey.fill(0); input.snapshot.fill(0); }
  }
  if (method === 'maintain' && !actor && enrollmentClient) return acquireAccount();
  if (!actor) throw new Error('Accounting worker is not initialized');
  if (method === 'peerIndex') return actor.peerIndex(input.peerId);
  if (method === 'activeReservation') {
    const context = typeof input.context === 'string' ? JSON.parse(input.context) : input.context;
    const expected = context.expected;
    if (![0, 1].includes(input.role) || expected.role !== input.role || encode(Uint8Array.from(expected.owner)) !== ownerId
        || encode(Uint8Array.from(expected.peer)) !== input.peerId || expected.openedAt !== input.openedAt
        || expected.expiresAt !== input.expiresAt) throw new Error('Accounting reservation context');
    await actor.recover({ expiresAt: requestExpiry() });
    const reservation = { role: input.role, nonce: Uint8Array.from(expected.nonce), group: Uint8Array.from(expected.group),
      contactPolicy: Uint8Array.from(expected.contactPolicyDigest), openedAt: input.openedAt, expiresAt: input.expiresAt };
    let retained = actor.reservation({ ...reservation, peer: Uint8Array.from(expected.peer) });
    if (!retained) {
      const result = await actor.reserve({ ...reservation, peerIndex: actor.peerIndex(input.peerId) },
        { expiresAt: requestExpiry(input.role === 0 ? input.openedAt : now()) });
      retained = actor.reservation({ ...reservation, peer: Uint8Array.from(expected.peer) });
      if (!retained || retained.event !== BigInt(result.event).toString()) throw new Error('Created reservation is not retained');
    }
    if (retained.phase === 1) await actor.activate(retained.event, { expiresAt: requestExpiry() });
    else if (retained.phase !== 2) throw new Error('Reservation is already retired');
    return { event: retained.event, proof: await provePeer(retained.event, context), acceptedVersion: actor.accepted().statement.nextVersion };
  }
  if (method === 'provePeer') return provePeer(input.event, input.context);
  if (method === 'verifyPeer') {
    if (!(input.evidenceBytes instanceof Uint8Array) || input.evidenceBytes.length > settings.artifactLimits.maxProofBytes * 2 + 65536) throw new Error('Peer evidence bound');
    const record = JSON.parse(decoder.decode(input.evidenceBytes));
    return actor.verifyPeer(record, await peerContext(input.contextJson, record.accountAcceptance), { own: input.own, expiresAt: requestExpiry() });
  }
  if (method === 'receipt' || method === 'acknowledgment') return conversationEvidence(method, input);
  if (method === 'settle') { await actor.recover({ expiresAt: requestExpiry() }); return settle(input); }
  if (method === 'maintain') {
    // Resolve old signed bytes before replacing their independently verified
    // restoration context, including after an ambiguous local CAS.
    await actor.recover({ expiresAt: requestExpiry() });
    await renewDelegation();
    const current = await enrollmentClient.acquire(material.delegation);
    if (current.status === 'pending') return { status: 'pending', eligibleAt: current.eligibleAt,
      acceptedVersion: actor.accepted()?.statement.nextVersion ?? null, statePolicyDigest: Array.from(stateDigest) };
    if (current) { await actor.withEnrollment(current.checkpoint, Uint8Array.from(current.publication.root)); verified = current; }
    for (const slot of actor.slots()) {
      if (slot.role === 0 && slot.phase === 2 && slot.expiresAt <= now()) await actor.expire(slot.event, { expiresAt: requestExpiry() });
    }
    let refilled = false;
    try { await actor.refill({ expiresAt: requestExpiry() }); refilled = true; }
    catch (error) { if (error.message !== 'Refill not due') throw error; }
    return { ...publicAccount(), slots: actor.slots(), refilled,
      currentRootAccepted: equal(actor.accepted().statement.enrollmentRoot, verified.publication.root) };
  }
  throw new Error('Unsupported accounting worker operation');
}
self.onmessage = async ({ data }) => {
  if (data?.kind === 'rpcResult') {
    const promise = pending.get(data.id); if (!promise) return;
    clearTimeout(promise.timer); pending.delete(data.id);
    if (data.ok === true) promise.resolve(data.value); else promise.reject(new Error('Accounting host rejected operation'));
    return;
  }
  if (data?.kind !== 'call') return;
  if (busy) { postMessage({ kind: 'result', id: data.id, ok: false }); return; }
  busy = true;
  try { postMessage({ kind: 'result', id: data.id, ok: true, value: await run(data.method, data.input) }); }
  catch { postMessage({ kind: 'result', id: data.id, ok: false }); }
  finally { busy = false; }
};
