// Actual cmsg Wasm/MLS renewal and cvld AEAD. The in-memory publication adapter
// models atomic CAS; IndexedDB itself is covered by cmsg's browser contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import * as cmsg from '@corbet-labs/cmsg';
import { createAdmissionJournal } from '../src/lib/conversation-renewal.js';
import { encode, utf8 } from '../src/lib/encoding.js';

const hash = value => createHash('sha256').update(value).digest('base64url');
const random = () => crypto.getRandomValues(new Uint8Array(32));
const community = 'conversation-renewal-contract', policy = hash('renewal-policy');
const issuer = generateKeyPairSync('ed25519');
const publicKey = Buffer.from(issuer.publicKey.export({ format: 'jwk' }).x, 'base64url');
const trust = JSON.stringify({ community_id: community, policy_digest: policy, issuer_public_key: [...publicKey] });
function authority(root, member, issuedAt, expiresAt) {
  const grant = { version: 1, issuerKeyId: hash(publicKey), communityId: community,
    memberId: root.memberId(), chatPublicKey: encode(member.chatPublicKey()), policyDigest: policy, issuedAt, expiresAt };
  const bytes = JSON.stringify(['cvld.admission.v1', grant.issuerKeyId, community, grant.memberId,
    grant.chatPublicKey, policy, issuedAt, expiresAt]);
  grant.signature = sign(null, Buffer.from(bytes), issuer.privateKey).toString('base64url');
  return { admission: grant, authorization: JSON.parse(root.authorizeDevice(member.chatPublicKey(), issuedAt, expiresAt)) };
}
function pair(drop) {
  const queues = [[], []], waiting = [null, null]; let closed = false;
  function close() { closed = true; for (const pending of waiting) pending?.reject(new Error('Disconnected')); }
  return [0, 1].map(index => ({
    get closed() { return closed; }, close,
    async send(bytes) {
      if (closed) throw new Error('Disconnected');
      if (drop?.(index, JSON.parse(new TextDecoder().decode(bytes)))) { close(); throw new Error('Lost transport write'); }
      const peer = 1 - index;
      if (waiting[peer]) { const pending = waiting[peer]; waiting[peer] = null; pending.resolve(bytes.slice()); }
      else queues[peer].push(bytes.slice());
    },
    receive() {
      if (closed) return Promise.reject(new Error('Disconnected'));
      if (queues[index].length) return Promise.resolve(queues[index].shift());
      return new Promise((resolve, reject) => { waiting[index] = { resolve, reject }; });
    },
  }));
}

test('expired devices reconcile a lost MLS renewal from sealed checkpoints before generating fresh epochs', { timeout: 30000 }, async () => {
  const originalNow = Date.now; let clock = 1000;
  Date.now = () => clock * 1000;
  const rows = [];
  try {
    await cmsg.init({ module_or_path: await readFile(new URL(import.meta.resolve('@corbet-labs/cmsg/wasm-binary'))) });
    for (let index = 0; index < 2; index++) {
      const root = new cmsg.BrowserIdentity(community), member = new cmsg.BrowserMember();
      const old = authority(root, member, 1000, 2000);
      member.bindDeviceAdmission(JSON.stringify(old.admission), trust, JSON.stringify(old.authorization));
      rows.push({ root, member, key: random(), context: utf8.encode(`renewal-contract/${index}`), durable: null,
        tag: hash(JSON.stringify(old)), old });
    }
    rows[0].member.createGroup();
    const invitation = rows[0].member.add(rows[1].member.keyPackage());
    try { rows[1].member.join(invitation.welcome); } finally { invitation.free(); }
    for (const row of rows) {
      row.next = authority(row.root, row.member, 3000, 9000);
      row.inbox = new cmsg.BrowserInbox(row.member); row.member = null;
      row.mutate = action => action(); // The fixture awaits every local mutation.
      row.persist = async (checkpoint, outbound, metadata) => {
        assert.equal(metadata.expectedVersion, row.durable?.version ?? 0);
        row.durable = { checkpoint: checkpoint.slice(), outbound: outbound.map(bytes => bytes.slice()),
          metadata: structuredClone(metadata), version: metadata.nextVersion };
        return true;
      };
      row.journal = await createAdmissionJournal({ durable: null, key: row.key, context: row.context,
        persist: row.persist, authorityTag: row.tag });
      await row.inbox.invalidateReservation(row.key, row.context, row.journal.persist);
    }
    async function restore(row) {
      row.inbox.free();
      row.inbox = cmsg.BrowserInbox.restore(row.durable.checkpoint, row.key, row.context);
      row.journal = await createAdmissionJournal({ durable: row.durable, key: row.key, context: row.context,
        persist: row.persist, authorityTag: hash(JSON.stringify(row.next)) });
    }
    const run = lanes => Promise.allSettled(rows.map((row, index) => row.journal.exchange(lanes[index], {
      leader: index === 0, inbox: row.inbox, mutate: row.mutate,
      args: [row.key, row.context, row.journal.persist], authority: row.next,
    }).catch(error => { lanes[index].close(); throw error; })));
    clock = 3000;
    for (const row of rows) { await restore(row); assert.throws(() => row.inbox.memberId()); }
    const failed = await run(pair((index, value) => index === 1 && value.stage === 'follower'));
    assert(failed.every(value => value.status === 'rejected'));
    for (const row of rows) await restore(row);
    const resumed = await run(pair());
    for (const result of resumed) assert.equal(result.status, 'fulfilled', String(result.reason));
    for (const row of rows) {
      assert.equal(row.inbox.memberId(), row.root.memberId());
      // Exact retained frames are safe to exchange again before the live proof
      // acknowledges them. Duplicate MLS commits must not be processed twice.
    }
    for (const result of await run(pair())) assert.equal(result.status, 'fulfilled', String(result.reason));
    const a = rows[0], tampered = structuredClone(a.durable);
    tampered.checkpoint[0] ^= 1;
    await assert.rejects(createAdmissionJournal({ durable: tampered, key: a.key, context: a.context,
      persist: a.persist, authorityTag: a.tag }), /checkpoint mismatch/);
    await assert.rejects(createAdmissionJournal({ durable: a.durable, key: a.key, context: utf8.encode('different'),
      persist: a.persist, authorityTag: a.tag }));
  } finally {
    Date.now = originalNow;
    for (const row of rows) { row.inbox?.free(); row.member?.free(); row.root.free(); row.key.fill(0); }
  }
});
