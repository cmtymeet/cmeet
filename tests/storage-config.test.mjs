// Composition and process-lifecycle checks only. Remote SQL semantics and
// cryptographic admission are exercised by the libraries' separate contracts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { loadStorage, requireSameStorage, storeConnectionOptions } from '../server/storage.mjs';
import { createCfrmBackend } from '../server/backend.mjs';
import { createCmeetServer } from '../server/app.mjs';

const remote = { driver: 'turso', url: 'libsql://database.example', authToken: 'fixture-token', networkTimeoutMs: 1000 };

test('one explicit Turso endpoint is inherited by all stores without local or per-service fallbacks', async () => {
  const storage = await loadStorage(remote);
  requireSameStorage(storage, await loadStorage({ ...remote, url: 'https://database.example/' }));
  assert.throws(() => requireSameStorage(storage, { driver: 'sqlite' }), /storage differ/);
  assert.throws(() => requireSameStorage(storage, { ...storage, url: 'https://another.example/' }), /storage differ/);
  assert.deepEqual(storeConnectionOptions(storage, { maxMembers: 10 }), {
    url: 'https://database.example/', authToken: 'fixture-token', networkTimeoutMs: 1000,
  });
  for (const input of [{ path: '/tmp/state.sqlite' }, { busyTimeoutMs: 1000 },
    { url: 'https://another.example/' }, { driver: 'sqlite' }, { authToken: 'another-token' }, { client: {} }]) {
    assert.throws(() => storeConnectionOptions(storage, input));
  }
  for (const input of [undefined, {}, { path: ':memory:' }, { ...remote, path: '/tmp/state.sqlite' },
    { ...remote, driver: 'unknown' }, { ...remote, url: 'file:/tmp/replica.sqlite' },
    { ...remote, url: 'http://database.example' }, { ...remote, url: 'https://user:password@database.example' },
    { ...remote, url: 'https://database.example/?token=secret' }, { ...remote, url: 'https://database.example/other-db' },
    { ...remote, networkTimeoutMs: 0 }]) {
    await assert.rejects(loadStorage(input, { allowLegacySqlite: true }));
  }
});

test('private token files are bounded, decoded once and wiped; ambiguous credential sources fail', async () => {
  const bytes = Buffer.from('fixture-token\r\n');
  const { authToken: _, ...withoutInline } = remote;
  const file = { ...withoutInline, authTokenPath: '/private/turso-token' };
  const storage = await loadStorage(file, { readPrivateFile: async (...args) => {
    assert.deepEqual(args, ['/private/turso-token', 2050, true]); return bytes;
  } });
  assert.equal(storage.authToken, 'fixture-token');
  assert(bytes.every(byte => byte === 0));
  await assert.rejects(loadStorage({ ...remote, authTokenPath: file.authTokenPath }), /Exactly one/);
  await assert.rejects(loadStorage(withoutInline), /Exactly one/);
  const malformed = Buffer.from([255]);
  await assert.rejects(loadStorage(file, { readPrivateFile: async () => malformed }));
  assert(malformed.every(byte => byte === 0));
  await assert.rejects(loadStorage({ ...remote, authToken: 'embedded\nnewline' }), /credential rejected/);
});

test('legacy and explicit SQLite retain configured durable paths, never an implicit database', async () => {
  const input = { path: '/tmp/fixture.sqlite', busyTimeoutMs: 1000 };
  const legacy = await loadStorage(input, { allowLegacySqlite: true });
  const explicit = await loadStorage({ ...input, driver: 'sqlite' });
  requireSameStorage(legacy, explicit);
  assert.deepEqual(storeConnectionOptions(legacy, input), input);
  assert.throws(() => storeConnectionOptions(explicit, { path: ':memory:', busyTimeoutMs: 1000 }));
  await assert.rejects(loadStorage(input));
  await assert.rejects(loadStorage({ ...input, driver: 'sqlite', url: remote.url }), /Mixed storage/);
});

test('a failed native process retires the adapter and never repeats an uncertain operation', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cmeet-backend-lifecycle-'));
  const executable = join(directory, 'backend'), journal = join(directory, 'requests');
  await writeFile(executable, `#!${process.execPath}
import { createInterface } from 'node:readline';
import { appendFile } from 'node:fs/promises';
const input = createInterface({ input: process.stdin });
for await (const line of input) {
  const request = JSON.parse(line);
  await appendFile(${JSON.stringify(journal)}, request.op + '\\n');
  if (request.op === 'health') process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: { ready: true } }) + '\\n');
  else {
    process.stdout.write(JSON.stringify({ id: request.id, ok: false, error: { code: 'storage' } }) + '\\n');
    process.exitCode = 1;
    break;
  }
}
process.stdin.destroy();
`, { mode: 0o700 });
  const backend = createCfrmBackend({ binaryPath: executable, configPath: join(directory, 'unused-private-config'),
    maxRequestBytes: 4096, maxResponseBytes: 4096, maxPending: 2, deadlineMs: 3000, maxStderrBytes: 4096 });
  let failures = 0;
  const failed = Promise.withResolvers();
  backend.onFailure(() => { failures++; failed.resolve(); });
  try {
    assert.deepEqual(await backend.ready(), { ready: true });
    assert.equal(backend.healthy, true);
    await assert.rejects(backend.callOperation('account', {}, { principal: { kind: 'anonymous' } }));
    await failed.promise;
    assert.equal(backend.healthy, false);
    await assert.rejects(backend.ready());
    assert.equal(await readFile(journal, 'utf8'), 'health\naccount\n');
    assert.equal(failures, 1);
    backend.close();
    assert.equal(failures, 1);
  } finally { backend.close(); await rm(directory, { recursive: true, force: true }); }
});

test('HTTP readiness uses live store state and reports 503 before notifying shutdown', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cmeet-storage-health-'));
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>Health fixture</title>');
  let healthy = true, notifications = 0;
  const server = await createCmeetServer({ origin: 'https://site.example', distDir: directory,
    api: { handle: async () => new Response(null, { status: 404 }) }, mcp: { handle: async () => new Response(null, { status: 404 }) },
    limits: { maxConcurrentRequests: 2, requestTimeoutMs: 3000, maxBodyBytes: 4096, maxAssetBytes: 4096 }, torGatewayOrigins: [],
    health: () => healthy, onUnhealthy: () => { notifications++; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = () => new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path: '/health', headers: { host: 'site.example' } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    });
    outgoing.on('error', reject); outgoing.end();
  });
  try {
    assert.deepEqual(await request(), { status: 200, body: { status: 'running' } });
    healthy = false;
    assert.deepEqual(await request(), { status: 503, body: { status: 'unavailable' } });
    assert.equal(notifications, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
