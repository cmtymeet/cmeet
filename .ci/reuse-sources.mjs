// Rebuild the app after a bundle/test-only change without recompiling unchanged
// Wasm/native dependencies. The original successful preparation stays evidence.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

assert.equal(process.env.CI, 'true');
const run = process.env.REUSE_SOURCE_RUN, source = process.env.REUSE_SOURCE_SHA;
assert.match(run ?? '', /^[0-9]+$/); assert.match(source ?? '', /^[0-9a-f]{40}$/);
const artifacts = resolve(process.env.ARTIFACT_ROOT), prior = resolve('.ci-work/reused-source');
await mkdir(prior, { recursive: true });
const execute = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
assert.equal(JSON.parse(execute('gh', ['run', 'view', run, '--repo', 'cmtymeet/cmeet', '--json', 'headSha'])).headSha, source);
execute('gh', ['run', 'download', run, '--repo', 'cmtymeet/cmeet', '--name', `cmeet-${source}`, '--dir', prior]);
execFileSync('sha256sum', ['--quiet', '--check', 'SHA256SUMS'], { cwd: prior, timeout: 120000 });
const manifest = JSON.parse(await readFile(join(prior, 'source-preparation.json')));
assert.equal(manifest.ok, true); assert.equal(manifest.source, source);
assert.deepEqual(manifest.sources, JSON.parse(await readFile('.ci/sources.json')));
assert(!process.env.CVLD_SOURCE_SHA, 'A source override requires new source preparation');
// The native app is an input too, independent of the library revision pins.
execute('git', ['fetch', '--depth=1', 'origin', source]);
const nativeFiles = execute('git', ['ls-tree', '-r', '--name-only', source, 'native/backend']).trim().split('\n')
  .filter(file => file !== 'native/backend/Cargo.lock');
const currentFiles = execute('git', ['ls-tree', '-r', '--name-only', 'HEAD', 'native/backend']).trim().split('\n')
  .filter(file => file !== 'native/backend/Cargo.lock');
assert.deepEqual(currentFiles, nativeFiles, 'Native source closure must be unchanged');
for (const file of nativeFiles) assert.equal(await readFile(file, 'utf8'), execute('git', ['show', `${source}:${file}`]));
assert.deepEqual(await readFile('native/backend/Cargo.lock'), await readFile(join(prior, 'cmeet-native-backend-Cargo.lock')));
assert.deepEqual(await readFile('package-lock.json'), await readFile(join(prior, 'package-lock.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const names = { cfrm: 'cfrm', 'cfrm-browser': 'cfrm-browser', '@corbet-labs/cmsg': 'cmsg', '@corbet-labs/cvld': 'cvld', 'tor-js': 'tor-js' };
assert.equal(manifest.packages.length, Object.keys(names).length);
const seen = new Set();
await mkdir('vendor', { recursive: true });
await mkdir(join(artifacts, 'packages'), { recursive: true });
for (const record of manifest.packages) {
  const name = names[record.name]; assert(name && !seen.has(name)); seen.add(name);
  assert.equal(record.archive, basename(record.archive));
  const archive = join(prior, 'packages', record.archive), bytes = await readFile(archive);
  assert.equal(hash(bytes), record.sha256);
  assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), record.integrity);
  const destination = join('vendor', name); await mkdir(destination);
  execute('tar', ['--extract', '--file', archive, '--directory', destination, '--strip-components=1', '--no-same-owner']);
  assert.equal(JSON.parse(await readFile(join(destination, 'package.json'))).name, record.name);
  await copyFile(archive, join(artifacts, 'packages', record.archive));
}
assert.equal(manifest.nativeBackend.built, true);
await mkdir(join(artifacts, 'native'), { recursive: true });
for (const [file, expected] of [['cmeet-cfrm-backend', manifest.nativeBackend.binarySha256],
  ['cvld-voucher-bridge', manifest.voucherBridge.sha256]]) {
  const bytes = await readFile(join(prior, 'native', file)); assert.equal(hash(bytes), expected);
  await writeFile(join(artifacts, 'native', file), bytes); await chmod(join(artifacts, 'native', file), 0o755);
}
await copyFile(join(prior, 'cmeet-native-backend-Cargo.lock'), join(artifacts, 'cmeet-native-backend-Cargo.lock'));
await copyFile(join(prior, 'source-preparation.json'), join(artifacts, 'source-preparation.json'));
await writeFile(join(artifacts, 'source-reuse.json'), JSON.stringify({ source: process.env.CI_COMMIT_SHA,
  originalSource: source, originalRun: run, nativeSourceUnchanged: true, exactPackagesAndLocks: true }, null, 2) + '\n');
