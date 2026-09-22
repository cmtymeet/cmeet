import { open, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
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

function absolute(value) {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('Absolute configured path required');
  return value;
}
async function readBounded(path, maximum, privateFile = false) {
  const file = await open(absolute(path), 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maximum || (privateFile && (info.mode & 0o077) !== 0)) throw new Error('Configuration file rejected');
    const bytes = Buffer.alloc(Number(info.size) + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== info.size) throw new Error('Configuration file changed');
    return bytes.subarray(0, bytesRead);
  } finally { await file.close(); }
}
async function jsonFile(path, privateFile = false) {
  const bytes = await readBounded(path, 1_048_576, privateFile);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  finally { if (privateFile) bytes.fill(0); }
}
function positive(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Explicit positive configuration value required');
  return value;
}

/** Compose the existing libraries. Issuer keys and policy are provisioned
 * separately; process restarts restore them and never silently create a new
 * community, credential definition, or voucher sponsor. */
export async function startCmeet(configFile) {
  const config = await jsonFile(configFile, true);
  const clock = () => Math.floor(Date.now() / 1000);
  const origin = new URL(config.origin);
  if (origin.origin !== config.origin || origin.hostname !== config.rpID
      || (origin.protocol !== 'https:' && !(config.allowInsecureLocalhost === true && origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) throw new Error('Configured website origin rejected');
  if (typeof config.communityId !== 'string' || !/^[A-Za-z0-9._:/-]{1,256}$/.test(config.communityId)) throw new Error('Community required');
  const policy = config.eligibilityPolicy;
  if (!policy || typeof policy.version !== 'string' || !policy.version || policy.mode !== 'all'
      || !Array.isArray(policy.factors) || policy.factors.length !== 1 || policy.factors[0] !== 'voucher') throw new Error('Voucher-only eligibility policy required');
  const digest = createHash('sha256').update(JSON.stringify(['cvld.policy.v1', policy.version, policy.mode, policy.factors])).digest('base64url');
  const nativeConfig = await jsonFile(config.backend.configPath, true);
  if (nativeConfig.trust.communityId !== config.communityId || nativeConfig.trust.policyDigest !== digest) throw new Error('Backend community trust mismatch');
  const preparedAccount = await prepareAccountConfig(nativeConfig.account);
  if (nativeConfig.account.verifier.nodePath !== preparedAccount.verifier.nodePath
      || nativeConfig.account.verifier.scriptPath !== preparedAccount.verifier.scriptPath) {
    throw new Error('Backend account verifier paths are not trusted');
  }
  const resources = [];
  let server, closing;
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
    if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    for (const resource of resources.toReversed()) { try { await resource.close(); } catch {} }
    })();
    return closing;
  };
  try {
    const state = createSqliteState({ ...config.storage, path: absolute(config.storage.path) }); resources.push(state);
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
      keys = createApiKeyService({ ...config.apiKeys, path: absolute(config.apiKeys.path), communityId: config.communityId, clock }); resources.push(keys);
    }
    const entryHandler = createEntryHandler({ entry, apiKeys: keys, origin: config.origin,
      maxBodyBytes: config.http.limits.maxBodyBytes, cookieLifetimeSeconds: config.entry.sessionLifetimeSeconds,
      sessionCookie: config.http.sessionCookie, allowInsecureLocalhost: config.allowInsecureLocalhost });
    const backend = createCfrmBackend(config.backend); resources.push(backend);
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
      trust: nativeConfig.trust, backend, operatorPrivateKey, clock }); resources.push(enrollment);
    const tickets = await createAnonymousTicketListener({ ...config.anonymousTickets, backend }); resources.push(tickets);
    const publicConfig = {
      communityId: config.communityId, communityName: config.communityName,
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
    server = await createCmeetServer({ api, mcp, origin: config.origin, distDir: await realpath(absolute(config.http.distDir)),
      limits: config.http.limits, torGatewayOrigins: config.http.torGatewayOrigins });
    const port = positive(config.http.port);
    if (port > 65535 || !['127.0.0.1', '0.0.0.0', '::1', '::'].includes(config.http.bindAddress)) throw new Error('Explicit listen address required');
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, config.http.bindAddress, () => { server.off('error', reject); resolve(); });
    });
    return Object.freeze({ server, close });
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--config') throw new Error('Configuration required');
    const application = await startCmeet(process.argv[3]);
    let closing = false;
    const stop = async () => { if (closing) return; closing = true; await application.close(); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    process.stdout.write('cmeet ready\n');
  } catch {
    process.stderr.write('cmeet startup rejected; check the configured files and backend readiness\n');
    process.exitCode = 1;
  }
}
