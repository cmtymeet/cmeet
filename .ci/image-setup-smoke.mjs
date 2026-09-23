// CI-only: run the shipped entrypoint with public synthetic setup configuration.
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
assert.equal(process.env.CI, 'true');
assert.match(process.env.CI_COMMIT_SHA ?? '', /^[0-9a-f]{40}$/);
assert.equal(process.argv.length, 3);
assert.equal(process.argv[2], `cmeet-runtime:${process.env.CI_COMMIT_SHA}`);
const artifacts = process.env.ARTIFACT_ROOT;
assert.ok(artifacts && isAbsolute(artifacts));
const fixture = await mkdtemp(join(tmpdir(), 'cmeet-image-setup-'));
const container = `cmeet-setup-${process.env.CI_COMMIT_SHA}`;
const docker = args => execFile('docker', args, { timeout: 30_000, maxBuffer: 65_536 });
const config = { serviceMode: 'setup', baseDomain: 'test.example', communityName: 'Setup test',
  http: { port: 8080, bindAddress: '0.0.0.0', distDir: '/app/dist',
    limits: { maxConcurrentRequests: 4, requestTimeoutMs: 2000, maxBodyBytes: 4096, maxAssetBytes: 8_388_608 } } };
const probe = String.raw`
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
const call = (path, { method = 'GET', host = 'test.example', origin } = {}) => new Promise((resolve, reject) => {
  const req = request({ hostname: '127.0.0.1', port: 8080, path, method,
    headers: { host, ...(origin ? { origin } : {}) } }, response => {
    const chunks = []; let size = 0;
    response.on('data', chunk => { size += chunk.length;
      if (size > 65536) response.destroy(new Error('Response bound exceeded')); else chunks.push(chunk); });
    response.on('error', reject);
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers,
      body: Buffer.concat(chunks).toString('utf8') }));
  });
  req.setTimeout(2000, () => req.destroy(new Error('HTTP deadline')));
  req.on('error', reject); req.end(method === 'POST' ? '{}' : undefined);
});
const started = Date.now();
while (true) {
  try { assert.equal((await call('/health')).status, 200); break; }
  catch (error) { if (Date.now() - started > 15000) throw error;
    await new Promise(resolve => setTimeout(resolve, 100)); }
}
const status = await readFile('/proc/1/status', 'utf8');
const ids = status.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m);
assert.ok(ids); assert.deepEqual(ids.slice(1).map(Number), [1000, 1000, 1000, 1000]);
const copied = await stat('/run/cmeet/cmeet.json'), directory = await stat('/run/cmeet');
assert.equal(copied.uid, 1000); assert.equal(copied.mode & 0o777, 0o600);
assert.equal(directory.uid, 1000); assert.equal(directory.mode & 0o777, 0o700);
const config = await call('/api/config'); assert.equal(config.status, 200);
assert.equal(config.headers['cache-control'], 'no-store');
const publicConfig = JSON.parse(config.body);
assert.deepEqual(Object.keys(publicConfig).sort(), ['communityName', 'domains', 'status']);
assert.equal(publicConfig.status, 'setup-required'); assert.equal(publicConfig.communityName, 'Setup test');
assert.equal(publicConfig.domains.community.origin, 'https://test.example');
const page = await call('/'); assert.equal(page.status, 200);
assert.match(page.headers['content-type'], /^text\/html/); assert.match(page.body, /<html/);
const auth = await call('/auth/register/begin', { method: 'POST' });
assert.equal(auth.status, 503); assert.deepEqual(JSON.parse(auth.body), { error: 'setup_required' });
assert.equal(auth.headers['set-cookie'], undefined);
assert.equal((await call('/', { host: 'root.test.example' })).status, 400);
assert.equal((await call('/api/config', { origin: 'https://other.example' })).status, 400);
console.log(JSON.stringify({ ok: true, checks: 8, uid: 1000, copiedConfigMode: '0600',
  setupStatus: 'setup-required', authStatus: 503, staticStatus: 200, strictHost: true,
  originChecked: true, elapsedMs: Date.now() - started }));
`;
try {
  // Readable public fixture; the entrypoint creates a private owned copy.
  await chmod(fixture, 0o755);
  await writeFile(join(fixture, 'cmeet.json'), JSON.stringify(config), { mode: 0o444 });
  await docker(['run', '--detach', '--name', container, '--network', 'none', '--read-only',
    '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'SETUID', '--cap-add', 'SETGID', '--cap-add', 'DAC_OVERRIDE',
    '--security-opt', 'no-new-privileges', '--tmpfs', '/run:rw,noexec,nosuid,size=16777216',
    '--mount', `type=bind,source=${fixture},target=/run/secrets/cmeet,readonly`, process.argv[2]]);
  const result = await docker(['exec', '--user', 'node', container, 'node', '--input-type=module', '--eval', probe]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true); assert.equal(report.uid, 1000);
  await writeFile(join(artifacts, 'setup-smoke.json'), JSON.stringify({ ...report,
    scope: 'Real image entrypoint and setup HTTP only; no member authentication, database or messaging claim' }, null, 2) + '\n');
  await writeFile(join(artifacts, 'setup-smoke.stderr.log'), result.stderr);
  console.log(`Setup image smoke passed (${report.checks} checks, uid ${report.uid})`);
} catch (error) {
  await writeFile(join(artifacts, 'setup-smoke.json'), JSON.stringify({ ok: false, error: String(error.message).slice(0, 512) }) + '\n');
  await writeFile(join(artifacts, 'setup-smoke.stderr.log'), String(error.stderr ?? '').slice(0, 65_536));
  process.exitCode = 1;
} finally {
  const logs = await docker(['logs', container]).catch(() => ({ stdout: '', stderr: '' }));
  await writeFile(join(artifacts, 'setup-container.log'), logs.stdout + logs.stderr);
  await docker(['stop', '--time', '5', container]).catch(() => {});
  await docker(['rm', '--force', container]).catch(() => {});
  await rm(fixture, { recursive: true, force: true });
}
