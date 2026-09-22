// Independent real actor/Worker contract. All keys and clocks below belong to
// this isolated CI fixture. No voucher, production policy, UI or Tor claim.
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';
import { createAccountVerifier, verifyAccountAcceptance } from 'cfrm/accounting';
import { assertAssetClosure } from './assert-asset-closure.mjs';
import { nodeArtifactOptions } from 'cfrm/accounting/node-verifier';
import { createEnrollmentService } from 'cfrm/accounting/enrollment-node';
import { createEnrollmentStore } from 'cfrm/accounting/enrollment-store';

assert.equal(process.env.CI, 'true');
assert.match(process.env.CI_COMMIT_SHA ?? '', /^[0-9a-f]{40}$/);
for (const name of ['ARTIFACT_ROOT', 'ACCOUNT_ARTIFACT_DIRECTORY', 'ACCOUNT_CONTRACT_NATIVE', 'PLAYWRIGHT_CHROMIUM_EXECUTABLE']) assert(process.env[name]);
const root = fileURLToPath(new URL('../', import.meta.url)), artifacts = resolve(process.env.ARTIFACT_ROOT);
const runtimeDirectory = resolve(process.env.ACCOUNT_ARTIFACT_DIRECTORY);
const manifestSha256 = '1d7390c6f81a1560a6863be4cfe71f019f833fbbdf4124eb667faf93ea12fae7';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(join(runtimeDirectory, 'manifest.json'));
assert.equal(hash(manifestBytes), manifestSha256);
const manifest = JSON.parse(manifestBytes), policy = manifest.accountPolicy;
assert(['0', '1'].includes(process.env.ACCOUNT_CONVERSATIONS ?? '0'));
const conversationContract = process.env.ACCOUNT_CONVERSATIONS === '1';
const work = await mkdtemp(join(tmpdir(), 'cmeet-accounting-contract-'));
const configPath = join(work, 'native.json'), artifactConfigPath = join(work, 'artifacts.json'), dist = join(work, 'dist');
const operatorSeed = randomBytes(32);
const operatorKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), operatorSeed]), format: 'der', type: 'pkcs8' });
const operatorPublicKey = createPublicKey(operatorKey).export({ format: 'jwk' }).x;
const issuer = generateKeyPairSync('ed25519'), issuerPublic = Buffer.from(issuer.publicKey.export({ format: 'jwk' }).x, 'base64url');
const communityId = 'cmeet-accounting-contract', policyDigest = randomBytes(32).toString('base64url');
// OpenMLS 0.9 subtracts a one-hour skew margin from KeyPackage creation time.
// Keep the isolated clock above that margin and inside the pinned proof policy.
const fixtureStart = 5000;
assert(fixtureStart > 3600 && fixtureStart + 700 < policy.policyValidUntil);
const limits = { maxArtifactBytes: 64 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024, maxProofBytes: 20_000, memoryPages: 32768 };
const config = { communityId, policyDigest, issuerPublicKey: [...issuerPublic], now: fixtureStart,
  database: join(work, 'account.sqlite'), operatorKey: join(work, 'operator.key'), node: process.execPath,
  verifierScript: fileURLToPath(import.meta.resolve('cfrm/accounting/node-verifier')), artifactConfig: artifactConfigPath,
  scope: { circuitDigest: [...Buffer.from(manifest.circuitSha256, 'hex')], verifyingKeyDigest: [...Buffer.from(manifest.vkSha256, 'hex')] },
  policy: { account: policy, maxAuthorizationSeconds: 100, maxProofBytes: limits.maxProofBytes, checkpointPeriodSeconds: 100 }, checkpoints: [] };
const evidence = { source: process.env.CI_COMMIT_SHA, runtimeManifestSha256: manifestSha256, ok: false, checks: [], stages: [],
  fixtureStart,
  clock: 'explicit CI-only controlled clock; production Worker clock unchanged',
  scope: 'actual Worker factory, signed native AccountService, staged cmsg admission, encrypted live first message, durable delivery ACK recovery and Close settlement',
  transport: 'scripted framed endpoints; 64 KiB frames, 16 queued frames and 10-second reads; deliberate first ACK loss',
  conversationContract,
  excluded: ['voucher eligibility', 'UI', 'Tor', ...(conversationContract ? [] : ['Answer acknowledgment settlement'])] };
let clock = fixtureStart, loseNextMember, applyCount = 0, genesisCount = 0, conversationStart;
let enrollment, enrollmentStore, hashRuntime, browser, server, queue = Promise.resolve();
const applied = new Map(), currentEntries = new Map(), pageErrors = [];
evidence.assetRequests = [];
async function writeConfig() { await writeFile(configPath, JSON.stringify({ ...config, now: clock }), { mode: 0o600 }); }
function native(operation, input) {
  return new Promise((accept, reject) => {
    const child = spawn(resolve(process.env.ACCOUNT_CONTRACT_NATIVE), [configPath, operation], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    const chunks = []; let bytes = 0, stopped = false;
    const timer = setTimeout(() => { stopped = true; child.kill('SIGKILL'); }, 150_000);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 4_194_304) { stopped = true; child.kill('SIGKILL'); } else chunks.push(chunk); });
    child.stderr.on('data', () => {}); // Native errors contain no diagnostic witness material.
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code || stopped) { reject(new Error('Real native account contract rejected')); return; }
      try { accept(JSON.parse(Buffer.concat(chunks))); } catch { reject(new Error('Native response shape')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });
}
function serialized(action) {
  const next = queue.catch(() => {}).then(action); queue = next.catch(() => {}); return next;
}
function noPrivateFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, field] of Object.entries(value)) {
    assert(!['ownerSecret', 'opening', 'slots', 'peer', 'nonce', 'group', 'candidate', 'input'].includes(key), 'Private field crossed named account boundary');
    noPrivateFields(field);
  }
}
const artifactFiles = new Set(['manifest.json', 'circuit.json', 'vk.bin', 'peer-reservation/circuit.json', 'peer-reservation/vk.bin',
  'setup/g1.dat', 'setup/g2.dat', 'barretenberg-threads.wasm']);
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.wasm': 'application/wasm', '.json': 'application/json' };
try {
  await mkdir(artifacts, { recursive: true });
  await writeFile(config.operatorKey, operatorSeed, { mode: 0o600 }); operatorSeed.fill(0);
  await writeFile(artifactConfigPath, JSON.stringify({ directory: runtimeDirectory, manifestSha256, limits }));
  await writeConfig();
  await build({ configFile: join(root, 'vite.config.mjs'), logLevel: 'warn',
    build: { outDir: dist, emptyOutDir: true, rolldownOptions: { input: join(root, '.ci/accounting-fixture/index.html') } } });
  await assertAssetClosure(dist);
  hashRuntime = await createAccountVerifier(await nodeArtifactOptions(artifactConfigPath));
  enrollmentStore = createEnrollmentStore({ path: join(work, 'enrollment.sqlite'), maxMembers: 2, maxRetainedSlots: 32,
    maxPublicationBytes: 1024 * 1024, busyTimeoutMs: 5000 });
  enrollment = createEnrollmentService({ communityId, policyDigest,
    community: new Uint8Array(createHash('sha256').update(communityId).digest()), hashes: hashRuntime.hashes,
    clock: () => clock, store: enrollmentStore, checkpointPeriodSeconds: 100, maxMembers: 2, operatorPrivateKey: operatorKey,
    verifyDelegation: async ({ delegation }) => Uint8Array.from(await native('delegation', delegation)),
    async installCheckpoint(checkpoint) {
      const existing = config.checkpoints.find(value => value.slot === checkpoint.slot);
      if (existing) assert.deepEqual(existing.root, checkpoint.root);
      else config.checkpoints.push(checkpoint);
      await writeConfig();
    },
  });
  server = createServer(async (request, response) => {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob:");
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (request.method === 'GET' && evidence.assetRequests.length < 256) {
        evidence.assetRequests.push({ path, elapsedMs: Math.round(performance.now()) });
      }
      if (request.method === 'POST' && ['/v1/account', '/v1/account/enrollment'].includes(path)) {
        const chunks = []; let bytes = 0;
        for await (const chunk of request) { bytes += chunk.length; if (bytes > 4_194_304) throw new Error('Public body bound'); chunks.push(chunk); }
        const input = JSON.parse(Buffer.concat(chunks));
        const output = await serialized(async () => {
          if (path.endsWith('/enrollment')) {
            if (input.action === 'checkpoint') {
              assert.deepEqual(Object.keys(input).sort(), ['action', 'slot']);
              return { action: 'checkpoint', slot: input.slot, publication: await enrollment.checkpoint(input.slot) };
            }
            if (input.action === 'enroll') {
              const member = input.delegation.admission.memberId, prior = currentEntries.get(member);
              if (prior) {
                assert.equal(input.delegation.accountPublicKey, prior.accountPublicKey);
                assert.equal(input.delegation.stateSecretCommitment, prior.stateSecretCommitment);
              }
              await enrollment.enroll(input.delegation); currentEntries.set(member, structuredClone(input.delegation));
            } else assert.equal(input.action, 'current');
            return { action: input.action, publication: await enrollment.current() };
          }
          noPrivateFields(input);
          const value = await native('account', input);
          if (input.action === 'apply') {
            applyCount++;
            if (input.request.statement.genesis === true) genesisCount++;
            const id = Buffer.from(input.request.requestId).toString('hex'), digest = hash(Buffer.from(JSON.stringify(input.request)));
            const prior = applied.get(id);
            if (prior) { assert.equal(prior.digest, digest, 'Retry must preserve every signed byte'); prior.count++; }
            else applied.set(id, { digest, count: 1 });
            if (loseNextMember === input.grant.memberId) { loseNextMember = undefined; throw new Error('Deliberate lost accepted response'); }
          }
          return value;
        });
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(output)); return;
      }
      assert.equal(request.method, 'GET');
      let file;
      if (path.startsWith('/runtime/')) {
        const name = path.slice('/runtime/'.length); assert(artifactFiles.has(name)); file = join(runtimeDirectory, name);
      } else {
        const relative = path === '/' ? '.ci/accounting-fixture/index.html' : decodeURIComponent(path.slice(1));
        assert(!relative.split('/').includes('..') && !relative.includes('\\'));
        file = resolve(dist, relative); assert(file.startsWith(dist + '/'));
      }
      const bytes = await readFile(file); assert(bytes.length <= 64 * 1024 * 1024);
      response.setHeader('Content-Type', Object.entries(types).find(([suffix]) => file.endsWith(suffix))?.[1] ?? 'application/octet-stream');
      response.end(bytes);
    } catch { response.statusCode = 503; response.end('contract request rejected'); }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext(), page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.exposeFunction('fixtureReport', label => {
    assert(typeof label === 'string' && label.length < 256); evidence.checks.push(label); process.stdout.write(label + '\n');
  });
  await page.exposeFunction('fixtureStage', label => {
    assert(typeof label === 'string' && label.length < 128);
    if (evidence.stages.length < 512) evidence.stages.push({ label, elapsedMs: Math.round(performance.now()) });
    process.stdout.write(`stage: ${label}\n`);
  });
  await page.exposeFunction('fixtureControl', (operation, input) => serialized(async () => {
    if (operation === 'advance') {
      assert(Number.isSafeInteger(input.now) && input.now >= clock && input.now < policy.policyValidUntil);
      clock = input.now; await writeConfig(); return true;
    }
    if (operation === 'grant') {
      for (const value of [input.memberId, input.chatPublicKey]) assert.equal(Buffer.from(value, 'base64url').length, 32);
      const grant = { version: 1, issuerKeyId: createHash('sha256').update(issuerPublic).digest('base64url'), communityId,
        memberId: input.memberId, chatPublicKey: input.chatPublicKey, policyDigest, issuedAt: clock, expiresAt: 9000 };
      const transcript = ['cvld.admission.v1', grant.issuerKeyId, communityId, grant.memberId, grant.chatPublicKey, policyDigest, grant.issuedAt, grant.expiresAt];
      return { ...grant, signature: sign(null, Buffer.from(JSON.stringify(transcript)), issuer.privateKey).toString('base64url') };
    }
    if (operation === 'loseNextApply') { assert(!loseNextMember); loseNextMember = input.memberId; return true; }
    if (operation === 'verifyTransport') {
      assert.equal(input.guarded, applyCount);
      assert([...applied.values()].some(value => value.count === 2), 'At least one exact accepted retry required');
      evidence.applyCalls = applyCount; evidence.uniqueAcceptedRequests = applied.size;
      evidence.requestDigests = [...applied.values()].map(value => value.digest); return true;
    }
    if (operation === 'beginConversations') {
      assert(conversationContract && conversationStart === undefined);
      conversationStart = { applyCount, genesisCount }; return true;
    }
    if (operation === 'verifyAcceptance') {
      noPrivateFields(input);
      await verifyAccountAcceptance(input, Uint8Array.from(Buffer.from(operatorPublicKey, 'base64url')));
      return true;
    }
    if (operation === 'verifyConversations') {
      assert(conversationContract && conversationStart);
      assert.equal(genesisCount, conversationStart.genesisCount, 'Production composition must reuse accepted accounts');
      assert.equal(currentEntries.size, 2);
      assert(applyCount - conversationStart.applyCount >= 6, 'Two real reserve/activate/settle sequences required');
      evidence.productionConversations = { accountsReused: 2, newGenesis: 0,
        acceptedApplyCalls: applyCount - conversationStart.applyCount }; return true;
    }
    throw new Error('Unknown trusted fixture operation');
  }));
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.runAccountingFixture === 'function');
  const configPublic = { communityId, fixtureStart, conversationContract, admissionTrust: { community_id: communityId, policy_digest: policyDigest, issuer_public_key: [...issuerPublic] },
    accounting: { artifactBaseUrl: origin + '/runtime/', manifestSha256, artifactLimits: limits, policy,
      checkpointPeriodSeconds: 100, operatorPublicKey, requestSeconds: 90,
      checkpointLimits: { maxBytes: 262144, maxMapEntries: 128, maxSlots: 32 }, maxJournalBytes: 786432,
      maxCiphertextBytes: 1_048_576, workerDeadlineMs: 240_000, workerMaxPending: 4 } };
  evidence.result = await page.evaluate(config => window.runAccountingFixture(config), configPublic);
  assert.deepEqual(pageErrors, []);
  evidence.browser = browser.version(); evidence.ok = true;
} catch (error) { evidence.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  await browser?.close();
  if (server) await new Promise(resolveClose => server.close(resolveClose));
  await queue; enrollment?.close(); await hashRuntime?.destroy(); enrollmentStore?.close();
  evidence.pageErrors = pageErrors;
  await writeFile(join(artifacts, 'accounting-browser.json'), JSON.stringify(evidence, null, 2) + '\n');
  // Public generated code only. Keep the failed Worker bundle reviewable; no
  // fixture keys, database, proof witnesses or private configuration are copied.
  try {
    await copyFile(join(dist, '.ci/accounting-fixture/index.html'), join(artifacts, 'fixture-index.html'));
    await cp(join(dist, 'assets'), join(artifacts, 'fixture-assets'), { recursive: true });
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rm(work, { recursive: true, force: true });
}
process.stdout.write(JSON.stringify({ ok: evidence.ok, checks: evidence.checks.length }) + '\n');
