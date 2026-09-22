// Startup/public-config and enrollment route contracts. These tests exercise
// composition boundaries only; the enrollment fixture deliberately does not
// verify cryptography. Real cmsg/cfrm verification remains in native/browser
// lanes.
import assert from 'node:assert/strict';
import { mcpResponse } from './mcp-response.mjs';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicClientConfig } from '../server/client-config.mjs';
import { createApi } from '../server/api.mjs';
import { createCommunityMcp } from '../server/mcp.mjs';

const origin = 'https://site.example';
const communityId = 'site.example';
const policyDigest = 'A'.repeat(43);
const issuerPublicKey = 'B'.repeat(43);
const epoch = {
  communityId,
  epochId: 'cfrm.permit.epoch.v1/test',
  validFrom: 100,
  issueUntil: 200,
  expiresAt: 300,
  publicKeyDer: 'public-key',
  redemptionPublicKey: 'redemption-key',
};
const policy = {
  initialCredit: 10,
  maximumAvailable: 20,
  outgoingReservation: 1,
  incomingReservation: 1,
  policyRevision: 1,
  policyValidFrom: 1,
  policyValidUntil: 100_000,
  newcomerPeriod: 1,
  rateWindow: 1,
  newcomerAdmissions: 1,
  maximumAdmissions: 2,
  refillPeriod: 1,
  refillUnits: 1,
  abandonAfter: 1,
};

function clientConfig(checkpointLimits = { maxBytes: 1024, maxMapEntries: 128, maxSlots: 8 }) {
  return {
    storageName: 'cmeet-test', identityContext: 'cmeet.identity', profileContext: 'cmeet.profile', walletScope: communityId,
    deviceAuthorizationLifetimeSeconds: 600, credentialDeadlineMs: 15_000, maxResponseBytes: 65_536,
    profiles: {
      profileLimits: { maxProfileSeconds: 300, maxChallengeSeconds: 60 }, discoveryRequestSeconds: 30,
      discoveryMaxResponseBytes: 65_536, presenceLeaseSeconds: 60,
      profileTicket: { epoch, maxStoredPermits: 2 }, profilePolicy: { mode: 'eligible' },
    },
    tor: { gateway: ['https://gateway.example'], bootstrapDeadlineMs: 1_000, operationDeadlineMs: 1_000,
      listenPort: 9_001, maximumStreams: 4, acceptDeadlineMs: 1_000, maxHelloBytes: 1_024, maxProfileFrames: 4 },
    website: { discoveryPageSize: 8, profileTicketPoolSize: 2, heartbeatSeconds: 20, profileLifetimeSeconds: 120 },
    messaging: { maxConversations: 8, maxPendingInvitations: 8, maxMessages: 100, maxMessageBytes: 4_096,
      liveSessionSeconds: 60, handshakeDeadlineMs: 1_000, maxQueuedFrames: 8, keepaliveMs: 1_000,
      keyAccessRedeemEndpoint: { host: '127.0.0.1', port: 9_002 } },
    accounting: { artifactBaseUrl: '/accounting/', requestSeconds: 10, checkpointLimits,
      maxJournalBytes: 1_024, maxCiphertextBytes: 2_048, workerDeadlineMs: 1_000, workerMaxPending: 2 },
  };
}

async function publicInputs() {
  const directory = await mkdtemp(join(tmpdir(), 'cmeet-startup-contract-'));
  const manifest = join(directory, 'manifest.json');
  await writeFile(manifest, '{}');
  const artifactConfigPath = join(directory, 'artifact-config.json');
  await writeFile(artifactConfigPath, JSON.stringify({
    directory, manifestSha256: 'c'.repeat(64),
    limits: { maxArtifactBytes: 1_024, maxTotalBytes: 2_048, maxProofBytes: 1_024, memoryPages: 1 },
  }));
  const trust = { communityId, policyDigest, issuerPublicKey };
  return {
    directory,
    client: clientConfig(),
    nativeConfig: {
      trust,
      presence: { maxMembers: 10, maxDevicesPerMember: 2, maxLeaseSeconds: 120, maxReplayEntries: 10 },
      keyAccess: { epoch },
      account: { policy: { account: policy, maxAuthorizationSeconds: 60, checkpointPeriodSeconds: 100 }, verifier: { artifactConfigPath } },
    },
    trust,
  };
}

test('public startup config exposes only camelCase public trust and bounded accounting/messaging fields', async () => {
  const input = await publicInputs();
  try {
    const result = await publicClientConfig({
      client: input.client, nativeConfig: input.nativeConfig, origin,
      operatorPublicKey: 'D'.repeat(43),
    });
    assert.deepEqual(result.boardTrust, input.trust);
    assert.deepEqual(result.profileTrust, input.trust);
    const { keyAccessRedeemEndpoint: _endpoint, ...messaging } = input.client.messaging;
    assert.deepEqual(result.messaging, messaging);
    assert.deepEqual(result.accounting.checkpointLimits, input.client.accounting.checkpointLimits);
    assert.equal(result.accounting.artifactBaseUrl, '/accounting/');
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /artifactConfigPath|directory|operatorPrivateKeyPath|databasePath/);
  } finally {
    await rm(input.directory, { recursive: true, force: true });
  }
});

test('public startup config rejects malformed actor checkpoint limits before browser startup', async () => {
  const input = await publicInputs();
  try {
    await assert.rejects(
      publicClientConfig({
        client: clientConfig({ maxBytes: 0, maxMapEntries: 128, maxSlots: 8 }),
        nativeConfig: input.nativeConfig, origin, operatorPublicKey: 'D'.repeat(43),
      }),
      /Client limits|checkpoint/i,
    );
  } finally {
    await rm(input.directory, { recursive: true, force: true });
  }
});

function enrollmentBoundary() {
  const calls = [];
  const scopes = [];
  const enrollment = {
    async enroll(value) { calls.push(['enroll', structuredClone(value)]); return { memberId: value.admission.memberId }; },
    async publishCheckpoint() { calls.push(['publish']); return { version: 1, slot: 3 }; },
    async current() { calls.push(['current']); return { version: 1, slot: 3 }; },
  };
  const authenticate = async (request, scope) => {
    scopes.push(scope);
    return request.headers.get('authorization') === 'Bearer member'
      ? { memberId: 'owner', communityId, kind: 'boundaryFixture' } : null;
  };
  const api = createApi({ entryHandler: async () => new Response('entry'), authenticate,
    backend: { call: async () => { throw new Error('unexpected backend call'); } }, enrollment,
    publicConfig: { communityId }, maxBodyBytes: 4_096 });
  const post = (path, body, token = 'member') => new Request(`${origin}${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', authorization: `Bearer ${token}`,
  }, body: JSON.stringify(body) });
  return { api, enrollment, calls, scopes, post };
}

test('enrollment HTTP boundary binds delegated member and separates enroll/current actions', async () => {
  const fixture = enrollmentBoundary();
  const delegation = { admission: { memberId: 'owner', communityId } };
  const enrolled = await fixture.api.handle(fixture.post('/v1/account/enrollment', { action: 'enroll', delegation }));
  assert.equal(enrolled.status, 200);
  assert.deepEqual(await enrolled.json(), { action: 'enroll', publication: { version: 1, slot: 3 } });
  assert.deepEqual(fixture.calls.map(([name]) => name), ['enroll', 'publish']);
  const current = await fixture.api.handle(fixture.post('/v1/account/enrollment', { action: 'current' }));
  assert.equal(current.status, 200);
  assert.deepEqual(await current.json(), { action: 'current', publication: { version: 1, slot: 3 } });
  assert.deepEqual(fixture.calls.map(([name]) => name), ['enroll', 'publish', 'current']);
  assert.equal((await fixture.api.handle(fixture.post('/v1/account/enrollment', { action: 'current', extra: true }))).status, 403);
  assert.equal((await fixture.api.handle(fixture.post('/v1/account/enrollment', {
    action: 'enroll', delegation: { admission: { memberId: 'other', communityId } },
  }))).status, 403);
  assert.equal((await fixture.api.handle(fixture.post('/v1/account', { action: 'enroll', delegation }))).status, 404);
});

test('MCP enrollment uses the same operation scopes and member binding', async () => {
  const fixture = enrollmentBoundary();
  const mcp = createCommunityMcp({ api: fixture.api, maxBodyBytes: 4_096 });
  let id = 0;
  const rpcRequest = (method, params = {}) => new Request(`${origin}/mcp`, { method: 'POST', headers: {
    accept: 'application/json, text/event-stream', authorization: 'Bearer member',
    'content-type': 'application/json', 'mcp-protocol-version': '2025-11-25',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const rpc = async (name, request) => {
    const response = await mcp.handle(rpcRequest('tools/call', { name, arguments: { request } }));
    return { status: response.status, body: await mcpResponse(response, id) };
  };
  try {
    const initialized = await mcp.handle(rpcRequest('initialize', {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'startup-contract', version: '1' },
    }));
    assert.equal(initialized.status, 200);
    const result = await rpc('account_enrollment', { action: 'current' });
    assert.equal(result.status, 200);
    assert.equal(result.body.result.isError ?? false, false);
    assert.ok(fixture.scopes.includes('account:read'));
    const denied = await rpc('account_enroll', { action: 'enroll', delegation: {
      admission: { memberId: 'other', communityId },
    } });
    assert.equal(denied.status, 200);
    assert.equal(denied.body.result.isError, true);
    assert.deepEqual(fixture.calls.map(([name]) => name), ['current']);
  } finally {
    await mcp.close();
  }
});
