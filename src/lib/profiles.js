import {
  createDiscoveryClient,
  createProfilePublisher,
  createProfileReader,
  createProfileTicketAcquirer,
  createProfileTicketVerifier,
  signProfileTicketIssue
} from 'cfrm/profiles';
import { BrowserOnionEndpoint } from '@corbet-labs/cmsg';
import { BrowserPreparedPermit } from 'cfrm-browser';
import { createEligibleMemberProfilePolicy } from '@corbet-labs/cvld/profile-policy';

const encoder = new TextEncoder();
const MAX_STATE_BYTES = 4_194_304;

function encode(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Binary profile state is invalid');
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decode(value, maximum = MAX_STATE_BYTES) {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(maximum * 4 / 3)
      || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Private profile state is invalid');
  let bytes;
  try { bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0)); }
  catch { throw new Error('Private profile state is invalid'); }
  if (bytes.length > maximum || encode(bytes) !== value) throw new Error('Private profile state is invalid');
  return bytes;
}

function positive(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be positive`);
  return value;
}

function exactObject(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length
      || fields.some(field => !Object.hasOwn(value, field))) throw new TypeError(`${label} is invalid`);
}

function route(config, name, fallback) {
  const value = config.profileRoutes?.[name] ?? fallback;
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 512) throw new TypeError(`Profile route ${name} is invalid`);
  return value;
}

function asBytes(value, name, length) {
  const bytes = value instanceof Uint8Array ? value : Array.isArray(value) ? Uint8Array.from(value) : null;
  if (!bytes || (length !== undefined && bytes.length !== length)) throw new Error(`${name} is invalid`);
  return bytes;
}

function profileIdentity({ authority, device }) {
  exactObject(authority, ['admission', 'authorization'], 'Profile authority');
  if (!device || typeof device.signProfileStatement !== 'function') throw new TypeError('Bound cmsg device is required');
  return Object.freeze({
    authority: structuredClone(authority),
    async sign(bytes) { return device.signProfileStatement(bytes); }
  });
}

function profileTrust(config) {
  const trust = config.profileTrust ?? config.admissionTrust;
  exactObject(trust, ['communityId', 'policyDigest', 'issuerPublicKey'], 'Profile trust');
  return structuredClone(trust);
}

function profileLimits(config) {
  const limits = config.profileLimits;
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) throw new TypeError('Profile limits are required');
  return structuredClone(limits);
}

function profileClock(config) {
  const clock = config.profileClock ?? (() => Math.floor(Date.now() / 1000));
  if (typeof clock !== 'function') throw new TypeError('Profile clock is invalid');
  let floor = 0;
  return () => {
    const now = clock();
    positive(now, 'Profile clock');
    if (now < floor) throw new Error('Profile clock moved backwards');
    floor = now;
    return now;
  };
}

async function epochContextId(epoch) {
  exactObject(epoch, ['communityId', 'epochId', 'validFrom', 'issueUntil', 'expiresAt', 'publicKeyDer', 'redemptionPublicKey'], 'Ticket epoch');
  const bytes = encoder.encode(JSON.stringify(['cfrm.permit.epoch.v1', epoch.communityId, epoch.epochId,
    epoch.validFrom, epoch.issueUntil, epoch.expiresAt, epoch.publicKeyDer, epoch.redemptionPublicKey]));
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

function stateSize(value) {
  const bytes = encoder.encode(JSON.stringify(value));
  if (bytes.length > MAX_STATE_BYTES) throw new Error('Private profile state is too large');
}

/**
 * Browser profile/discovery capability. The caller supplies the authenticated
 * cmsg authority, the encrypted wallet store and the peer/native transports;
 * this module never chooses a peer route or a profile policy by itself.
 */
export async function createProfiles(options = {}) {
  const { api, wallet, store, config, identity, device, authority } = options;
  if (!api || typeof api.request !== 'function') throw new TypeError('Profile API transport is required');
  if (!wallet || typeof wallet.storageKey !== 'function') throw new TypeError('Profile wallet is required');
  if (!store || typeof store.read !== 'function' || typeof store.update !== 'function') throw new TypeError('Encrypted profile store is required');
  if (!config || typeof config !== 'object') throw new TypeError('Profile configuration is required');
  const trust = profileTrust(config), limits = profileLimits(config), clock = profileClock(config);
  if (trust.communityId !== config.communityId) throw new TypeError('Profile trust community mismatch');
  const signer = profileIdentity({ authority, device });
  const state = await store.read();
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Private profile state is invalid');
  let sessionId = state.profileSessionId;
  if (typeof sessionId !== 'string') {
    sessionId = encode(crypto.getRandomValues(new Uint8Array(32)));
    await store.update(previous => ({ ...previous, profileSessionId: sessionId }));
  }
  const sendDiscovery = options.sendDiscovery ?? (request => api.request(route(config, 'discovery', '/v1/discovery'), { method: 'POST', body: request }));
  if (typeof sendDiscovery !== 'function') throw new TypeError('Discovery transport is required');
  const presenceTransport = Object.freeze({
    apply: options.presenceTransport?.apply
      ?? (payload => api.request(route(config, 'presenceApply', '/v1/presence/apply'), { method: 'POST', body: payload })),
    directory: options.presenceTransport?.directory
      ?? (payload => api.request(route(config, 'presenceDirectory', '/v1/presence'), { method: 'POST', body: payload }))
  });
  const keyAccessIssue = options.keyAccessIssue
    ?? (payload => api.request(route(config, 'keyIssue', '/v1/profile-keys/issue'), { method: 'POST', body: payload }));
  let credentialHandle;

  let current = await store.read();
  const save = async transform => {
    const next = await store.update(previous => {
      const value = transform(structuredClone(previous));
      stateSize(value);
      return value;
    });
    current = next;
    return next;
  };
  const readState = () => structuredClone(current);
  const cache = createDiscoveryClient({
    trust,
    clock,
    identity: signer,
    sessionId,
    requestSeconds: positive(config.discoveryRequestSeconds, 'Discovery request lifetime'),
    maxResponseBytes: positive(config.discoveryMaxResponseBytes, 'Discovery response limit'),
    send: sendDiscovery,
    lease: async () => {
      const update = await presence({ endpoint: config.presenceEndpoint, expiresAt: clock() + positive(config.presenceLeaseSeconds, 'Presence lease lifetime') });
      return { leaseId: sessionId, sequence: update.sequence, expiresAt: update.expiresAt };
    },
    savePending: pending => save(value => ({ ...value, profileDiscoveryPending: pending })),
    pendingRequest: current.profileDiscoveryPending ?? undefined
  });

  const publisher = await createProfilePublisher({
    trust,
    limits,
    clock,
    publicIssuer: config.publicIssuer,
    identity: signer,
    checkpoint: current.profileCheckpoint ?? undefined,
    saveCheckpoint: checkpoint => save(value => ({ ...value, profileCheckpoint: checkpoint })),
    reserveSequence: async ({ after }) => {
      let next;
      await save(value => {
        const previous = Number.isSafeInteger(value.profileSequence) ? value.profileSequence : 0;
        next = Math.max(previous, after) + 1;
        return { ...value, profileSequence: next };
      });
      return next;
    },
    cache
  });

  async function presence({ endpoint, expiresAt }) {
    exactObject(endpoint, ['host', 'port'], 'Presence endpoint');
    positive(expiresAt, 'Presence expiry');
    let pending = readState().presencePending;
    if (pending?.update?.expiresAt <= clock()) {
      // Its sequence remains spent; an expired exact retry cannot renew it.
      await save(value => ({ ...value, presencePending: null }));
      pending = null;
    }
    if (pending) {
      exactObject(pending, ['update'], 'Presence checkpoint');
      await presenceTransport.apply({ grant: authority.admission, authorization: authority.authorization, update: pending.update });
      await save(value => ({ ...value, presencePending: null }));
      return structuredClone(pending.update);
    }
    const prior = Number.isSafeInteger(readState().presenceSequence) ? readState().presenceSequence : 0;
    const sequence = prior + 1;
    const endpointObject = new BrowserOnionEndpoint(endpoint.host, endpoint.port);
    try {
      const update = JSON.parse(device.signPresence(endpointObject, sequence, expiresAt));
      await save(value => ({ ...value, presenceSequence: sequence, presencePending: { update } }));
      await presenceTransport.apply({ grant: authority.admission, authorization: authority.authorization, update });
      await save(value => ({ ...value, presencePending: null }));
      return update;
    } catch (error) {
      throw error;
    } finally { endpointObject.free?.(); }
  }

  async function applyPresence(args = {}) {
    return presence({ endpoint: args.endpoint ?? config.presenceEndpoint, expiresAt: args.expiresAt ?? clock() + positive(config.presenceLeaseSeconds, 'Presence lease lifetime') });
  }

  async function lookupPresence(memberId) {
    decode(memberId, 32);
    let result;
    const lookupClient = createDiscoveryClient({
      trust,
      clock,
      identity: signer,
      sessionId,
      requestSeconds: positive(config.discoveryRequestSeconds, 'Discovery request lifetime'),
      maxResponseBytes: positive(config.apiMaxResponseBytes, 'Presence directory response limit'),
      send: async request => {
        result = await presenceTransport.directory(request);
        exactObject(result, ['presence'], 'Presence directory');
        if (!Array.isArray(result.presence) || result.presence.length > config.boardLimits.maxMembers) throw new Error('Presence directory bound');
        // Adapt the directory to the signed discovery client's page shape.
        // The target stays local; streams verifies its actual signed devices.
        return { kind: 'page', entries: result.presence, nextCursor: null };
      },
      lease: async () => { throw new Error('Presence lookup does not issue a lease'); },
      savePending: async () => {}
    });
    await lookupClient.query({ filters: {}, limit: config.website.discoveryPageSize });
    const candidates = result.presence.filter(entry => entry?.memberId === memberId);
    if (candidates.length > 1) throw new Error('Duplicate presence member');
    return { presence: candidates[0] ?? null };
  }

  let ticketAcquirerPromise;
  async function ticketAcquirer() {
    if (ticketAcquirerPromise) return ticketAcquirerPromise;
    const ticket = config.profileTicket;
    if (!ticket?.epoch || typeof options.keyAccessRedeem !== 'function') throw new Error('Profile ticket service is unavailable');
    ticketAcquirerPromise = createProfileTicketAcquirer({
      epoch: ticket.epoch,
      clock,
      pending: readState().profileTicketPending ?? undefined,
      takePermit: async ({ contextId }) => {
        let permit;
        await save(value => {
          const permits = Array.isArray(value.profileTicketPermits) ? value.profileTicketPermits : [];
          const index = permits.findIndex(candidate => candidate?.contextId === contextId);
          if (index < 0) throw new Error('No profile ticket is available');
          permit = permits[index];
          return { ...value, profileTicketPermits: permits.toSpliced(index, 1) };
        });
        return permit;
      },
      savePending: pending => save(value => ({ ...value, profileTicketPending: pending })),
      redeem: request => options.keyAccessRedeem(request),
      complete: () => save(value => ({ ...value, profileTicketPending: null })),
      retire: () => save(value => ({ ...value, profileTicketPending: null }))
    });
    return ticketAcquirerPromise;
  }

  async function issuePermit({ expiresAt } = {}) {
    const ticket = config.profileTicket;
    if (!ticket?.epoch || typeof keyAccessIssue !== 'function') throw new Error('Profile ticket issuance is unavailable');
    const maxPermits = positive(ticket.maxStoredPermits, 'Maximum stored profile tickets');
    if ((readState().profileTicketPermits ?? []).length >= maxPermits) throw new Error('Private profile ticket capacity reached');
    const contextId = await epochContextId(ticket.epoch);
    const storageContext = encoder.encode(`${config.communityId}:cmeet.profile-ticket.v1`);
    let key; let prepared; let sealed;
    try {
      key = await wallet.storageKey('cfrm-profile-ticket');
      const existing = readState().profileTicketIssuePending;
      if (existing) {
        if (existing.contextId !== contextId) throw new Error('Pending profile ticket belongs to another epoch');
        sealed = decode(existing.sealed);
        prepared = BrowserPreparedPermit.restore(JSON.stringify(ticket.epoch), contextId, sealed, key, storageContext);
      } else {
        const preparedCheckpoint = readState().profileTicketPrepared;
        if (preparedCheckpoint) {
          if (preparedCheckpoint.contextId !== contextId) throw new Error('Prepared profile ticket belongs to another epoch');
          sealed = decode(preparedCheckpoint.sealed);
          prepared = BrowserPreparedPermit.restore(JSON.stringify(ticket.epoch), contextId, sealed, key, storageContext);
        } else {
          prepared = new BrowserPreparedPermit(JSON.stringify(ticket.epoch), contextId);
          sealed = prepared.seal(key, storageContext);
          const requestId = encode(crypto.getRandomValues(new Uint8Array(32)));
          const expiry = positive(expiresAt ?? clock() + positive(ticket.issueLifetimeSeconds, 'Ticket issue lifetime'), 'Ticket expiry');
          await save(value => ({ ...value, profileTicketPrepared: {
            contextId, sealed: encode(sealed), requestId, expiresAt: expiry
          } }));
        }
        const checkpoint = readState().profileTicketPrepared;
        const issued = await signProfileTicketIssue({ trust, identity: signer, epoch: ticket.epoch,
          blindedRequest: prepared.issuanceRequest(), requestId: checkpoint.requestId,
          expiresAt: checkpoint.expiresAt, clock });
        await save(value => ({ ...value, profileTicketIssuePending: {
          contextId, sealed: encode(sealed), request: issued.request, expiresAt: checkpoint.expiresAt
        }, profileTicketPrepared: null }));
      }
      const pending = readState().profileTicketIssuePending;
      if (!pending) throw new Error('Profile ticket checkpoint is missing');
      const issuance = await keyAccessIssue({
        grant: authority.admission, authorization: authority.authorization, request: pending.request
      });
      const blindSignature = asBytes(issuance?.blindSignature, 'Profile ticket issuance', 384);
      const permit = JSON.parse(prepared.finalize(blindSignature));
      await save(value => {
        const permits = Array.isArray(value.profileTicketPermits) ? value.profileTicketPermits : [];
        if (permits.length >= maxPermits) throw new Error('Private profile ticket capacity reached');
        return { ...value, profileTicketPermits: [...permits, permit], profileTicketIssuePending: null };
      });
      return permit;
    } finally {
      key?.fill(0); sealed?.fill(0); prepared?.free?.();
    }
  }

  let credentialPromise, closed = false;
  async function credential() {
    if (closed) throw new Error('Profile service is closed');
    credentialPromise ??= options.credential ? Promise.resolve(options.credential) : (async () => {
      const module = await import('./credential.js');
      return module.openPrivateCredential({ api, wallet, store, config, memberId: authority.admission.memberId });
    })();
    credentialHandle = await credentialPromise;
    if (closed) { credentialHandle.close(); throw new Error('Profile service is closed'); }
    return credentialHandle;
  }
  function policy() {
    const policyConfig = config.profilePolicy;
    if (policyConfig?.mode !== 'eligible-members') throw new Error('Profile reads require the eligible-members policy');
    return createEligibleMemberProfilePolicy({ communityId: config.communityId, policyDigest: trust.policyDigest, mode: policyConfig.mode });
  }
  const keyServices = new Set();
  async function createKeyService() {
    const proof = await credential();
    const verifyTicket = await createProfileTicketVerifier({ epoch: config.profileTicket.epoch, clock });
    const service = publisher.createKeyService({ verifyEligibilityProof: proof.verifyProfile, verifyTicket, authorizeAccess: policy().authorizeAccess });
    keyServices.add(service);
    return service;
  }
  async function readProfile(memberId, holderMemberId = memberId) {
    const proof = await credential();
    const acquirer = await ticketAcquirer();
    const reader = createProfileReader({
      trust, limits, clock, publicIssuer: config.publicIssuer,
      cache,
      memberTransport: options.memberTransport,
      proveEligibility: request => proof.presentProfile(request),
      proveAccess: policy().proveAccess,
      acquireTicket: acquirer.acquireTicket,
      acceptPublication: async publication => publication?.envelope?.communityId === config.communityId
    });
    return reader.read({ memberId, holderMemberId });
  }

  return Object.freeze({
    async publishProfile(input) { return publisher.publish(input); },
    retryProfile() { return publisher.retryPending(); },
    expireProfile() { return publisher.expire(); },
    currentPublication() { return publisher.currentPublication(); },
    discover(input) { return cache.query(input); },
    fetchPublication(memberId) { return cache.fetch(memberId); },
    lookupPresence,
    readProfile,
    createKeyService,
    applyPresence,
    heartbeat: () => cache.heartbeat(),
    disconnect: sequence => cache.disconnect(sequence),
    issuePermit,
    close() { closed = true; for (const service of keyServices) service.close(); keyServices.clear(); publisher.close(); credentialHandle?.close?.(); }
  });
}
