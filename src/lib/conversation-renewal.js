import { sealLocalState, openLocalState } from '@corbet-labs/cvld/client';
import { encode, decode, utf8, decoder, exact } from './encoding.js';

const MAX_WIRE = 65_536, MAX_PENDING = 8, MAX_RECEIVED = 128, MAX_JOURNAL = 1_048_576;
const digest = async bytes => encode(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
const json = value => utf8.encode(JSON.stringify(value));

// Application metadata shares cmsg's atomic checkpoint publication. In
// particular, never commit a new MLS epoch without retaining its renewal wire,
// and never acknowledge a peer update before retaining its replay digest.
export async function createAdmissionJournal({ durable, key, context, persist, authorityTag }) {
  const scope = `cmeet.conversation-renewal.v1/${await digest(context)}`;
  let state = { authorityTag, pending: [], received: [] }, intent;
  if (durable) {
    const envelope = durable.metadata?.admissionRenewal;
    if (!envelope || json(envelope).length > MAX_JOURNAL * 2) throw new Error('Conversation renewal journal is unavailable');
    const bytes = await openLocalState({ envelope, key, context: scope });
    try {
      if (bytes.length > MAX_JOURNAL) throw new Error('Conversation renewal journal exceeds its bound');
      const record = JSON.parse(decoder.decode(bytes));
      exact(record, ['version', 'checkpoint', 'publication', 'state']);
      if (record.version !== 1 || record.checkpoint !== await digest(durable.checkpoint)
          || record.publication !== durable.version) throw new Error('Conversation renewal checkpoint mismatch');
      state = record.state;
    } finally { bytes.fill(0); }
  }
  function validate(value) {
    exact(value, ['authorityTag', 'pending', 'received']);
    if (decode(value.authorityTag, 32).length !== 32
        || !Array.isArray(value.pending) || value.pending.length > MAX_PENDING
        || !Array.isArray(value.received) || value.received.length > MAX_RECEIVED
        || new Set(value.received).size !== value.received.length) throw new Error('Invalid renewal journal');
    for (const wire of value.pending) if (decode(wire, MAX_WIRE).length === 0) throw new Error('Empty renewal');
    for (const hash of value.received) if (decode(hash, 32).length !== 32) throw new Error('Invalid renewal digest');
  }
  validate(state);
  async function publish(checkpoint, outbound, metadata) {
    const next = structuredClone(state);
    if (intent?.kind === 'renew') {
      if (outbound.length !== 1 || outbound[0].length === 0 || outbound[0].length > MAX_WIRE) throw new Error('Renewal publication is incomplete');
      next.pending.push(encode(outbound[0])); next.authorityTag = authorityTag;
    } else if (intent?.kind === 'receive') {
      next.received = [...next.received, intent.digest].slice(-MAX_RECEIVED);
    } else if (intent?.kind === 'acknowledge') next.pending = [];
    validate(next);
    const bytes = json({ version: 1, checkpoint: await digest(checkpoint), publication: metadata.nextVersion, state: next });
    let envelope;
    try {
      if (bytes.length > MAX_JOURNAL) throw new Error('Renewal journal capacity');
      envelope = await sealLocalState({ data: bytes, key, context: scope });
    } finally { bytes.fill(0); }
    const result = await persist(checkpoint, outbound, { ...metadata, admissionRenewal: envelope });
    if (result !== true) throw new Error('Renewal journal publication failed');
    state = next;
    return true;
  }
  async function operation(mutate, value, action) {
    return mutate(async () => {
      if (intent) throw new Error('Concurrent renewal mutation');
      intent = value;
      try { return await action(); } finally { intent = undefined; }
    });
  }
  async function exchange(lane, { leader, inbox, mutate, args, authority }) {
    async function send(stage, wires) {
      await lane.send(json({ version: 1, kind: 'admission-renewal', stage, wires }));
    }
    async function receive(stage) {
      const message = JSON.parse(decoder.decode(await lane.receive()));
      exact(message, ['version', 'kind', 'stage', 'wires']);
      if (message.version !== 1 || message.kind !== 'admission-renewal' || message.stage !== stage
          || !Array.isArray(message.wires) || message.wires.length > MAX_PENDING) throw new Error('Invalid renewal exchange');
      for (const encoded of message.wires) {
        const wire = decode(encoded, MAX_WIRE), hash = await digest(wire);
        if (state.received.includes(hash)) continue;
        await operation(mutate, { kind: 'receive', digest: hash }, () => inbox.receiveAdmissionRenewal(wire, ...args));
      }
    }
    async function renew(stage) {
      let wire;
      if (state.authorityTag !== authorityTag) {
        wire = await operation(mutate, { kind: 'renew' }, () => inbox.renewDeviceAdmission(
          JSON.stringify(authority.admission), JSON.stringify(authority.authorization), ...args));
      }
      await send(stage, wire ? [encode(wire)] : []);
    }
    // First reconcile commits retained after a previous uncertain disconnect.
    // Only then serialize fresh commits, avoiding competing MLS epoch updates.
    await send('retained', [...state.pending]);
    await receive('retained');
    if (leader) { await renew('leader'); await receive('follower'); }
    else { await receive('leader'); await renew('follower'); }
  }
  return Object.freeze({
    persist: publish,
    exchange,
    // A successful fresh cmsg live challenge proves the peer has the new MLS
    // epoch. A transport write alone is insufficient to discard these wires.
    acknowledge: (inbox, mutate, args) => state.pending.length === 0 ? Promise.resolve() : operation(mutate, { kind: 'acknowledge' },
      () => inbox.invalidateReservation(...args)),
  });
}
