// Built website authentication contract. The entry boundary is the same cvld
// production handler used by the service; the native voucher bridge is real.
// The network adapter is deliberately fixture-isolated: this test records
// enrolment and login only, and makes no discovery, messaging or Tor claim.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { build as viteBuild } from 'vite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createEntryService, createEntryHandler, createSqliteState, createVoucherBridge
} from '@corbet-labs/cvld';
import { createApi } from '../server/api.mjs';
import { createCommunityMcp } from '../server/mcp.mjs';
import { createCmeetServer } from '../server/app.mjs';

assert(process.env.CI === 'true', 'Website browser contract is remote CI work');
assert(process.env.ARTIFACT_ROOT && process.env.CVLD_VOUCHER_EXECUTABLE && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  'Browser contract artifacts and executable are required');
const artifact = resolve(process.env.ARTIFACT_ROOT);
const dist = resolve('dist');
const entryDist = resolve('.ci-work/entry-dist');
const work = await mkdtemp(join(tmpdir(), 'cmeet-website-browser-'));
const communityId = 'website-entry.example';
const communityName = 'Website Entry Fixture';
const sponsor = generateKeyPairSync('ed25519');
const admission = generateKeyPairSync('ed25519');
const sponsorPublicKey = sponsor.publicKey.export({ format: 'jwk' }).x;
const policyDigest = randomBytes(32).toString('base64url');
const voucher = { id: randomBytes(24).toString('base64url'), valid_until: Math.floor(Date.now() / 1000) + 900 };
voucher.signature = sign(null, Buffer.from(JSON.stringify(['cvch.issuance.v1', voucher.id, voucher.valid_until, communityId])), sponsor.privateKey).toString('base64url');
const bridge = createVoucherBridge({ executable: resolve(process.env.CVLD_VOUCHER_EXECUTABLE), args: [],
  timeoutMs: 5_000, maxRequestBytes: 65_536, maxResponseBytes: 16_384 });
const checks = [], pageErrors = [], externalRequests = [];
const events = [], startedAt = Date.now();
let currentStage = 'setup';
let database, application, browser, page;

await mkdir(artifact, { recursive: true });
process.env.CMEET_ENTRY_OUT_DIR = entryDist;
await stage('build-entry', () => viteBuild({ configFile: resolve('tests/entry-vite.config.mjs'), mode: 'test' }));
// Retain the exact second bundle too; a production sourcemap cannot identify
// an exception or import cycle in a separately bundled CI entry.
await promisify(execFile)('tar', ['--create', '--file', join(artifact, 'website-entry-dist.tar'), '--directory', entryDist, '.']);

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolvePort(port));
    });
  });
}

const port = await reservePort();
const origin = `http://localhost:${port}`;
database = createSqliteState({ path: join(work, 'state.sqlite'), maxReceipts: 20, maxCredentials: 20,
  maxVoucherSpends: 20, busyTimeoutMs: 5_000 });
const entry = createEntryService({ communityId, origin, rpID: 'localhost', rpName: communityName,
  clock: () => Math.floor(Date.now() / 1000), challengeLifetimeSeconds: 120, maxPendingChallenges: 20,
  sessionLifetimeSeconds: 300, maxSessions: 20, maxPasskeysPerMember: 2, requireUserVerification: true,
  credentialStore: database.credentials, membershipStore: database.members, sponsorPublicKey, voucherBridge: bridge,
  admission: { signingKey: admission.privateKey.export({ format: 'pem', type: 'pkcs8' }), policyDigest, grantLifetimeSeconds: 120 } });
const entryHandler = createEntryHandler({ entry, origin, maxBodyBytes: 65_536, cookieLifetimeSeconds: 300,
  sessionCookie: 'entrySession', allowInsecureLocalhost: true });
const publicConfig = {
  communityId, communityName, walletScope: communityId, deviceAuthorizationLifetimeSeconds: 600,
  admissionTrust: { community_id: communityId, policy_digest: policyDigest,
    issuer_public_key: [...entry.admissionTrust.publicKey] },
  api: { maxRequestBytes: 65_536, maxResponseBytes: 512 * 1024 }, credentialDeadlineMs: 15_000,
  apiKeys: null, mcpEndpoint: '/mcp', mcpCapabilities: []
};
const backend = { async call() { return { fixtureOnly: true }; } };
const api = createApi({ entryHandler, authenticate: entryHandler.authenticatedPrincipal, backend,
  publicConfig, maxBodyBytes: 65_536 });
const mcp = createCommunityMcp({ api, maxBodyBytes: 65_536 });
application = await createCmeetServer({ api, mcp, origin, distDir: dist,
  limits: { maxConcurrentRequests: 16, requestTimeoutMs: 30_000, maxBodyBytes: 65_536, maxAssetBytes: 70 * 1024 * 1024 },
  torGatewayOrigins: [] });

try {
  await new Promise((accept, reject) => {
    application.once('error', reject);
    application.listen(port, '127.0.0.1', accept);
  });
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  context.setDefaultTimeout(20_000);
  context.setDefaultNavigationTimeout(25_000);
  page = await context.newPage();
  page.on('pageerror', error => { pageErrors.push(error.message); record('page-error', { message: error.message }); });
  page.on('crash', () => record('page-crash'));
  page.on('close', () => record('page-closed'));
  page.on('domcontentloaded', () => record('dom-content-loaded', { path: requestPath(page.url()) }));
  page.on('load', () => record('page-loaded', { path: requestPath(page.url()) }));
  page.on('request', request => record('request', { path: requestPath(request.url()), type: request.resourceType(), method: request.method() }));
  page.on('response', response => record('response', { path: requestPath(response.url()), status: response.status() }));
  page.on('requestfinished', request => record('request-finished', { path: requestPath(request.url()) }));
  page.on('requestfailed', request => record('request-failed', { path: requestPath(request.url()), reason: request.failure()?.errorText }));
  page.on('console', message => {
    if (message.type() === 'info' && message.text().startsWith('CMEET_ENTRY_STAGE ')) {
      record('entry-stage', { detail: message.text().slice(18, 530) });
    } else if (message.type() === 'error') {
      // Record the script location, never arbitrary application log arguments.
      record('console-error', { path: requestPath(message.location().url), line: message.location().lineNumber });
    }
  });
  await page.addInitScript(() => {
    const mark = stage => console.info('CMEET_ENTRY_STAGE ' + JSON.stringify({ stage }));
    mark('document-start');
    document.addEventListener('readystatechange', () => mark('document-' + document.readyState));
    document.addEventListener('securitypolicyviolation', event => mark('csp-' + event.effectiveDirective));
  });
  await page.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    externalRequests.push(route.request().url()); return route.abort();
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1',
    transport: 'usb', hasResidentKey: true, hasUserVerification: true, hasPrf: true, hasHmacSecret: true,
    isUserVerified: true, automaticPresenceSimulation: true } });

  // Exercise the real production bundle while the service is explicitly in
  // setup mode. This must complete before the normal community service is
  // started again, so an auth request or native asset load cannot be hidden
  // by an already-authenticated page.
  await stage('stop-community-for-setup', () => new Promise(accept => {
    application.closeAllConnections();
    application.close(accept);
  }));
  const setupCommunityName = 'Website Setup Fixture';
  const setupPublicConfig = {
    status: 'setup-required',
    communityName: setupCommunityName,
    domains: {
      baseDomain: 'example.test',
      community: { origin: 'https://example.test', apiOrigin: 'https://api.example.test', mcpOrigin: 'https://mcp.example.test' },
      admin: { origin: 'https://admin.example.test', apiOrigin: 'https://api.admin.example.test' },
      root: { origin: 'https://root.example.test', apiOrigin: 'https://api.root.example.test' },
    },
  };
  const setupBody = JSON.stringify(setupPublicConfig);
  const setupUnavailable = () => new Response(JSON.stringify({ error: 'setup_required' }), {
    status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
  const setupApi = {
    async handle(request) {
      const url = new URL(request.url);
      if (url.pathname === '/api/config' && request.method === 'GET') {
        return new Response(setupBody, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
      }
      return setupUnavailable();
    },
  };
  const setupMcp = { handle: async () => setupUnavailable() };
  application = await createCmeetServer({ api: setupApi, mcp: setupMcp, origin, distDir: dist,
    limits: { maxConcurrentRequests: 16, requestTimeoutMs: 30_000, maxBodyBytes: 65_536, maxAssetBytes: 70 * 1024 * 1024 },
    torGatewayOrigins: [] });
  await new Promise((accept, reject) => {
    application.once('error', reject);
    application.listen(port, '127.0.0.1', accept);
  });
  const setupEventStart = events.length;
  const setupExternalStart = externalRequests.length;
  const setupPageErrorStart = pageErrors.length;
  await navigate('/', 'setup');
  await stage('setup-state', async () => {
    const config = await page.evaluate(async () => {
      const response = await fetch('/api/config');
      return { status: response.status, body: await response.json() };
    });
    assert.equal(config.status, 200);
    assert.deepEqual(config.body, setupPublicConfig);
    assert.equal(await page.locator('#setup-title').textContent(), setupCommunityName);
    assert.equal(await page.getByText('This community is being set up.', { exact: true }).count(), 1);
    assert.equal(await page.locator('#voucher').count(), 0);
    assert.equal(await page.getByRole('button', { name: /join|sign in|passkey/i }).count(), 0);
    assert.equal(await page.getByText(/passkey/i).count(), 0);
    const setupPaths = events.slice(setupEventStart).filter(event => event.event === 'request').map(event => event.path);
    assert(setupPaths.includes('/api/config'));
    assert.deepEqual(setupPaths.filter(path => /^(?:\/(?:auth|credential|v1|mcp))(?:\/|$)/.test(path) || /(?:\.wasm$|worker)/i.test(path)), []);
    assert.equal(externalRequests.length, setupExternalStart);
    assert.equal(pageErrors.length, setupPageErrorStart);
    checks.push('real built UI renders setup-required state without auth, external, worker or native asset startup');
  });

  await stage('leave-setup', () => page.goto('about:blank'));
  await stage('stop-setup-server', () => new Promise(accept => {
    application.closeAllConnections();
    application.close(accept);
  }));
  application = await createCmeetServer({ api, mcp, origin, distDir: dist,
    limits: { maxConcurrentRequests: 16, requestTimeoutMs: 30_000, maxBodyBytes: 65_536, maxAssetBytes: 70 * 1024 * 1024 },
    torGatewayOrigins: [] });
  await new Promise((accept, reject) => {
    application.once('error', reject);
    application.listen(port, '127.0.0.1', accept);
  });
  await navigate('/', 'production');

  await stage('production-gate', async () => {
    const config = await page.evaluate(async () => (await fetch('/api/config')).json());
    assert.equal(config.communityId, communityId);
    assert.equal(config.communityName, communityName);
    assert.equal(await page.locator('#auth-title').textContent(), 'Join with a voucher');
    assert.equal(await page.locator('.global-error').count(), 0);
    checks.push('built Vite website loads the trusted public config and displays the voucher eligibility gate');
  });

  // Reuse the same origin and real entry service, changing only the served
  // CI bundle. Production has no test global or network injection switch.
  await stage('leave-production', () => page.goto('about:blank'));
  await stage('stop-production-server', () => new Promise(accept => application.close(accept)));
  application = await createCmeetServer({ api, mcp, origin, distDir: entryDist,
    limits: { maxConcurrentRequests: 16, requestTimeoutMs: 30_000, maxBodyBytes: 65_536, maxAssetBytes: 70 * 1024 * 1024 },
    torGatewayOrigins: [] });
  await new Promise((accept, reject) => {
    application.once('error', reject);
    application.listen(port, '127.0.0.1', accept);
  });
  await navigate('/entry.html', 'entry');
  await stage('entry-controller-ready', () => page.waitForFunction(() => window.__cmeetEntryController?.getState().ready === true));
  assert.equal(await page.locator('.global-error').count(), 0);

  await stage('voucher-registration', async () => {
    await page.locator('#voucher').fill(JSON.stringify(voucher));
    await page.getByRole('button', { name: /Continue to join/ }).click();
    await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30_000 });
    await settled();
  });
  const registeredAdmission = await page.evaluate(() => window.__cmeetEntryAdmissions.at(-1));
  const registeredSession = await page.evaluate(async () => {
    const response = await fetch('/auth/session');
    return { status: response.status, body: response.ok ? await response.json() : null };
  });
  assert.equal(registeredSession.status, 200);
  assert.equal(typeof registeredSession.body?.memberId, 'string');
  checks.push('actual Chromium WebAuthn registration, cmsg authority, native cvch voucher verification and session issuance');

  await stage('passkey-login', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.locator('#auth-title').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByRole('tab', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: /Sign in with passkey/ }).click();
    await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30_000 });
    await settled();
  });
  const renewedAdmission = await page.evaluate(() => window.__cmeetEntryAdmissions.at(-1));
  assert.equal(renewedAdmission.memberId, registeredAdmission.memberId);
  assert.deepEqual(renewedAdmission.chatPublicKey, registeredAdmission.chatPublicKey);
  assert(renewedAdmission.authority.admission.issuedAt >= registeredAdmission.authority.admission.issuedAt);
  const loginSession = await page.evaluate(async () => {
    const response = await fetch('/auth/session');
    return { status: response.status, body: response.ok ? await response.json() : null };
  });
  assert.equal(loginSession.status, 200);
  assert.equal(loginSession.body?.memberId, registeredSession.body.memberId);
  checks.push('discoverable passkey login restores the encrypted local wallet and reissues the authenticated session');

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  await mkdir(artifact, { recursive: true });
  await page.screenshot({ path: join(artifact, 'website-browser.png'), fullPage: true, timeout: 5_000 });
  const evidence = { source: process.env.CI_COMMIT_SHA, ok: true, checks, externalRequests, pageErrors,
    browserVersion: browser.version(), voucherBridgeSha256: createHash('sha256').update(await readFile(process.env.CVLD_VOUCHER_EXECUTABLE)).digest('hex'),
    authenticationController: 'real; only the member network adapter is isolated',
    networkClaim: 'none; discovery, messaging and Tor were not exercised', currentStage, events };
  await writeFile(join(artifact, 'website-browser.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ ok: true, checks }) + '\n');
} catch (error) {
  await mkdir(artifact, { recursive: true });
  // Write evidence before calling the possibly stalled renderer again.
  await writeFile(join(artifact, 'website-browser.json'), JSON.stringify({ source: process.env.CI_COMMIT_SHA,
    ok: false, checks, externalRequests, pageErrors, currentStage, events, error: String(error.stack ?? error) }, null, 2) + '\n');
  await deadline(() => page?.screenshot({ path: join(artifact, 'website-browser-failure.png'), fullPage: true, timeout: 5_000 }), 6_000).catch(() => {});
  throw error;
} finally {
  await deadline(() => browser?.close(), 5_000).catch(() => {});
  if (application?.listening) {
    application.closeAllConnections();
    await deadline(() => new Promise(accept => application.close(accept)), 5_000).catch(() => {});
  }
  await deadline(() => mcp.close(), 5_000).catch(() => {});
  database?.close();
  await rm(work, { recursive: true, force: true });
  await rm(entryDist, { recursive: true, force: true });
}

function requestPath(value) {
  try { return new URL(value).pathname; } catch { return ''; }
}

function record(event, detail = {}) {
  const value = { elapsedMs: Date.now() - startedAt, stage: currentStage, event, ...detail };
  if (events.length === 600) events.shift();
  events.push(value);
  if (['stage-start', 'stage-complete', 'entry-stage', 'page-error', 'request-failed'].includes(event)) {
    process.stdout.write(JSON.stringify(value) + '\n');
  }
}

async function deadline(operation, timeoutMs = 35_000) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Browser contract deadline at ${currentStage}`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

async function stage(name, operation) {
  currentStage = name;
  record('stage-start');
  await writeFile(join(artifact, 'website-browser-progress.json'), JSON.stringify({ currentStage, checks, events }, null, 2) + '\n');
  const result = await deadline(operation);
  record('stage-complete');
  return result;
}

async function navigate(path, label) {
  // Separate response arrival, module/DOM execution and idle network so a
  // failure identifies which part of the original navigation did not finish.
  const response = await stage(label + '-response', () => page.goto(origin + path, { waitUntil: 'commit' }));
  assert.equal(response.status(), 200);
  await stage(label + '-dom', () => page.waitForLoadState('domcontentloaded'));
  await stage(label + '-network-idle', () => page.waitForLoadState('networkidle'));
}

async function settled() {
  await page.waitForFunction(() => {
    const state = window.__cmeetEntryController.getState();
    return state.authenticated && !state.busy;
  });
  const state = await page.evaluate(() => window.__cmeetEntryController.getState());
  assert.equal(state.error, '');
  assert.deepEqual(state.connectivity, { online: false, status: 'offline' });
  assert.deepEqual(state.conversations, []);
  assert.equal(await page.locator('.global-error').count(), 0);
}
