import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCmeet } from '../server/start.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'cmeet-setup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>cmeet</title>');
  const config = { serviceMode: 'setup', baseDomain: 'test.example', communityName: 'Test community',
    privateValue: 'must-never-be-public',
    http: { port, bindAddress: '127.0.0.1', distDir: root,
      limits: { maxConcurrentRequests: 4, requestTimeoutMs: 2000, maxBodyBytes: 1024, maxAssetBytes: 4096 } } };
  const path = join(root, 'config.json');
  const save = async value => writeFile(path, JSON.stringify(value), { mode: 0o600 });
  await save(config);
  const call = (pathname, options = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: pathname, method: options.method ?? 'GET',
      headers: { host: 'test.example', ...options.headers } }, response => {
      const bytes = [];
      response.on('data', chunk => bytes.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers,
        body: Buffer.concat(bytes).toString() }));
    });
    req.on('error', reject); req.end(options.body);
  });
  return { config, path, save, call };
}

test('explicit setup starts without private community services and exposes only public status', async t => {
  const f = await fixture(t);
  const app = await startCmeet(f.path); t.after(() => app.close());
  assert.equal(app.mode, 'setup'); assert.equal(app.healthy, true);
  assert.equal((await f.call('/')).status, 200);
  const response = await f.call('/api/config');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const config = JSON.parse(response.body);
  assert.deepEqual(Object.keys(config).sort(), ['communityName', 'domains', 'status']);
  assert.equal(config.status, 'setup-required');
  assert.equal(config.domains.root.origin, 'https://root.test.example');
  assert.doesNotMatch(response.body, /privateValue|must-never-be-public|distDir/);
  for (const path of ['/auth/register/begin', '/auth/login/begin', '/v1/account/apply', '/mcp', '/credential/issue']) {
    const rejected = await f.call(path, { method: 'POST', body: '{}' });
    assert.equal(rejected.status, 503, path);
    assert.deepEqual(JSON.parse(rejected.body), { error: 'setup_required' });
    assert.equal(rejected.headers['set-cookie'], undefined);
  }
  assert.equal((await f.call('/api/config', { method: 'POST' })).status, 503);
  assert.equal((await f.call('/', { headers: { host: 'root.test.example' } })).status, 400);
  assert.equal((await f.call('/api/config', { headers: { origin: 'https://evil.example' } })).status, 400);
});

test('invalid live configuration never silently falls back to setup', async t => {
  const f = await fixture(t);
  for (const serviceMode of ['typo', 'community', undefined]) {
    await f.save({ ...f.config, serviceMode });
    await assert.rejects(startCmeet(f.path), /Unknown service mode|Community required/);
  }
});
