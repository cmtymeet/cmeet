import * as cmsg from '@corbet-labs/cmsg';
import { createPeerChannel } from '@corbet-labs/cmsg/peer-channel';
import { createAccountingSession } from './accounting.js';
import { encode, decode, utf8, decoder, positive, exact } from './encoding.js';

const now = () => Math.floor(Date.now() / 1000);
const randomId = () => encode(crypto.getRandomValues(new Uint8Array(32)));
const memberId = value => { if (decode(value, 32).length !== 32) throw new Error('Invalid member'); return value; };
const parse = bytes => JSON.parse(decoder.decode(bytes));
const json = value => utf8.encode(JSON.stringify(value));
const MUTATIONS = new Set(['receive', 'beginLiveSession', 'clearLiveControlsFor', 'sendLiveBytes',
  'cancelLiveOpening', 'loseLiveSession', 'createGroup', 'keyPackage', 'add', 'beginFirstContact',
  'requireActiveReservations', 'setOwnReservationChallenge', 'authorizeIncomingReservation',
  'bindActiveReservations', 'stageAccountedInvitation', 'completeAccountedInvitation',
  'cancelAccountedInvitation', 'closeContact', 'applyDeadlines', 'renewDeviceAdmission', 'invalidateReservation']);

/** The website selects peers and renders messages. cmsg owns each durable MLS
 * journal and delivery gate; cfrm owns the account opening, proofs and ledger. */
export async function createConversations({ api, store, wallet, device, authority, config, openStream, onConversations, onMessages }) {
  const settings = config.messaging;
  if (!settings) throw new Error('Messaging configuration required');
  const maximum = positive(settings.maxConversations, 256), maxPending = positive(settings.maxPendingInvitations, 16);
  const maxMessages = positive(settings.maxMessages, 10_000), maxMessageBytes = positive(settings.maxMessageBytes, 16_384);
  const liveSeconds = positive(settings.liveSessionSeconds, 3600);
  positive(settings.handshakeDeadlineMs, 3_600_000); positive(settings.maxQueuedFrames, 32);
  positive(settings.keepaliveMs, Math.floor(config.tor.operationDeadlineMs / 2));
  const self = device.memberId(), community = config.communityId;
  const scope = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', json(['cmeet.conversations.v1', community, self]))));
  const authorityTag = encode(new Uint8Array(await crypto.subtle.digest('SHA-256',
    json(['cmeet.conversations.authority.v1', authority.admission, authority.authorization]))));
  const inboxStore = await cmsg.openIndexedDbInboxStore(`cmeet-inboxes-${scope}`);
  const wrappingKey = await wallet.storageKey('conversations');
  const saved = await store.read();
  const records = new Map(Object.entries(saved.conversations ?? {}));
  if (records.size > maximum) throw new Error('Conversation storage capacity exceeded');
  const rows = new Map(), profiles = new Map(), parked = new Set();
  let selected = null, closed = false, closing, pending = 0, accounting, accountQueue = Promise.resolve();
  function accountGate(action) {
    const next = accountQueue.catch(() => {}).then(action);
    accountQueue = next.catch(() => {}); return next;
  }
  const tasks = new Set();
  const requireOpen = () => { if (closed) throw new Error('Conversations are closed'); };
  function background(promise) {
    tasks.add(promise);
    promise.finally(() => tasks.delete(promise)).catch(() => {});
  }
  function summary(id, record = records.get(id)) {
    const row = rows.get(id), cached = profiles.get(id);
    const awaitingAnswer = record.phase === 'consented'
      || (record.phase === 'ready' && record.answerReceived !== true);
    return { id, memberId: id, displayName: cached?.displayName ?? record.displayName ?? 'Community member',
      online: Boolean(row?.live && !row.live.closed), contactState: awaitingAnswer ? 'awaitingAnswer' : record.phase,
      canSendIntroduction: awaitingAnswer && (record.role === 'initiator'
        ? !record.messages?.some(message => message.outgoing) : record.introReceived === true),
      pendingContact: record.phase === 'awaitingAcceptance',
      lastMessage: record.messages?.at(-1)?.text ?? '', role: record.role };
  }
  function emit() {
    onConversations?.(Array.from(records, ([id, value]) => summary(id, value)));
    if (selected) onMessages?.(structuredClone(records.get(selected)?.messages ?? []));
  }
  async function save(id, change) {
    let value;
    await store.update(state => {
      const conversations = state.conversations ?? {};
      value = change(structuredClone(conversations[id] ?? {}));
      return { ...state, conversations: { ...conversations, [id]: value } };
    });
    records.set(id, value); emit();
    return value;
  }
  async function load(id, role) {
    requireOpen(); memberId(id);
    if (id === self) throw new Error('A conversation needs another member');
    if (rows.has(id)) return rows.get(id);
    if (!records.has(id)) {
      if (records.size >= maximum) throw new Error('Conversation capacity reached');
      await save(id, () => ({ version: 1, role, phase: 'prepared', messages: [], displayName: profiles.get(id)?.displayName ?? 'Community member' }));
    }
    const context = utf8.encode(JSON.stringify(['cmeet.conversation.v1', community, self, id]));
    const durable = await inboxStore.read(id);
    let inbox, copied, snapshot;
    if (durable) inbox = cmsg.BrowserInbox.restore(durable.checkpoint, wrappingKey, context);
    else {
      const copyContext = utf8.encode('cmeet.copy-device.v1');
      try {
        snapshot = device.snapshot(wrappingKey, copyContext);
        copied = cmsg.BrowserMember.restore(snapshot, wrappingKey, copyContext);
        inbox = cmsg.BrowserInbox.newAccounted(copied); copied = null;
      } finally { copied?.free(); snapshot?.fill(0); }
    }
    if (inbox.memberId() !== self) { inbox.free(); throw new Error('Stored conversation identity mismatch'); }
    const row = { id, rawInbox: inbox, context, persist: inboxStore.persist(id), queue: Promise.resolve(),
      channel: null, live: null, needsRebind: true, ownProofValid: false,
      pendingAdmissionWires: records.get(id)?.admissionWire ? [decode(records.get(id).admissionWire)] : [] };
    row.mutate = action => {
      const next = row.queue.catch(() => {}).then(() => { requireOpen(); return action(); });
      row.queue = next.catch(() => {}); return next;
    };
    row.inbox = new Proxy(inbox, { get(target, name) {
      const value = target[name];
      if (typeof value !== 'function') return value;
      if (name === 'receive' || name === 'sendLiveBytes') return (...params) => accountGate(async () => {
        if (['ready', 'consented'].includes(records.get(id)?.phase)) await ensureBound(row);
        return row.mutate(() => value.apply(target, params));
      });
      return MUTATIONS.has(name) ? (...args) => row.mutate(() => value.apply(target, args)) : value.bind(target);
    } });
    rows.set(id, row);
    if (durable) await restoreDurableRow(row);
    return row;
  }
  const args = row => [wrappingKey, row.context, row.persist];
  const interruptedPhases = new Set(['offered', 'staged', 'awaitingPeer', 'awaitingAcceptance']);
  async function restoreDurableRow(row) {
    const record = records.get(row.id);
    if (!record) return;
    // cmsg restores the encrypted journal but intentionally cancels ephemeral
    // live sessions. The invitation peer channel has no resumable protocol, so
    // never expose a stale reservation as an actionable invitation after reload.
    if (interruptedPhases.has(record.phase)) {
      await row.inbox.cancelAccountedInvitation(...args(row));
      parked.delete(row.id);
      await save(row.id, value => ({ ...value, phase: 'closed', recovery: 'interrupted' }));
      return;
    }
    if (row.pendingAdmissionWires.length === 0 && (record.phase === 'ready' || record.phase === 'consented')
        && record.authorityTag !== authorityTag) {
      const wire = await row.inbox.renewDeviceAdmission(JSON.stringify(authority.admission),
        JSON.stringify(authority.authorization), ...args(row));
      if (!(wire instanceof Uint8Array) || wire.length === 0) throw new Error('Device admission renewal failed');
      row.pendingAdmissionWires.push(wire);
      await save(row.id, value => ({ ...value, authorityTag, admissionWire: encode(wire) }));
    }
    // BrowserInbox.restore cancels a live session which was active at the time
    // of the crash. Reconcile its durable delivery journal before rendering it.
    await updateDeliveries(row);
  }
  async function flushAdmission(row) {
    if (row.pendingAdmissionWires.length === 0) return;
    const wires = row.pendingAdmissionWires.splice(0);
    try {
      for (const wire of wires) await row.channel.lane('mls').send(wire);
      await save(row.id, value => ({ ...value, admissionWire: null, authorityTag }));
      for (const wire of wires) wire.fill?.(0);
    } catch (error) {
      row.pendingAdmissionWires.unshift(...wires);
      throw error;
    }
  }
  function channel(raw) {
    return createPeerChannel(raw, { maxFrameBytes: 1_048_575, maxQueuedFrames: settings.maxQueuedFrames,
      keepaliveMs: settings.keepaliveMs, receiveDeadlineMs: settings.handshakeDeadlineMs });
  }
  async function receive(lane, kind) {
    const message = parse(await lane.receive());
    if (message?.version !== 1 || message.kind !== kind) throw new Error('Conversation handshake rejected');
    return message;
  }
  const send = (lane, kind, value = {}) => lane.send(json({ version: 1, kind, ...value }));
  const contexts = row => row.mutate(() => JSON.parse(row.rawInbox.reservationContexts()));
  async function activate(row, role) {
    const record = records.get(row.id), expected = await contexts(row), context = role === 0 ? expected.outgoing : expected.incoming;
    const reserved = await accounting.activeReservation({ role, peerId: row.id, context,
      openedAt: record.openedAt, expiresAt: record.expiresAt });
    await save(row.id, value => ({ ...value, event: reserved.event }));
    row.ownProof = reserved.proof; row.ownProofValid = true;
    return reserved.proof;
  }
  const verifier = (bytes, context, own) => accounting.verifyPeer(bytes, context, own);
  async function bind(row, outgoingProof, incomingProof, complete = false) {
    const record = records.get(row.id), localOutgoing = record.role === 'initiator';
    const expected = await contexts(row);
    if (!row.ownProofValid) row.ownProof = await accounting.provePeer(record.event,
      localOutgoing ? expected.outgoing : expected.incoming);
    if (localOutgoing) outgoingProof = row.ownProof;
    else incomingProof = row.ownProof;
    const method = complete ? 'completeAccountedInvitation' : 'bindActiveReservations';
    await row.inbox[method](json(outgoingProof), json(incomingProof), verifier, ...args(row));
    await save(row.id, value => ({ ...value, outgoingProof, incomingProof }));
    row.needsRebind = false; row.ownProofValid = true;
  }
  async function ensureBound(row) {
    if (!row.needsRebind) return;
    const decision = await row.mutate(() => row.rawInbox.inboundResolutionReceipt(row.id) ?? row.rawInbox.outboundResolutionReceipt(row.id));
    if (decision && parse(decision).kind === 'answered') return;
    const record = records.get(row.id);
    if (!record.outgoingProof || !record.incomingProof) throw new Error('Active reservation evidence is unavailable');
    await bind(row, record.outgoingProof, record.incomingProof);
  }
  async function connected(row, lane, peerDevice, phase = 'ready') {
    const until = Math.min(now() + liveSeconds, authority.admission.expiresAt, authority.authorization.expiresAt);
    row.live = await cmsg.LiveInboxStream.open(row.channel.lane('mls'), row.inbox,
      { peerDevice, until, key: wrappingKey, context: row.context, persist: row.persist });
    await flushAdmission(row);
    await save(row.id, value => ({ ...value, phase, authorityTag,
      ...(phase === 'consented' ? { answerReceived: false } : {}) }));
    background(readMessages(row));
    background(readAccounting(row));
    background(sendReceipt(row));
    background(evidence(row));
    emit();
  }
  async function outgoing(row, opened) {
    row.channel = channel(opened.stream);
    const lane = row.channel.lane('invitation'), record = records.get(row.id);
    if (record.phase === 'ready' || record.phase === 'consented') {
      row.inbox.prepareAccountingContact(row.id);
      await send(lane, 'resume', { memberId: self, peerId: row.id });
      await receive(lane, 'resume');
      const peerDevice = records.get(row.id).peerDevice;
      if (!Array.isArray(peerDevice) || peerDevice.length === 0) throw new Error('Stored peer device is unavailable');
      await connected(row, lane, Uint8Array.from(peerDevice), record.phase);
      return;
    }
    if (record.phase !== 'prepared') throw new Error('This introduction must finish or expire before another starts');
    await send(lane, 'offer', { memberId: self, peerId: row.id });
    const reply = await receive(lane, 'keyPackage');
    exact(reply, ['version', 'kind', 'package']);
    await row.inbox.createGroup(...args(row));
    const invitation = await row.inbox.add(decode(reply.package), ...args(row));
    const nonce = randomId(), openedAt = now(), expiresAt = openedAt + config.accounting.policy.abandonAfter;
    if (expiresAt >= config.accounting.policy.policyValidUntil || expiresAt >= authority.admission.expiresAt || expiresAt >= authority.authorization.expiresAt) throw new Error('The admission interval is too short for this introduction');
    const contactPolicy = { response_deadline: expiresAt, max_intro_bytes: maxMessageBytes + 256 };
    const reservationPolicy = { statePolicyDigest: config.accounting.statePolicyDigest, openedAt,
      abandonAfter: config.accounting.policy.abandonAfter };
    await row.inbox.beginFirstContact(row.id, decode(nonce), 'initiator', expiresAt, contactPolicy.max_intro_bytes, ...args(row));
    const own = JSON.parse(await row.inbox.requireActiveReservations(JSON.stringify(reservationPolicy), ...args(row)));
    await save(row.id, value => ({ ...value, nonce, openedAt, expiresAt,
      peerDevice: own.incoming.devicePublicKey, phase: 'offered', authorityTag }));
    try {
      await send(lane, 'welcome', { welcome: encode(invitation.welcome), nonce, contactPolicy, reservationPolicy,
        challenge: own.incoming.expected.challenge });
    } finally { invitation.free(); }
    const staged = await receive(lane, 'staged');
    exact(staged, ['version', 'kind', 'challenge']);
    await row.inbox.setOwnReservationChallenge(Uint8Array.from(staged.challenge), ...args(row));
    const outgoingProof = await accountGate(() => activate(row, 0));
    await send(lane, 'reservation', { proof: outgoingProof });
    await save(row.id, value => ({ ...value, phase: 'awaitingPeer', authorityTag }));
    // Consent can be given later while both clients remain online. No message
    // plaintext is released during this wait.
    const incoming = await receive(lane, 'reservation');
    exact(incoming, ['version', 'kind', 'proof']);
    await accountGate(() => bind(row, outgoingProof, incoming.proof));
    await send(lane, 'bound');
    await receive(lane, 'bound');
    const peerDevice = records.get(row.id).peerDevice;
    if (!Array.isArray(peerDevice) || peerDevice.length === 0) throw new Error('Stored peer device is unavailable');
    await connected(row, lane, Uint8Array.from(peerDevice));
  }
  async function acceptStream(raw) {
    requireOpen();
    if (pending + parked.size >= maxPending) { raw.close(); return; }
    pending++;
    const selectedChannel = channel(raw), lane = selectedChannel.lane('invitation');
    let row;
    try {
      const offer = parse(await lane.receive());
      exact(offer, ['version', 'kind', 'memberId', 'peerId']);
      if (offer.version !== 1 || !['offer', 'resume'].includes(offer.kind) || offer.peerId !== self) throw new Error('Invitation rejected');
      memberId(offer.memberId);
      const existing = rows.get(offer.memberId);
      if (existing?.opening) throw new Error('Conversation is already opening');
      row = await load(offer.memberId, 'recipient');
      if (row.channel && !row.channel.closed) throw new Error('Conversation already connected');
      if (records.get(row.id).phase === 'prepared' && records.get(row.id).role !== 'recipient') {
        throw new Error('Conversation already has an outgoing introduction');
      }
      if (row.inbox.isBlocked(row.id) || row.inbox.isClosed(row.id)) throw new Error('Contact closed');
      row.channel = selectedChannel;
      if (offer.kind === 'resume') {
        if (!['ready', 'consented'].includes(records.get(row.id).phase)) throw new Error('No established conversation');
        row.inbox.prepareAccountingContact(row.id);
        await send(lane, 'resume');
        // The existing authenticated MLS group supplies the peer device; the
        // unsigned routing member ID never selects a replacement key.
        const peerDevice = records.get(row.id).peerDevice;
        if (!Array.isArray(peerDevice) || peerDevice.length === 0) throw new Error('Stored peer device is unavailable');
        await connected(row, lane, Uint8Array.from(peerDevice), records.get(row.id).phase);
        return;
      }
      if (records.get(row.id).phase !== 'prepared') throw new Error('An introduction already exists');
      const keyPackage = await row.inbox.keyPackage(...args(row));
      await send(lane, 'keyPackage', { package: encode(keyPackage) });
      keyPackage.fill(0);
      const welcome = await receive(lane, 'welcome');
      exact(welcome, ['version', 'kind', 'welcome', 'nonce', 'contactPolicy', 'reservationPolicy', 'challenge']);
      const bytes = decode(welcome.welcome);
      if (row.inbox.invitationSender(bytes) !== row.id) throw new Error('Invitation identity mismatch');
      const rp = welcome.reservationPolicy;
      exact(rp, ['statePolicyDigest', 'openedAt', 'abandonAfter']);
      if (JSON.stringify(rp.statePolicyDigest) !== JSON.stringify(config.accounting.statePolicyDigest)
          || rp.abandonAfter !== config.accounting.policy.abandonAfter) throw new Error('Invitation policy mismatch');
      exact(welcome.contactPolicy, ['response_deadline', 'max_intro_bytes']);
      if (welcome.contactPolicy.response_deadline !== rp.openedAt + rp.abandonAfter
          || welcome.contactPolicy.max_intro_bytes !== maxMessageBytes + 256) throw new Error('Contact policy mismatch');
      const staged = JSON.parse(await row.inbox.stageAccountedInvitation(bytes, decode(welcome.nonce),
        JSON.stringify(welcome.contactPolicy), JSON.stringify(rp), ...args(row)));
      await row.inbox.setOwnReservationChallenge(Uint8Array.from(welcome.challenge), ...args(row));
      await save(row.id, value => ({ ...value, nonce: welcome.nonce, openedAt: rp.openedAt,
        expiresAt: rp.openedAt + rp.abandonAfter, peerDevice: staged.outgoing.devicePublicKey,
        phase: 'staged', authorityTag }));
      await send(lane, 'staged', { challenge: staged.outgoing.expected.challenge });
      const outgoing = await receive(lane, 'reservation');
      exact(outgoing, ['version', 'kind', 'proof']);
      await verifier(json(outgoing.proof), JSON.stringify((await contexts(row)).outgoing), false);
      row.outgoingProof = outgoing.proof;
      await save(row.id, value => ({ ...value, phase: 'awaitingAcceptance', authorityTag,
        outgoingProof: row.outgoingProof }));
      row.accept = async () => {
        const incoming = await accountGate(async () => {
          await row.inbox.authorizeIncomingReservation(json(row.outgoingProof), verifier, ...args(row));
          const proof = await activate(row, 1);
          await bind(row, row.outgoingProof, proof, true);
          return proof;
        });
        await send(lane, 'reservation', { proof: incoming });
        await receive(lane, 'bound');
        await send(lane, 'bound');
        await connected(row, lane, Uint8Array.from(records.get(row.id).peerDevice), 'consented');
      };
      parked.add(row.id);
      emit();
    } catch {
      selectedChannel.close();
      if (row) emit();
    } finally { pending--; }
  }

  async function message(row, value, direction, deliveryId) {
    exact(value, ['version', 'kind', 'id', 'text']);
    if (value.version !== 1 || value.kind !== 'text' || decode(value.id, 32).length !== 32
        || typeof value.text !== 'string' || !value.text.isWellFormed() || !value.text.trim()
        || utf8.encode(value.text).length > maxMessageBytes) throw new Error('Invalid text message');
    await save(row.id, record => {
      const messages = record.messages ?? [];
      if (messages.some(item => item.id === value.id)) return record;
      return { ...record, messages: [...messages, { id: value.id, text: value.text, direction,
        outgoing: direction === 'outgoing', timestamp: now(), deliveryId: deliveryId ?? null,
        status: direction === 'incoming' ? 'accepted' : 'pending' }].slice(-maxMessages) };
    });
  }
  async function updateDeliveries(row) {
    const journal = await row.mutate(() => JSON.parse(row.rawInbox.liveDeliveries()));
    const statuses = new Map(journal.filter(value => value.outgoing).map(value => [encode(Uint8Array.from(value.messageId)), value.status]));
    const record = records.get(row.id);
    if (!record.messages?.some(value => value.deliveryId && statuses.has(value.deliveryId) && statuses.get(value.deliveryId) !== value.status)) return;
    await save(row.id, value => ({ ...value, messages: value.messages.map(item => ({ ...item,
      status: item.deliveryId ? statuses.get(item.deliveryId) ?? item.status : item.status })) }));
  }
  async function updateResolution(row) {
    const bytes = await row.mutate(() => row.rawInbox.inboundResolutionReceipt(row.id) ?? row.rawInbox.outboundResolutionReceipt(row.id));
    if (bytes && parse(bytes).kind === 'answered' && records.get(row.id).answerReceived !== true) {
      await save(row.id, value => ({ ...value, phase: 'ready', answerReceived: true }));
    }
  }
  async function applyPeerEvidence(row) {
    const record = records.get(row.id);
    if (!record.event || record.settled) return;
    if (record.role === 'initiator' && record.peerReceipt) {
      // cmsg constructs the ACK only after the matching Answer has actually
      // arrived in its persisted MLS history. A queued reply cannot settle it.
      if (!await row.mutate(() => row.rawInbox.inboundResolutionReceipt(row.id))) return;
      if (record.peerReceipt.resolution.kind === 'answered') {
        const acknowledgment = record.ownAcknowledgment ?? await accountGate(() => row.mutate(() => accounting.acknowledgment({
          inbox: row.rawInbox, peer: row.id, answer: record.peerReceipt })));
        await save(row.id, value => ({ ...value, ownAcknowledgment: acknowledgment }));
        await send(row.channel.lane('accounting'), 'acknowledgment', { acknowledgment });
        await accountGate(() => accounting.settle({ event: record.event, receipt: record.peerReceipt, acknowledgment }));
        await save(row.id, value => ({ ...value, settled: true }));
      }
      // Recipient Close is genuine evidence but never refunds outgoing early.
    } else if (record.role === 'recipient' && record.ownReceipt) {
      if (record.ownReceipt.resolution.kind !== 'closed-forever' && !record.peerAcknowledgment) return;
      await accountGate(() => accounting.settle({ event: record.event, receipt: record.ownReceipt, acknowledgment: record.peerAcknowledgment }));
      await save(row.id, value => ({ ...value, settled: true }));
    }
  }
  function evidence(row) {
    const next = (row.evidenceQueue ?? Promise.resolve()).catch(() => {}).then(() => applyPeerEvidence(row));
    row.evidenceQueue = next.catch(() => {}); return next;
  }
  async function sendReceipt(row) {
    if (records.get(row.id).role !== 'recipient' || !await row.mutate(() => row.rawInbox.outboundResolutionReceipt(row.id))) return;
    const receipt = records.get(row.id).ownReceipt ?? await accountGate(() => row.mutate(() => accounting.receipt({ inbox: row.rawInbox, peer: row.id })));
    await save(row.id, value => ({ ...value, ownReceipt: receipt }));
    await send(row.channel.lane('accounting'), 'receipt', { receipt });
    await evidence(row);
  }
  async function readAccounting(row) {
    try {
      while (!closed && !row.channel.closed) {
        const input = parse(await row.channel.lane('accounting').receive());
        if (input?.version !== 1) throw new Error('Invalid peer evidence');
        if (input.kind === 'receipt') {
          exact(input, ['version', 'kind', 'receipt']);
          if (records.get(row.id).role !== 'initiator' || input.receipt?.delegation?.admission?.memberId !== row.id) throw new Error('Wrong receipt authority');
          cmsg.verifyAccountingReceipt(JSON.stringify(input.receipt), JSON.stringify(config.admissionTrust), now());
          await save(row.id, value => ({ ...value, peerReceipt: input.receipt }));
        } else if (input.kind === 'acknowledgment') {
          exact(input, ['version', 'kind', 'acknowledgment']);
          if (records.get(row.id).role !== 'recipient' || input.acknowledgment?.delegation?.admission?.memberId !== row.id) throw new Error('Wrong acknowledgment authority');
          cmsg.verifyAccountingAcknowledgment(JSON.stringify(input.acknowledgment), JSON.stringify(config.admissionTrust), now());
          await save(row.id, value => ({ ...value, peerAcknowledgment: input.acknowledgment }));
        } else throw new Error('Unknown peer evidence');
        await evidence(row);
      }
    } catch { row.channel.close(); emit(); }
  }
  async function readMessages(row) {
    try {
      while (!closed && !row.live.closed) {
        const received = await row.live.receive();
        try {
          if (received.kind === 'bytes') {
            if (received.memberId !== row.id) throw new Error('Wrong message author');
            await message(row, parse(received.bytes), 'incoming');
            if (records.get(row.id).role === 'recipient' && !records.get(row.id).introReceived) {
              await save(row.id, value => ({ ...value, introReceived: true }));
            }
          } else if (received.kind === 'contactClosed') {
            await save(row.id, value => ({ ...value, phase: 'closed' }));
          } else if (!['membershipChanged', 'contactPolicyChanged'].includes(received.kind)) throw new Error('Unsupported message');
        } finally { received.free(); }
        await updateDeliveries(row);
        await updateResolution(row);
        await evidence(row);
      }
    } catch { row.channel.close(); emit(); }
  }
  async function open(id) {
    if (closing) throw new Error('Conversations are closing');
    requireOpen(); memberId(id); selected = id;
    const row = await load(id, 'initiator');
    if (row.opening) { emit(); return summary(id); }
    if (row.channel && !row.channel.closed) { emit(); return summary(id); }
    if (records.get(id).phase === 'closed') throw new Error('This direct contact is closed');
    const task = (async () => {
      try { await outgoing(row, await openStream(id)); }
      catch { row.channel?.close(); emit(); }
    })().finally(() => { row.opening = null; });
    row.opening = task;
    background(task); emit(); return summary(id);
  }
  async function sendText(text) {
    requireOpen();
    const row = rows.get(selected);
    if (!row?.live || row.live.closed || !['ready', 'consented'].includes(records.get(row.id).phase)) throw new Error('Both members must be connected');
    if (typeof text !== 'string' || !text.trim() || !text.isWellFormed() || utf8.encode(text).length > maxMessageBytes) throw new Error('Invalid text message');
    const value = { version: 1, kind: 'text', id: randomId(), text };
    const previous = new Set((await row.mutate(() => JSON.parse(row.rawInbox.liveDeliveries()))).map(item => encode(Uint8Array.from(item.messageId))));
    await row.live.send(json(value));
    const delivery = (await row.mutate(() => JSON.parse(row.rawInbox.liveDeliveries()))).find(item => item.outgoing && !previous.has(encode(Uint8Array.from(item.messageId))));
    if (!delivery) throw new Error('Message delivery journal missing');
    await message(row, value, 'outgoing', encode(Uint8Array.from(delivery.messageId)));
    await updateDeliveries(row);
    await updateResolution(row);
    await sendReceipt(row);
  }
  async function answer() {
    const row = rows.get(selected);
    if (!row?.accept || records.get(row.id)?.phase !== 'awaitingAcceptance') throw new Error('There is no pending invitation to accept');
    const accept = row.accept; row.accept = null;
    try {
      await accept();
      parked.delete(row.id);
    } catch (error) {
      // Preserve a local acceptance failure while the authenticated peer
      // channel is still usable. Network failure closes the channel and must
      // remain non-actionable rather than pretending the invitation succeeded.
      if (row.channel && !row.channel.closed) { row.accept = accept; parked.add(row.id); }
      else parked.delete(row.id);
      emit();
      throw error;
    }
    return summary(row.id);
  }
  async function decline() {
    const row = rows.get(selected);
    if (!row) throw new Error('No selected conversation');
    if (records.get(row.id).phase === 'awaitingAcceptance') {
      await row.inbox.cancelAccountedInvitation(...args(row));
      await save(row.id, value => ({ ...value, phase: 'closed' }));
      row.channel?.close(); row.accept = null; parked.delete(row.id);
      return;
    }
    if (!row.live || row.live.closed) throw new Error('A live direct contact is required');
    const wire = await row.inbox.closeContact(...args(row));
    await row.channel.lane('mls').send(wire);
    await save(row.id, value => ({ ...value, phase: 'closed' }));
    await sendReceipt(row);
  }
  async function maintain() {
    if (closed) return;
    const account = await accountGate(() => accounting.maintain());
    for (const row of rows.values()) {
      await row.inbox.applyDeadlines(...args(row));
      await updateDeliveries(row);
      if (await row.mutate(() => row.rawInbox.isClosed(row.id)) && records.get(row.id).phase !== 'closed') await save(row.id, value => ({ ...value, phase: 'closed' }));
      if (records.get(row.id).phase !== 'awaitingAcceptance') parked.delete(row.id);
    }
    emit();
    return account;
  }
  async function close() {
    if (closing) return closing;
    if (closed) return;
    closing = (async () => {
    for (const row of rows.values()) row.channel?.close();
    await Promise.allSettled(Array.from(rows.values(), row => row.live?.close()));
    await Promise.allSettled([...tasks]);
    await Promise.allSettled(Array.from(rows.values(), row => row.queue));
    await accounting?.close();
    closed = true;
    for (const row of rows.values()) row.rawInbox.free();
    inboxStore.close(); wrappingKey.fill(0); rows.clear(); parked.clear();
    })();
    return closing;
  }
  accounting = await createAccountingSession({ api, store, wallet, device, authority, config,
    beforeAccountApply: async () => {
      for (const row of rows.values()) {
        await row.inbox.invalidateReservation(...args(row));
        row.needsRebind = true; row.ownProofValid = false;
      }
    } });
  return Object.freeze({
    async start() { const result = await accountGate(() => accounting.start()); emit(); return result; },
    open, acceptStream, send: sendText, answer, decline, maintain, close,
    setProfiles(values) { profiles.clear(); for (const value of values) profiles.set(value.memberId, value); emit(); },
    deselect() { selected = null; onMessages?.([]); },
  });
}
