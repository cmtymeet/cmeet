import { createApiClient, createAuthApi } from './api.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const MAX_ERROR_LENGTH = 240;
const DEFAULT_CONFIG = Object.freeze({
  communityName: 'cmeet',
  storageName: 'cmeet-private-state',
  identityContext: 'cmeet.identity.v1',
  profileContext: 'cmeet.profile.v1'
});
const DEFAULT_AUTH_ROUTES = Object.freeze({
  registerBegin: '/auth/register/begin',
  registerPrecommit: '/auth/register/precommit',
  registerFinish: '/auth/register/finish',
  loginBegin: '/auth/login/begin',
  loginFinish: '/auth/login/finish',
  rebindDevice: '/auth/rebind',
  session: '/auth/session',
  logout: '/auth/logout'
});
let cmsgWasmUrlPromise;

async function loadCmsgWasmUrl() {
  cmsgWasmUrlPromise ??= import('@corbet-labs/cmsg/wasm-binary?url').then(module => module.default ?? module);
  return cmsgWasmUrlPromise;
}

function wipe(value) {
  if (value instanceof Uint8Array) value.fill(0);
}

function freeCmsg(value) {
  try { value?.free?.(); } catch {}
}

function safeError(error) {
  if (error?.safeMessage === true && typeof error.message === 'string') return error.message.slice(0, MAX_ERROR_LENGTH);
  if (error?.name === 'ApiError') {
    if (error.status === 401) return 'Sign in is required.';
    if (error.status === 403) return 'This request was not accepted.';
    if (error.category === 'network') return 'The community service is unavailable.';
    if (error.category === 'response_limit' || error.category === 'response_format') return 'The community service returned an invalid response.';
    return 'The community service could not complete that request.';
  }
  return 'Something went wrong. Try again.';
}

function bytesToBase64(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function base64ToBytes(value) {
  if (typeof value !== 'string' || value.length > 2_000_000) throw new TypeError('Stored state is invalid');
  return Uint8Array.from(atob(value), (byte) => byte.charCodeAt(0));
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function clonePublic(value) {
  if (value === undefined || value === null) return value ?? null;
  try {
    return structuredClone(value);
  } catch {
    return null;
  }
}

async function readBoundedJson(response, maxBytes = 64 * 1024) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new Error('Trusted community configuration is invalid');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Trusted community configuration is invalid');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new Error('Trusted community configuration is invalid');
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(textDecoder.decode(bytes)); }
  catch { throw new Error('Trusted community configuration is invalid'); }
}

function publicState(config) {
  return {
    ready: false,
    authenticated: false,
    member: null,
    profile: { displayName: '', bio: '' },
    entries: [],
    conversations: [],
    activeConversation: null,
    messages: [],
    busy: false,
    error: '',
    connectivity: { online: false, status: 'offline' },
    accounting: { status: 'unknown', accepted: null, eligibleAt: null },
    config: { communityName: config.communityName }
  };
}

function assertConfig(config) {
  if (!config || typeof config !== 'object') throw new TypeError('Trusted community configuration is required');
  if (typeof config.communityId !== 'string' || config.communityId.length < 1 || config.communityId.length > 256) throw new TypeError('Trusted community ID is required');
  if (typeof config.communityName !== 'string' || config.communityName.length < 1 || config.communityName.length > 120) throw new TypeError('Trusted community name is required');
  for (const key of ['storageName', 'identityContext', 'profileContext']) if (typeof config[key] !== 'string' || config[key].length < 1 || config[key].length > 256) throw new TypeError(`Trusted ${key} is required`);
  return config;
}

function defaultStorage(name) {
  if (!globalThis.indexedDB) throw new Error('Encrypted browser storage is unavailable');
  let databasePromise;
  function database() {
    databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onerror = () => reject(new Error('Encrypted browser storage could not open'));
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onsuccess = () => resolve(request.result);
    });
    return databasePromise;
  }
  return Object.freeze({
    async get(key) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const request = db.transaction('records', 'readonly').objectStore('records').get(key);
        request.onerror = () => reject(new Error('Encrypted browser storage could not be read'));
        request.onsuccess = () => resolve(request.result ?? null);
      });
    },
    async put(key, value) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('records', 'readwrite', { durability: 'strict' });
        transaction.objectStore('records').put(value, key);
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => reject(new Error('Encrypted browser storage could not be written'));
        transaction.onabort = () => reject(new Error('Encrypted browser storage write was aborted'));
      });
    },
    async delete(key) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('records', 'readwrite');
        transaction.objectStore('records').delete(key);
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => reject(new Error('Encrypted browser storage could not be cleared'));
        transaction.onabort = () => reject(new Error('Encrypted browser storage clear was aborted'));
      });
    },
    close() {
      databasePromise?.then((db) => db.close()).catch(() => {});
    }
  });
}

async function loadModule(options) {
  if (options?.cmsg) return options.cmsg;
  return import('@corbet-labs/cmsg');
}

async function loadCvld(options) {
  if (options?.cvld) return options.cvld;
  return import('@corbet-labs/cvld/client');
}

/**
 * Create the cmsg root and device handles that cvld must bind before voucher
 * admission. The caller supplies trusted issuance times; browser input cannot
 * choose the community or authorization lifetime.
 */
export function createPrivateMemberMaterial({ config, cmsg, issuedAt, expiresAt }) {
  if (!config || typeof config.communityId !== 'string') throw new TypeError('Trusted community configuration is required');
  if (!cmsg?.BrowserIdentity || !cmsg?.BrowserMember) throw new TypeError('cmsg browser bindings are required');
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) throw new TypeError('Trusted device authorization times are required');
  const identity = new cmsg.BrowserIdentity(config.communityId);
  const member = new cmsg.BrowserMember();
  const chatPublicKey = new Uint8Array(member.chatPublicKey());
  const authorization = identity.authorizeDevice(chatPublicKey, issuedAt, expiresAt);
  return Object.freeze({ identity, member, memberId: identity.memberId(), chatPublicKey, authorization });
}

/**
 * Browser-side cvld/cmsg admission adapter. The precommit operation is an
 * explicit server contract: it must verify the registration challenge and
 * issue the second PRF assertion challenge without consuming the voucher.
 */
export function createCvldAuthAdapter({ authApi, cmsg, cvld, precommit, wasmUrl, initialized = false } = {}) {
  if (!authApi || typeof authApi.registerBegin !== 'function' || typeof authApi.registerPrecommit !== 'function' || typeof authApi.registerFinish !== 'function' || typeof authApi.loginBegin !== 'function' || typeof authApi.loginFinish !== 'function' || typeof authApi.rebindDevice !== 'function') throw new TypeError('cvld auth transport is incomplete');
  if (!cmsg?.BrowserIdentity || !cmsg?.BrowserMember || typeof cvld?.registerPasskey !== 'function' || typeof cvld?.authenticateWithWallet !== 'function') throw new TypeError('cvld and cmsg browser bindings are required');

  let cmsgInitialized = initialized === true;
  async function initializeCmsg(wasmUrl) {
    const init = cmsg.init ?? cmsg.default;
    if (typeof init !== 'function') return;
    if (wasmUrl === undefined) await init();
    else await init({ module_or_path: wasmUrl });
  }
  async function initCmsg() {
    if (cmsgInitialized) return;
    await initializeCmsg(wasmUrl);
    cmsgInitialized = true;
  }
  function walletScope(config) {
    if (typeof config.walletScope !== 'string' || config.walletScope.length === 0) throw new TypeError('Trusted wallet scope is required');
    return config.walletScope;
  }
  function voucherObject(value) {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      return parsed;
    } catch {
      const error = new Error('The voucher format is invalid');
      error.safeMessage = true;
      throw error;
    }
  }
  function trustedTimes(config) {
    const issuedAt = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(config.deviceAuthorizationLifetimeSeconds) || config.deviceAuthorizationLifetimeSeconds <= 0) throw new TypeError('Trusted device authorization lifetime is required');
    return { issuedAt, expiresAt: issuedAt + config.deviceAuthorizationLifetimeSeconds };
  }

  return Object.freeze({
    async register({ voucher, config, onPrivateStateReady }) {
      await initCmsg();
      const times = trustedTimes(config);
      const material = createPrivateMemberMaterial({ config, cmsg, ...times });
      const begin = await authApi.registerBegin({
        memberId: material.memberId,
        chatPublicKey: bytesToBase64Url(material.chatPublicKey),
        authorization: JSON.parse(material.authorization),
        voucher: voucherObject(voucher)
      });
      const registrationResponse = await cvld.registerPasskey(begin.options);
      const secondChallenge = typeof precommit === 'function'
        ? await precommit({ begin, registrationResponse, config })
        : await authApi.registerPrecommit({ id: begin.id, response: registrationResponse });
      if (!secondChallenge?.options) throw new Error('The admission service did not issue a wallet challenge');
      const walletResult = await cvld.authenticateWithWallet({ options: secondChallenge.options, scope: walletScope(config) });
      const privateState = { wallet: walletResult.wallet, identity: material.identity, device: material.member };
      if (typeof onPrivateStateReady !== 'function') throw new Error('Private-state persistence callback is required');
      await onPrivateStateReady(privateState);
      const finish = await authApi.registerFinish({
        id: begin.id,
        response: registrationResponse,
        walletResponse: walletResult.response
      });
      if (!finish?.admission) throw new Error('Admission did not return a device certificate');
      material.member.bindDeviceAdmission(JSON.stringify(finish.admission), JSON.stringify(config.admissionTrust), material.authorization);
      privateState.authority = Object.freeze({ admission: structuredClone(finish.admission), authorization: JSON.parse(material.authorization) });
      await onPrivateStateReady(privateState);
      return { ...privateState, wallet: walletResult.wallet, member: finish, session: finish };
    },
    async login({ config, storedRecord }) {
      await initCmsg();
      if (!storedRecord?.walletEnvelope || !storedRecord.identitySealed || !storedRecord.deviceSealed) throw new Error('Private member state is unavailable on this device');
      const begin = await authApi.loginBegin();
      const walletResult = await cvld.authenticateWithWallet({ options: begin.options, scope: walletScope(config), envelope: storedRecord?.walletEnvelope });
      const session = await authApi.loginFinish({ id: begin.id, response: walletResult.response });
      return { wallet: walletResult.wallet, member: session, session };
    },
    async rebindDevice({ config, identity, device }) {
      if (!identity || typeof identity.memberId !== 'function' || !device ||
          typeof device.chatPublicKey !== 'function' || typeof device.refreshDeviceAdmission !== 'function') {
        throw new Error('Private device state is unavailable');
      }
      const times = trustedTimes(config);
      let chatPublicKey;
      let authorization;
      try {
        chatPublicKey = new Uint8Array(device.chatPublicKey());
        authorization = identity.authorizeDevice(chatPublicKey, times.issuedAt, times.expiresAt);
        const result = await authApi.rebindDevice({
          chatPublicKey: bytesToBase64Url(chatPublicKey),
          authorization: JSON.parse(authorization)
        });
        if (!result?.admission || result.memberId !== identity.memberId()) throw new Error('Device admission was not renewed');
        device.refreshDeviceAdmission(JSON.stringify(result.admission), JSON.stringify(JSON.parse(authorization)));
        return { ...result, authorization: JSON.parse(authorization) };
      } finally {
        wipe(chatPublicKey);
        authorization = null;
      }
    },
    session: () => authApi.session?.(),
    logout: () => authApi.logout?.()
  });
}

/**
 * Application composition boundary. Auth is deliberately supplied by the
 * cvld entry adapter because it owns voucher/passkey verification and the PRF
 * return needed to unlock the wallet. This module owns browser state, durable
 * encrypted records, cmsg object restoration, and UI-facing operations.
 */
export function createAppController(options = {}) {
  const suppliedConfig = options.config;
  let config = { ...DEFAULT_CONFIG, ...(suppliedConfig ?? {}) };
  let storage = options.storage;
  let api = options.api;
  let auth = options.auth;
  const networkFactory = options.networkFactory;
  let state = publicState(config);
  let listeners = new Set();
  let privateSession = null;
  let storedRecord = null;
  let storageLoaded = false;
  let network = null;
  let modulePromise;
  let cvldPromise;

  function emit() {
    const snapshot = clonePublic(state);
    for (const listener of listeners) listener(snapshot);
  }
  function update(patch) {
    state = { ...state, ...patch };
    emit();
  }
  function setBusy(busy) {
    if (state.busy !== busy) update({ busy });
  }

  async function modules() {
    modulePromise ??= loadModule(options);
    return modulePromise;
  }
  async function cvld() {
    cvldPromise ??= loadCvld(options);
    return cvldPromise;
  }
  async function storageKey(wallet, purpose) {
    if (typeof wallet?.storageKey !== 'function') throw new Error('Wallet storage key is unavailable');
    return wallet.storageKey(purpose);
  }
  function contextBytes(context) {
    return textEncoder.encode(`${config.communityId}:${context}`);
  }

  async function ensureConfig() {
    if (typeof config.communityId !== 'string' || config.communityId.length === 0) {
      let loaded;
      if (typeof options.loadConfig === 'function') loaded = await options.loadConfig();
      else {
        const fetchImpl = options.fetchImpl ?? globalThis.fetch;
        if (typeof fetchImpl !== 'function') throw new Error('Trusted community configuration is required');
        const response = await fetchImpl('/api/config', { method: 'GET', credentials: 'same-origin', redirect: 'error', headers: { accept: 'application/json' } });
        if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('Trusted community configuration is unavailable');
        loaded = await readBoundedJson(response);
      }
      if (!loaded) throw new Error('Trusted community configuration is required');
      config = { ...config, ...(loaded ?? {}) };
    }
    config = assertConfig(config);
    storage ??= defaultStorage(config.storageName);
    api ??= createApiClient(config.api ?? {});
    if (!auth) {
      const [cmsg, cvldClient] = await Promise.all([modules(), cvld()]);
      const wasmUrl = options.cmsg ? options.cmsgWasmUrl : await loadCmsgWasmUrl();
      const init = cmsg.init ?? cmsg.default;
      if (typeof init === 'function') {
        if (wasmUrl === undefined) await init();
        else await init({ module_or_path: wasmUrl });
      }
      const authApi = createAuthApi({ api, routes: { ...DEFAULT_AUTH_ROUTES, ...(config.authRoutes ?? {}) } });
      auth = createCvldAuthAdapter({ authApi, cmsg, cvld: cvldClient, wasmUrl, initialized: true });
    }
    state = { ...state, config: { communityName: config.communityName } };
    return config;
  }

  async function persistPrivateSession(session) {
    const { wallet, identity, device, inbox } = session;
    if (!wallet || !identity || (!device && !inbox)) throw new Error('Authenticated private session is incomplete');
    const cmsg = await modules();
    const cvldClient = await cvld();
    let identityKey; let identitySealed; let identityContext;
    let deviceKey; let deviceSealed; let deviceContext;
    let profileKey; let profileBytes; let profileSealed;
    try {
      identityKey = await storageKey(wallet, 'identity');
      identityContext = contextBytes(config.identityContext);
      identitySealed = identity.seal(identityKey, identityContext);
      const record = {
        version: 1,
        memberId: identity.memberId(),
        walletEnvelope: clonePublic(wallet.envelope),
        identitySealed: bytesToBase64(identitySealed),
        identityContext: config.identityContext
      };
      const deviceValue = inbox ?? device;
      deviceKey = await storageKey(wallet, 'device');
      deviceContext = contextBytes('cmeet.device.v1');
      if (inbox && typeof inbox.snapshot === 'function') {
        record.deviceKind = 'inbox';
        deviceSealed = inbox.snapshot(deviceKey, deviceContext);
        record.deviceSealed = bytesToBase64(deviceSealed);
      } else if (typeof deviceValue?.snapshot === 'function') {
        record.deviceKind = 'member';
        deviceSealed = deviceValue.snapshot(deviceKey, deviceContext);
        record.deviceSealed = bytesToBase64(deviceSealed);
      } else {
        throw new Error('Encrypted cmsg device snapshot is unavailable');
      }
      // Keep cvld's sealing implementation in the dependency boundary. The
      // imported function is intentionally used instead of browser localStorage.
      if (typeof cvldClient.sealLocalState !== 'function') throw new Error('Encrypted profile storage is unavailable');
      if (session.profile) {
        profileKey = await storageKey(wallet, 'profile');
        profileBytes = textEncoder.encode(JSON.stringify(session.profile));
        profileSealed = await cvldClient.sealLocalState({ data: profileBytes, key: profileKey, context: `${config.communityId}:${config.profileContext}` });
        record.profileSealed = clonePublic(profileSealed);
      }
      await storage.put('session', record);
      storedRecord = record;
    } finally {
      wipe(identityKey); wipe(identitySealed); wipe(identityContext);
      wipe(deviceKey); wipe(deviceSealed); wipe(deviceContext);
      wipe(profileKey); wipe(profileBytes);
    }
  }

  async function restorePrivateSession(wallet, record) {
    if (!record?.identitySealed || !record?.deviceSealed || record.memberId === undefined) return null;
    const cmsg = await modules();
    let identityKey; let identityBytes; let identityContext;
    let deviceKey; let deviceBytes; let deviceContext;
    let profileKey; let profileBytes;
    try {
      identityKey = await storageKey(wallet, 'identity');
      identityBytes = base64ToBytes(record.identitySealed);
      identityContext = contextBytes(config.identityContext);
      const identity = cmsg.BrowserIdentity.restore(identityBytes, identityKey, config.communityId, record.memberId, identityContext);
      if (identity.memberId() !== record.memberId) throw new Error('Stored identity does not match its member record');
      deviceKey = await storageKey(wallet, 'device');
      deviceBytes = base64ToBytes(record.deviceSealed);
      deviceContext = contextBytes('cmeet.device.v1');
      const device = record.deviceKind === 'inbox'
        ? cmsg.BrowserInbox.restore(deviceBytes, deviceKey, deviceContext)
        : cmsg.BrowserMember.restore(deviceBytes, deviceKey, deviceContext);
      let profile = null;
      if (record.profileSealed) {
        const cvldClient = await cvld();
        profileKey = await storageKey(wallet, 'profile');
        profileBytes = await cvldClient.openLocalState({ envelope: record.profileSealed, key: profileKey, context: `${config.communityId}:${config.profileContext}` });
        profile = JSON.parse(textDecoder.decode(profileBytes));
      }
      return { wallet, identity, device, profile };
    } finally {
      wipe(identityKey); wipe(identityBytes); wipe(identityContext);
      wipe(deviceKey); wipe(deviceBytes); wipe(deviceContext);
      wipe(profileKey); wipe(profileBytes);
    }
  }

  async function startNetwork(session) {
    if (network) await network.close?.();
    let accountingReported = false;
    update({ accounting: { status: 'starting', accepted: null, eligibleAt: null } });
    const factory = networkFactory ?? (await import('./network.js')).createMemberNetwork;
    if (typeof factory !== 'function') throw new Error('Member network is unavailable');
    network = factory({
      session: session.member,
      identity: session.identity,
      device: session.inbox ?? session.device,
      authority: session.authority,
      wallet: session.wallet,
      config,
      onEntries: (entries) => update({ entries: Array.isArray(entries) ? clonePublic(entries) : [] }),
      onConversations: (conversations) => {
        const next = Array.isArray(conversations) ? clonePublic(conversations) : [];
        const active = state.activeConversation;
        const activeId = active?.id ?? active?.memberId;
        const selected = activeId && next.find(value => (value?.id ?? value?.memberId) === activeId);
        update({ conversations: next, ...(selected ? { activeConversation: selected } : {}) });
      },
      onMessages: (messages) => update({ messages: Array.isArray(messages) ? clonePublic(messages) : [] }),
      onConnectivity: (connectivity) => update({ connectivity: clonePublic(connectivity) ?? { online: false, status: 'offline' } }),
      onAccounting: (accounting) => {
        accountingReported = true;
        if (accounting && typeof accounting === 'object') update({ accounting: clonePublic(accounting) });
      }
    });
    if (!network || typeof network.start !== 'function') throw new Error('Member network contract is invalid');
    await network.start();
    // Older network compositions do not expose the accounting lifecycle yet;
    // leave messaging usable while retaining an explicit unknown state.
    if (!accountingReported) update({ accounting: { status: 'unknown', accepted: null, eligibleAt: null } });
  }

  async function finishAuthentication(result, { alreadyPersisted = false, renewAdmission = false } = {}) {
    if (!result || typeof result !== 'object' || !result.wallet) throw new Error('Passkey wallet unlock did not complete');
    const restored = result.identity ? result : await restorePrivateSession(result.wallet, storedRecord);
    if (!restored?.identity || (!restored.device && !restored.inbox)) throw new Error('Private member state could not be restored');
    const serverMember = result.member ?? result.session;
    const identityMemberId = restored.identity.memberId();
    if (!serverMember?.memberId || serverMember.memberId !== identityMemberId || storedRecord?.memberId !== identityMemberId) throw new Error('Authenticated identity does not match the community session');
    let member = serverMember;
    let session = { ...result, ...restored, member };
    if (renewAdmission) {
      const rebound = await auth.rebindDevice({ config, identity: restored.identity, device: restored.device ?? restored.inbox });
      member = { ...serverMember, ...rebound };
      session = { ...session, member, authority: { admission: rebound.admission, authorization: rebound.authorization } };
    }
    if (!session.authority?.admission || !session.authority?.authorization) throw new Error('Current device authority is unavailable');
    privateSession = session;
    if (!alreadyPersisted) await persistPrivateSession(privateSession);
    update({ ready: true, authenticated: true, member: clonePublic(member), profile: clonePublic(result.profile ?? privateSession.profile ?? { displayName: '', bio: '' }), error: '' });
    await startNetwork(privateSession);
    update({ busy: false });
    return clonePublic(state);
  }

  async function init() {
    setBusy(true);
    try {
      await ensureConfig();
      storedRecord = await storage.get('session');
      storageLoaded = true;
      if (typeof auth?.session === 'function') {
        const session = await auth.session();
        update({ member: clonePublic(session?.member ?? session ?? null) });
      }
      update({ ready: true, busy: false });
      return clonePublic(state);
    } catch (error) {
      update({ ready: true, busy: false, error: safeError(error) });
      return clonePublic(state);
    }
  }

  async function register(voucher) {
    await ensureConfig();
    if (!storageLoaded) { storedRecord = await storage.get('session'); storageLoaded = true; }
    if (!auth || typeof auth.register !== 'function') throw new Error('Admission adapter is not configured');
    if (typeof voucher !== 'string' || voucher.trim().length === 0) throw new Error('Voucher is required');
    if (storedRecord && typeof storedRecord === 'object') {
      const error = new Error('A private member is already stored on this device. Local account switching is unavailable.');
      error.safeMessage = true;
      throw error;
    }
    setBusy(true);
    try {
      let prepared = false;
      const result = await auth.register({
        voucher: voucher.trim(),
        config,
        storedRecord,
        // cvld must call this after the PRF wallet and cmsg identity/device
        // exist, but before it consumes the voucher or commits membership.
        onPrivateStateReady: async (session) => {
          await persistPrivateSession(session);
          prepared = true;
        }
      });
      if (!prepared) throw new Error('Admission adapter did not persist private member state before admission');
      return await finishAuthentication(result, { alreadyPersisted: true });
    } catch (error) {
      update({ busy: false, error: safeError(error) });
      throw error;
    }
  }

  async function login() {
    await ensureConfig();
    if (!storageLoaded) { storedRecord = await storage.get('session'); storageLoaded = true; }
    if (!auth || typeof auth.login !== 'function') throw new Error('Authentication adapter is not configured');
    setBusy(true);
    try {
      const result = await auth.login({ config, storedRecord });
      return await finishAuthentication(result, { renewAdmission: true });
    } catch (error) {
      update({ busy: false, error: safeError(error) });
      throw error;
    }
  }

  async function callNetwork(name, ...args) {
    if (!network || typeof network[name] !== 'function') throw new Error('Member network is not connected');
    setBusy(true);
    try {
      const result = await network[name](...args);
      update({ busy: false, error: '' });
      return result;
    } catch (error) {
      update({ busy: false, error: safeError(error) });
      throw error;
    }
  }

  async function saveProfile(profile) {
    const result = await callNetwork('saveProfile', profile);
    if (privateSession) {
      privateSession = { ...privateSession, profile: clonePublic(result ?? profile) };
      await persistPrivateSession(privateSession);
    }
    update({ profile: clonePublic(result ?? profile), error: '' });
    return result;
  }

  async function openConversation(memberId) {
    const result = await callNetwork('openConversation', memberId);
    if (result && typeof result === 'object') update({ activeConversation: clonePublic(result) });
    return result;
  }

  async function closeConversation() {
    const result = await callNetwork('closeConversation');
    update({ activeConversation: null, messages: [] });
    return result;
  }

  async function logout() {
    setBusy(true);
    const session = privateSession;
    let logoutError = '';
    try {
      await network?.close?.();
      network = null;
      await auth?.logout?.();
    } catch (error) {
      logoutError = safeError(error);
      update({ busy: false, error: logoutError });
      throw error;
    } finally {
      freeCmsg(session?.device);
      freeCmsg(session?.inbox);
      freeCmsg(session?.identity);
      privateSession = null;
      update({ authenticated: false, member: null, profile: { displayName: '', bio: '' }, entries: [], conversations: [], activeConversation: null, messages: [], busy: false, connectivity: { online: false, status: 'offline' }, accounting: { status: 'unknown', accepted: null, eligibleAt: null }, error: logoutError });
    }
  }

  return Object.freeze({
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('State listener is required');
      listeners.add(listener);
      listener(clonePublic(state));
      return () => listeners.delete(listener);
    },
    init,
    register,
    login,
    logout,
    saveProfile,
    discover: () => callNetwork('discover'),
    openConversation,
    sendMessage: (text) => callNetwork('sendMessage', text),
    closeConversation,
    answerContact: () => callNetwork('answerContact'),
    declineContact: () => callNetwork('declineContact'),
    getState: () => clonePublic(state)
  });
}
