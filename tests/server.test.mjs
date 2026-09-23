// HTTP/MCP composition conformance only. The recording backend below does not
// verify cryptography; actual cvld/cfrm/cmsg contracts run in separate lanes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi, readJson } from '../server/api.mjs';
import { createCommunityMcp } from '../server/mcp.mjs';
import { createCmeetServer } from '../server/app.mjs';
import { resolveWebsiteAddress } from '../server/domains.mjs';
import { mcpResponse } from './mcp-response.mjs';

const origin = 'https://site.example', communityId = 'site.example';
function boundary() {
  const calls = [], authCalls = []; let revoked = false;
  const authenticate = async (request, scope) => {
    authCalls.push(scope);
    const token = request.headers.get('authorization');
    if (revoked || !['Bearer test-reader', 'Bearer test-writer'].includes(token)) return false;
    if (scope && token === 'Bearer test-reader' && scope !== 'discovery:read') return false;
    return { memberId: 'owner', communityId, kind: 'boundaryFixture' };
  };
  const api = createApi({ entryHandler: async () => new Response('entry-adapter'), authenticate,
    backend: { call: async (name, input, context) => { calls.push({ name, input, context }); return { fixtureOnly: true }; } },
    publicConfig: { communityId, name: 'Public title' }, maxBodyBytes: 4096 });
  return { api, calls, authCalls, revoke: () => { revoked = true; } };
}
const signedFixture = (kind = 'query') => ({ admission: { memberId: 'owner', communityId }, operation: { kind } });
const post = (path, body, token = 'test-reader') => new Request(`${origin}${path}`, { method: 'POST', headers: {
  'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

test('API routes only authenticated matching member/community/operation to the shared backend boundary', async () => {
  const { api, calls, authCalls } = boundary();
  for (const [input, token, status] of [[signedFixture(), null, 401], [{ ...signedFixture(), admission: { memberId: 'other', communityId } }, 'test-reader', 403],
    [{ ...signedFixture(), admission: { memberId: 'owner', communityId: 'other' } }, 'test-reader', 403], [signedFixture('publish'), 'test-reader', 403]]) {
    assert.equal((await api.handle(post('/v1/discovery/query', input, token))).status, status);
  }
  assert.equal(calls.length, 0);
  const result = await api.handle(post('/v1/discovery/query', signedFixture()));
  assert.equal(result.status, 200); assert.deepEqual(await result.json(), { fixtureOnly: true });
  assert.equal(calls[0].name, 'discovery'); assert.equal(calls[0].context.principal.memberId, 'owner');
  assert.equal(authCalls.at(-1), 'discovery:read');
  assert.equal((await api.handle(post('/v1/profiles/publish', signedFixture('publish')))).status, 401);
  assert.equal((await api.handle(post('/v1/profiles/publish', signedFixture('publish'), 'test-writer'))).status, 200);
  assert.equal(authCalls.at(-1), 'profile:write');
  const wrongAccount = { action: 'apply', grant: { memberId: 'other', communityId } };
  assert.equal((await api.handle(post('/v1/account/apply', wrongAccount, 'test-writer'))).status, 403);
  assert.equal((await api.handle(post('/v1/account/apply', { ...wrongAccount, grant: { memberId: 'owner', communityId } }, 'test-writer'))).status, 200);
  assert.equal(calls.at(-1).name, 'account');
});

test('API exposes only explicit public config and uniformly rejects malformed, oversized or unknown requests', async () => {
  const { api, calls } = boundary();
  const config = await api.handle(new Request(`${origin}/api/config`));
  assert.deepEqual(await config.json(), { communityId, name: 'Public title' });
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.equal((await api.handle(post('/v1/missing', signedFixture()))).status, 404);
  assert.equal((await api.handle(new Request(`${origin}/v1/discovery/query`))).status, 405);
  assert.equal((await api.handle(post('/v1/discovery/query', { ...signedFixture(), oversized: 'x'.repeat(4097) }))).status, 413);
  const malformed = new Request(`${origin}/v1/discovery/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal((await api.handle(malformed)).status, 400);
  assert.equal(calls.length, 0);
  assert.equal(await (await api.handle(new Request(`${origin}/auth/session`))).text(), 'entry-adapter');
  await assert.rejects(readJson(new Request(origin, { method: 'POST', body: '{}' }), 20), error => error.status === 415);
  await assert.rejects(readJson(new Request(origin, { method: 'POST', headers: { 'content-type': 'application/json' }, body: new Uint8Array([0xff]) }), 20), error => error.status === 400);
});

test('actual MCP protocol uses the same operation authorization, enforces scopes and rechecks revocation', async () => {
  const fixture = boundary();
  // Keep a single API instance so revocation below applies to metadata and calls.
  const mcp = createCommunityMcp({ api: fixture.api, maxBodyBytes: 4096 });
  let id = 0;
  const rpc = async (method, params = {}, token = 'test-reader') => {
    const request = post('/mcp', { jsonrpc: '2.0', id: ++id, method, params }, token);
    request.headers.set('accept', 'application/json, text/event-stream');
    request.headers.set('mcp-protocol-version', '2025-11-25');
    const response = await mcp.handle(request);
    return { status: response.status, body: await mcpResponse(response, id) };
  };
  try {
    assert.equal((await rpc('tools/list', {}, null)).status, 401);
    const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'boundary-contract', version: '1' } });
    assert.equal(initialized.status, 200); assert.equal(initialized.body.error, undefined);
    const listed = await rpc('tools/list'); assert.equal(listed.status, 200);
    assert.ok(listed.body.result.tools.some(tool => tool.name === 'discovery_query'));
    const called = await rpc('tools/call', { name: 'discovery_query', arguments: { request: signedFixture() } });
    assert.equal(called.body.result.isError ?? false, false); assert.equal(fixture.calls.length, 1);
    const denied = await rpc('tools/call', { name: 'profile_publish', arguments: { request: signedFixture('publish') } });
    assert.equal(denied.body.result.isError, true); assert.equal(fixture.calls.length, 1);
    const relabeled = await rpc('tools/call', { name: 'discovery_query', arguments: { request: { ...signedFixture(), admission: { memberId: 'other', communityId } } } });
    assert.equal(relabeled.body.result.isError, true); assert.equal(fixture.calls.length, 1);
    fixture.revoke(); assert.equal((await rpc('tools/list')).status, 401);
    assert.equal((await rpc('tools/call', { name: 'discovery_query', arguments: { request: signedFixture() } })).status, 401);
    assert.equal(fixture.calls.length, 1);
  } finally { await mcp.close(); }
});

async function hosted(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'cmeet-http-')); const dist = join(directory, 'dist'); await mkdir(dist);
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>Boundary fixture</title>');
  await writeFile(join(directory, 'secret.js'), 'private-outside-root');
  await symlink(join(directory, 'secret.js'), join(dist, 'outside.js'));
  await writeFile(join(dist, 'large.js'), 'x'.repeat(1025));
  await writeFile(join(dist, 'unsupported.txt'), 'not a public asset');
  const fixture = boundary();
  const server = await createCmeetServer({ api: fixture.api, mcp: { handle: async () => new Response('mcp-boundary') }, origin, distDir: dist,
    limits: { maxConcurrentRequests: 2, requestTimeoutMs: 3000, maxBodyBytes: 4096, maxAssetBytes: 1024 }, torGatewayOrigins: ['wss://gateway.example'], ...overrides });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = (path = '/', { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path, method, headers: { host: 'site.example', ...headers } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    outgoing.on('error', reject); outgoing.end(body);
  });
  return { request, close: async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); } };
}

test('HTTP host/origin checks, CSP, MIME, path containment and asset limits protect the website boundary', async () => {
  const host = await hosted();
  try {
    const index = await host.request(); assert.equal(index.status, 200); assert.match(index.body, /Boundary fixture/);
    assert.equal(index.headers['cache-control'], 'no-store'); assert.equal(index.headers['x-content-type-options'], 'nosniff');
    assert.match(index.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.match(index.headers['content-security-policy'], /worker-src 'self'/);
    assert.match(index.headers['content-security-policy'], /wss:\/\/gateway\.example/);
    assert.doesNotMatch(index.headers['content-security-policy'], /'unsafe-inline'|'unsafe-eval'/);
    assert.equal(index.headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal(index.headers['cross-origin-embedder-policy'], 'require-corp');
    assert.equal((await host.request('/', { headers: { host: 'attacker.example', 'x-forwarded-host': 'site.example' } })).status, 400);
    assert.equal((await host.request('/', { headers: { origin: 'https://attacker.example' } })).status, 400);
    assert.equal((await host.request('/outside.js')).status, 404);
    assert.equal((await host.request('/unsupported.txt')).status, 404);
    assert.equal((await host.request('/large.js')).status, 400);
    assert.equal((await host.request('/%2f..%2fsecret.js')).status, 400);
    assert.equal((await host.request('/%00.js')).status, 400);
    assert.equal((await host.request('//attacker.example/')).status, 400);
    assert.equal((await host.request('/', { method: 'HEAD' })).body, '');
    assert.equal((await host.request('/', { method: 'POST' })).status, 405);
    assert.deepEqual(JSON.parse((await host.request('/health')).body), { status: 'running' });
    assert.equal((await host.request('/mcp')).body, 'mcp-boundary');
  } finally { await host.close(); }
});

test('HTTP concurrency limit rejects excess work before invoking an adapter', async () => {
  let release, started; const ready = new Promise(resolve => { started = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const host = await hosted({ api: { handle: async () => { started(); await held; return new Response('finished'); } },
    limits: { maxConcurrentRequests: 1, requestTimeoutMs: 3000, maxBodyBytes: 4096, maxAssetBytes: 1024 } });
  try {
    const first = host.request('/api/hold'); await ready;
    assert.equal((await host.request('/health')).status, 429);
    release(); assert.equal((await first).body, 'finished');
    assert.equal((await host.request('/health')).status, 200);
  } finally { release(); await host.close(); }
});

test('derived admin and API names do not widen the community HTTP authentication boundary', async () => {
  const address = resolveWebsiteAddress({ baseDomain: 'test.example', communityLabel: 'garden' });
  const host = await hosted({ origin: address.origin });
  const communityHost = new URL(address.origin).host;
  try {
    assert.equal((await host.request('/', { headers: { host: communityHost, origin: address.origin } })).status, 200);
    for (const other of [address.domains.admin.origin, address.domains.admin.apiOrigin,
      address.domains.root.origin, address.domains.root.apiOrigin,
      address.domains.community.apiOrigin, address.domains.community.mcpOrigin]) {
      assert.equal((await host.request('/api/config', { headers: {
        host: new URL(other).host, 'x-forwarded-host': communityHost,
      } })).status, 400);
      assert.equal((await host.request('/api/config', { headers: {
        host: communityHost, origin: other,
      } })).status, 400);
    }
  } finally { await host.close(); }
});
