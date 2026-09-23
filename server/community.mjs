import { realpath } from 'node:fs/promises';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { createEntryService, createEntryHandler, createSqliteState, createVoucherBridge,
  createApiKeyService, restoreIssuer } from '@corbet-labs/cvld';
import { createApi, OPERATIONS } from './api.mjs';
import { createCommunityMcp } from './mcp.mjs';
import { createCmeetServer } from './app.mjs';
import { createCfrmBackend } from './backend.mjs';
import { prepareAccountConfig } from './account-config.mjs';
import { publicClientConfig } from './client-config.mjs';
import { composeEnrollment } from './enrollment.mjs';
import { createAnonymousTicketListener } from './anonymous-tickets.mjs';
import { loadStorage, requireSameStorage, storeConnectionOptions } from './storage.mjs';
import { absolute, readBounded, jsonFile, positive } from './config-files.mjs';

/** Compose the existing libraries. Issuer keys and policy are provisioned
 * separately; process restarts restore them and never silently create a new
 * community, credential definition, or voucher sponsor. */
export async function startCommunity(config) {
  const clock = () => Math.floor(Date.now() / 1000);
  if (typeof config.communityId !== 'string' || !/^[A-Za-z0-9._:/-]{1,256}$/.test(config.communityId)) throw new Error('Community required');
  const policy = config.eligibilityPolicy;
  if (!policy || typeof policy.version !== 'string' || !policy.version || policy.mode !== 'all'
      || !Array.isArray(policy.factors) || policy.factors.length !== 1 || policy.factors[0] !== 'voucher') throw new Error('Voucher-only eligibility policy required');
  const digest = createHash('sha256').update(JSON.stringify(['cvld.policy.v1', policy.version, policy.mode, policy.factors])).digest('base64url');
  const nativeConfig = await jsonFile(config.backend.configPath, true);
  if (nativeConfig.trust.communityId !== config.communityId || nativeConfig.trust.policyDigest !== digest) throw new Error('Backend community trust mismatch');
  const storage = await loadStorage(config.storage, { readPrivateFile: readBounded, allowLegacySqlite: true });
  const nativeStorage = await loadStorage(nativeConfig.storage ?? { driver: 'sqlite' }, { readPrivateFile: readBounded });
  requireSameStorage(storage, nativeStorage);
  const preparedAccount = await prepareAccountConfig(nativeConfig.account, { storageDriver: storage.driver });
  if (nativeConfig.account.verifier.nodePath !== preparedAccount.verifier.nodePath
      || nativeConfig.account.verifier.scriptPath !== preparedAccount.verifier.scriptPath) {
    throw new Error('Backend account verifier paths are not trusted');
  }
  const resources = [];
  const failureListeners = new Set();
  let server, closing, failure, started = false;
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
    if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    for (const resource of resources.toReversed()) { try { await resource.close(); } catch {} }
    })();
    return closing;
  };
  const fail = () => {
    if (failure || closing) return;
    failure = new Error('Durable backend unavailable; restart required');
    for (const listener of failureListeners) { try { listener(failure); } catch {} }
    // During startup, the enclosing try/catch owns teardown. No partially
    // composed service may start listening after this failure was observed.
    if (started) void close();
  };
  const healthy = () => !failure && !closing && resources.every(resource => resource.healthy !== false);
  try {
    const stateOptions = { ...storeConnectionOptions(storage, config.storage, { sharedSelector: true }), clock,
      maxReceipts: config.storage.maxReceipts, maxCredentials: config.storage.maxCredentials,
      maxVoucherSpends: config.storage.maxVoucherSpends };
    const state = storage.driver === 'turso'
      ? await (await import('@corbet-labs/cvld')).createTursoState(stateOptions)
      : createSqliteState(stateOptions);
    resources.push(state);
    if (storage.driver === 'turso' && state.healthy !== true) throw new Error('Turso state readiness contract required');
    const wrappingKey = await readBounded(config.issuer.wrappingKeyPath, 32, true);
    let issuer;
    try {
      if (wrappingKey.length !== 32) throw new Error('Issuer wrapping key rejected');
      issuer = await restoreIssuer({ encryptedState: await jsonFile(config.issuer.statePath, true), wrappingKey, clock, receiptStore: state.receipts });
    } finally { wrappingKey.fill(0); }
    if (issuer.public.communityId !== config.communityId || issuer.public.policyDigest !== digest) throw new Error('Issuer community mismatch');
    const admissionKey = await readBounded(config.entry.admissionKeyPath, 4096, true);
    const attesterKey = await readBounded(config.issuer.attesterKeyPath, 4096, true);
    let entry;
    try {
      entry = createEntryService({ ...config.entry, communityId: config.communityId, origin: config.origin,
        rpID: config.rpID, rpName: config.communityName, clock, requireUserVerification: true,
        credentialStore: state.credentials, membershipStore: state.members,
        sponsorPublicKey: config.sponsorPublicKey, voucherBridge: createVoucherBridge(config.voucherBridge),
        admission: { signingKey: admissionKey, policyDigest: digest, grantLifetimeSeconds: config.entry.grantLifetimeSeconds },
        issuer, voucherAttester: { keyId: config.issuer.attesterKeyId, signingKey: attesterKey },
        issuerChallengeLifetimeSeconds: config.issuer.challengeLifetimeSeconds,
        maxIssuerPendingChallenges: config.issuer.maxPendingChallenges,
        issuerCredentialLifetimeSeconds: config.issuer.credentialLifetimeSeconds,
      });
    } finally { admissionKey.fill(0); attesterKey.fill(0); }
    const issuerPublicKey = Buffer.from(entry.admissionTrust.publicKey).toString('base64url');
    if (nativeConfig.trust.issuerPublicKey !== issuerPublicKey) throw new Error('Backend admission key mismatch');
    let keys;
    if (config.apiKeys !== null) {
      if (!config.apiKeys || !Array.isArray(config.apiKeys.expirySeconds)
          || config.apiKeys.expirySeconds.length === 0 || config.apiKeys.expirySeconds.some(value => positive(value) > config.apiKeys.maxLifetimeSeconds)) throw new Error('Explicit API key configuration required');
      const supported = new Set([...Object.values(OPERATIONS).map(value => value.scope), 'credentials:issue']);
      if (config.apiKeys.allowedScopes.some(scope => !supported.has(scope))) throw new Error('Unsupported API scope');
      const keyOptions = { ...storeConnectionOptions(storage, config.apiKeys), communityId: config.communityId, clock,
        maxKeys: config.apiKeys.maxKeys, maxKeysPerMember: config.apiKeys.maxKeysPerMember,
        maxLifetimeSeconds: config.apiKeys.maxLifetimeSeconds, allowedScopes: config.apiKeys.allowedScopes };
      keys = storage.driver === 'turso'
        ? await (await import('@corbet-labs/cvld')).createTursoApiKeyService(keyOptions)
        : createApiKeyService(keyOptions);
      resources.push(keys);
      if (storage.driver === 'turso' && keys.healthy !== true) throw new Error('Turso API-key readiness contract required');
    }
    const entryHandler = createEntryHandler({ entry, apiKeys: keys, origin: config.origin,
      maxBodyBytes: config.http.limits.maxBodyBytes, cookieLifetimeSeconds: config.entry.sessionLifetimeSeconds,
      sessionCookie: config.http.sessionCookie, allowInsecureLocalhost: config.allowInsecureLocalhost });
    const backend = createCfrmBackend(config.backend); resources.push(backend);
    resources.push({ close: backend.onFailure(fail) });
    if ((await backend.ready())?.ready !== true) throw new Error('Backend is not ready');
    const client = config.client;
    if (!client || typeof client !== 'object' || Array.isArray(client)
        || !['storageName', 'identityContext', 'profileContext', 'walletScope'].every(key => typeof client[key] === 'string' && client[key].length > 0)
        || !Number.isSafeInteger(client.deviceAuthorizationLifetimeSeconds) || client.deviceAuthorizationLifetimeSeconds <= 0
        || !Number.isSafeInteger(client.credentialDeadlineMs) || client.credentialDeadlineMs <= 0
        || !Number.isSafeInteger(client.maxResponseBytes) || client.maxResponseBytes <= 0) {
      throw new Error('Explicit public client configuration required');
    }
    const rawOperator = await readBounded(nativeConfig.account.operatorPrivateKeyPath, 32, true);
    let operatorPrivateKey;
    try {
      if (rawOperator.length !== 32) throw new Error('Account operator seed width');
      const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), rawOperator]);
      try { operatorPrivateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }); }
      finally { der.fill(0); }
    } finally { rawOperator.fill(0); }
    const operatorPublicKey = createPublicKey(operatorPrivateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
    const publicClient = await publicClientConfig({ client, nativeConfig, origin: config.origin, operatorPublicKey });
    const enrollment = await composeEnrollment({ config: config.enrollment, account: nativeConfig.account,
      trust: nativeConfig.trust, backend, operatorPrivateKey, clock, storage }); resources.push(enrollment);
    const tickets = await createAnonymousTicketListener({ ...config.anonymousTickets, backend }); resources.push(tickets);
    const publicConfig = {
      communityId: config.communityId, communityName: config.communityName,
      ...(config.domains ? { domains: config.domains } : {}),
      storageName: client.storageName, identityContext: client.identityContext, profileContext: client.profileContext,
      walletScope: client.walletScope, deviceAuthorizationLifetimeSeconds: client.deviceAuthorizationLifetimeSeconds,
      admissionTrust: { community_id: config.communityId, policy_digest: digest, issuer_public_key: [...entry.admissionTrust.publicKey] },
      publicIssuer: issuer.public, credentialDeadlineMs: client.credentialDeadlineMs,
      api: { maxRequestBytes: config.http.limits.maxBodyBytes, maxResponseBytes: client.maxResponseBytes },
      apiMaxRequestBytes: config.http.limits.maxBodyBytes, apiMaxResponseBytes: client.maxResponseBytes,
      ...publicClient,
      apiKeys: keys ? { allowedScopes: [...config.apiKeys.allowedScopes], expirySeconds: [...config.apiKeys.expirySeconds] } : null,
      mcpEndpoint: '/mcp', mcpCapabilities: Object.keys(OPERATIONS).map(name => ({ name })),
    };
    const api = createApi({ entryHandler, authenticate: entryHandler.authenticatedPrincipal, backend, enrollment, publicConfig, maxBodyBytes: config.http.limits.maxBodyBytes });
    const mcp = createCommunityMcp({ api, maxBodyBytes: config.http.limits.maxBodyBytes }); resources.push(mcp);
    if (!healthy()) throw new Error('Durable backend failed during startup');
    server = await createCmeetServer({ api, mcp, origin: config.origin, distDir: await realpath(absolute(config.http.distDir)),
      limits: config.http.limits, torGatewayOrigins: config.http.torGatewayOrigins, health: healthy, onUnhealthy: fail });
    const port = positive(config.http.port);
    if (port > 65535 || !['127.0.0.1', '0.0.0.0', '::1', '::'].includes(config.http.bindAddress)) throw new Error('Explicit listen address required');
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, config.http.bindAddress, () => { server.off('error', reject); resolve(); });
    });
    if (!healthy()) throw new Error('Durable backend failed during startup');
    started = true;
    return Object.freeze({ server, close,
      get healthy() { return healthy(); },
      onFailure(listener) {
        if (typeof listener !== 'function') throw new TypeError('Failure listener required');
        failureListeners.add(listener);
        if (failure) queueMicrotask(() => { if (failureListeners.has(listener)) { try { listener(failure); } catch {} } });
        return () => failureListeners.delete(listener);
      },
    });
  } catch (error) { await close(); throw error; }
}

