import * as cmsg from '@corbet-labs/cmsg';
import initCfrm from 'cfrm-browser';
import cfrmWasmUrl from 'cfrm-browser/wasm?url';
import { createApiClient } from './api.js';
import { openWalletStore } from './wallet-store.js';
import { createProfiles } from './profiles.js';
import { createMemberStreams } from './streams.js';
import { utf8, positive, exact } from './encoding.js';

let initialized;
function profile(value) {
  exact(value, ['displayName', 'bio']);
  if (typeof value.displayName !== 'string' || typeof value.bio !== 'string') throw new Error('Invalid profile');
  const displayName = value.displayName.trim(), bio = value.bio.trim();
  if (!displayName || displayName.length > 80 || bio.length > 280 || !displayName.isWellFormed() || !bio.isWellFormed()) throw new Error('Invalid profile');
  return { displayName, bio };
}

/** Product composition only. Identity, profile access, proofs and message
 * release are enforced by cvld/cfrm/cmsg at their existing boundaries. */
export function createMemberNetwork(options) {
  const { session, device, wallet, authority, config } = options;
  if (!session?.memberId || device.memberId() !== session.memberId || authority?.admission?.memberId !== session.memberId) throw new Error('Current member authority required');
  const settings = config.website;
  if (!settings) throw new Error('Website configuration required');
  const pageSize = positive(settings.discoveryPageSize, 32);
  const poolSize = positive(settings.profileTicketPoolSize, config.profileTicket.maxStoredPermits);
  const heartbeatSeconds = positive(settings.heartbeatSeconds, Math.floor(config.presenceLeaseSeconds / 2));
  const profileSeconds = positive(settings.profileLifetimeSeconds, config.profileLimits.maxProfileSeconds);
  let closed = false, closing, starting, storage, store, anchor, profiles, streams, conversations, heartbeat;
  let mutation = Promise.resolve(), operation = Promise.resolve(), entries = [];
  let online = false;
  const api = createApiClient({ maxRequestBytes: config.apiMaxRequestBytes, maxResponseBytes: config.apiMaxResponseBytes });
  const live = () => { if (closed) throw new Error('Member connection is closed'); };
  const publishStatus = value => {
    online = value.status === 'online';
    options.onConnectivity?.({ ...value, online });
  };
  const publishAccount = result => options.onAccounting?.({ status: result.status,
    accepted: Boolean(result.accepted), acceptedVersion: result.acceptedVersion ?? null,
    eligibleAt: result.eligibleAt ?? null });
  function exclusive(action) {
    if (closing) return Promise.reject(new Error('Member connection is closing'));
    const next = operation.catch(() => {}).then(() => { live(); if (closing) throw new Error('Member connection is closing'); return action(); });
    operation = next.catch(() => {});
    return next;
  }
  async function replenishTickets() {
    const state = await store.read();
    const remaining = (state.profileTicketPermits ?? []).length;
    // Mint a bounded batch before any profile-reader connection is opened.
    for (let index = remaining; index < poolSize; index++) { live(); await profiles.issuePermit(); }
  }
  async function discover() {
    await replenishTickets();
    const page = await profiles.discover({ filters: {}, limit: pageSize });
    const next = [];
    for (const summary of page.entries) {
      live();
      if (summary.memberId === session.memberId) continue;
      if (next.length >= poolSize) break;
      try {
        const result = await profiles.readProfile(summary.memberId);
        const value = profile(JSON.parse(result.text));
        next.push({ memberId: result.memberId, ...value, online: true });
      } catch {
        // A discovered lease may expire before the member answers. It does
        // not establish readable profile content or a live conversation.
      }
    }
    entries = next;
    options.onEntries?.(structuredClone(entries));
    conversations?.setProfiles(entries);
    return structuredClone(entries);
  }
  async function start() {
    if (closing || closed) throw new Error('Member connection is closed');
    if (starting) return starting;
    starting = (async () => {
      live();
      initialized ??= initCfrm({ module_or_path: cfrmWasmUrl });
      await initialized;
      storage = await openWalletStore({ wallet, communityId: config.communityId, memberId: session.memberId });
      store = Object.freeze({
        async read() { await mutation; live(); return storage.read(); },
        update(transform) {
          const next = mutation.catch(() => {}).then(() => { live(); return storage.update(transform); });
          mutation = next.catch(() => {});
          return next;
        },
      });
      const key = await wallet.storageKey('profile-signing-device'), context = utf8.encode('cmeet.profile-signing-device.v1');
      let snapshot, copied;
      try {
        snapshot = device.snapshot(key, context);
        copied = cmsg.BrowserMember.restore(snapshot, key, context);
        anchor = new cmsg.BrowserInbox(copied);
        copied = null;
      } finally { snapshot?.fill(0); key.fill(0); copied?.free(); }
      const { createConversations } = await import('./conversations.js');
      conversations = await createConversations({ api, store, wallet, device, authority, config,
        openStream: memberId => streams.openConversation({ memberId }),
        onConversations: options.onConversations, onMessages: options.onMessages });
      streams = createMemberStreams({ config, onMessageStream: stream => conversations.acceptStream(stream), onStatus: publishStatus });
      const endpoint = await streams.start();
      live();
      profiles = await createProfiles({ api, wallet, store, authority, device: anchor,
        config: { ...config, presenceEndpoint: endpoint }, memberTransport: streams.memberTransport,
        keyAccessRedeem: streams.keyAccessRedeem });
      streams.setLookupPresence(profiles.lookupPresence);
      streams.setProfileService(await profiles.createKeyService());
      const saved = await store.read();
      if (saved.profileCheckpoint?.pending) await profiles.retryProfile();
      else if (profiles.currentPublication()) await profiles.heartbeat();
      options.onAccounting?.({ status: 'starting', accepted: null, acceptedVersion: null, eligibleAt: null });
      publishAccount(await conversations.start());
      async function beat() {
        if (closing || closed || !online) return;
        try {
          await exclusive(async () => {
            await profiles.expireProfile();
            if (profiles.currentPublication()) await profiles.heartbeat();
            try { publishAccount(await conversations.maintain()); }
            catch { options.onAccounting?.({ status: 'degraded', accepted: null, acceptedVersion: null, eligibleAt: null }); }
          });
        } catch { publishStatus({ status: 'degraded' }); }
        if (!closing && !closed && online) heartbeat = setTimeout(beat, heartbeatSeconds * 1000);
      }
      heartbeat = setTimeout(beat, heartbeatSeconds * 1000);
      return { online: true };
    })();
    try { return await starting; }
    catch (error) { await close(); throw error; }
  }
  async function close() {
    if (closing) return closing;
    if (closed) return;
    closing = (async () => {
    clearTimeout(heartbeat);
    // Withdraw the public lease before closing its signing and API handles.
    if (profiles && store) {
      try {
        await operation;
        const state = await store.read();
        if (profiles.currentPublication()) await profiles.disconnect((state.presenceSequence ?? 0) + 1);
      } catch { /* signed leases still expire on the configured short deadline */ }
    }
    streams?.close();
    await conversations?.close();
    profiles?.close(); anchor?.free();
    await mutation;
    closed = true;
    storage?.close();
    publishStatus({ status: 'offline' });
    })();
    return closing;
  }
  return Object.freeze({
    start,
    saveProfile: input => exclusive(async () => {
      const value = profile(input), now = Math.floor(Date.now() / 1000);
      await profiles.expireProfile();
      const state = await store.read();
      if (state.profileCheckpoint?.pending) await profiles.retryProfile();
      await profiles.publishProfile({ text: JSON.stringify(value), discriminators: {},
        expiresAt: Math.min(now + profileSeconds, authority.admission.expiresAt, authority.authorization.expiresAt) });
      return value;
    }),
    discover: () => exclusive(discover),
    openConversation: memberId => exclusive(() => conversations.open(memberId)),
    sendMessage: text => exclusive(() => conversations.send(text)),
    closeConversation: () => exclusive(() => conversations.deselect()),
    answerContact: () => exclusive(() => conversations.answer()),
    declineContact: () => exclusive(() => conversations.decline()),
    close,
  });
}
