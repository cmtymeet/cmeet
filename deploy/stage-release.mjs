// CI-only release staging. This command consumes already prepared artifacts and
// a clean, current cmeet checkout. It never selects credentials or product
// configuration and never stages private community state.
import { createHash } from 'node:crypto';
import { execFile as rawExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  chmod, copyFile, lstat, mkdir, readFile, readlink, readdir, realpath, stat, writeFile
} from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

const execFile = promisify(rawExecFile);
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const PACKAGE_NAMES = new Set(['cfrm', 'cfrm-browser', '@corbet-labs/cmsg', '@corbet-labs/cvld', 'tor-js']);
const PACKAGE_DIRS = new Map([
  ['cfrm', 'cfrm'], ['cfrm-browser', 'cfrm-browser'], ['@corbet-labs/cmsg', 'cmsg'],
  ['@corbet-labs/cvld', 'cvld'], ['tor-js', 'tor-js'],
]);
const NATIVE_INSTALLER_SOURCE = 'https://github.com/anoncreds/anoncreds-rs/releases/download/v0.2.3/library-linux-x86_64.tar.gz';
const NATIVE_INSTALLER_ARCHIVE_SHA256 = 'f54f262dd63422830ce15f3240b82ffb729c3159a225d42ddd9e948d6f5582c9';
const NATIVE_INSTALLER_SCRIPT = 'vendor/cvld/scripts/install-native.js';
const NATIVE_INSTALLER_RESULT = 'node_modules/@hyperledger/anoncreds-nodejs/native/libanoncreds.so';

function fail(message) { throw new Error(`release staging rejected: ${message}`); }
function assert(condition, message) { if (!condition) fail(message); }
function safeRelative(value, label) {
  assert(typeof value === 'string' && value.length > 0 && !value.includes('\0'), `${label} path`);
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/');
  assert(!normalized.startsWith('/') && parts.every(part => part && part !== '.' && part !== '..'), `${label} path shape`);
  return normalized;
}
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function sha512Integrity(bytes) { return `sha512-${createHash('sha512').update(bytes).digest('base64')}`; }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function json(bytes, label) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(`${label} is not valid UTF-8 JSON`); }
}
async function existingDirectory(path, label) {
  assert(typeof path === 'string' && path.startsWith('/'), `${label} must be absolute`);
  const resolved = await realpath(path).catch(() => null);
  assert(resolved && (await stat(resolved)).isDirectory(), `${label} directory missing`);
  return resolved;
}
async function regularFile(path, label) {
  const info = await lstat(path).catch(() => null);
  assert(info?.isFile(), `${label} missing or not a regular file`);
  return readFile(path);
}
async function copyRegularFile(source, destination, label) {
  const bytes = await regularFile(source, label);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination);
  return bytes;
}
async function copyTree(source, destination, label, merge = false) {
  const info = await lstat(source).catch(() => null);
  assert(info, `${label} missing`);
  if (info.isSymbolicLink()) fail(`${label} contains an unexpected source symlink`);
  if (info.isFile()) { await copyRegularFile(source, destination, label); return; }
  assert(info.isDirectory(), `${label} has unsupported source type`);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const childSource = join(source, entry.name), childDestination = join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(childSource, childDestination, `${label}/${entry.name}`, merge);
    else if (entry.isFile()) {
      if (merge && await lstat(childDestination).catch(() => null)) {
        const old = await regularFile(childDestination, `${label}/${entry.name}`);
        const fresh = await regularFile(childSource, `${label}/${entry.name}`);
        assert(sha256(old) === sha256(fresh), `${label}/${entry.name} differs from reviewed proof input`);
      } else await copyRegularFile(childSource, childDestination, `${label}/${entry.name}`);
    } else fail(`${label}/${entry.name} has unsupported source type`);
  }
}
async function run(command, args, options = {}) {
  try {
    return await execFile(command, args, {
      cwd: options.cwd, env: { ...process.env, CI: 'true' }, timeout: options.timeout ?? 300_000,
      maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024, windowsHide: true,
    });
  } catch (error) { throw new Error(`${command} failed`, { cause: error }); }
}
async function git(repo, args) {
  const result = await run('git', ['-C', repo, ...args], { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
  return result.stdout.trim();
}
async function gitRaw(repo, args) {
  const result = await run('git', ['-C', repo, ...args], { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
  return result.stdout;
}
async function assertGitSourceClosure(repo, source) {
  const currentFiles = (await git(repo, ['ls-tree', '-r', '--name-only', 'HEAD', 'native/backend']))
    .split('\n').filter(Boolean).filter(file => file !== 'native/backend/Cargo.lock');
  const sourceFiles = (await git(repo, ['ls-tree', '-r', '--name-only', source, 'native/backend']))
    .split('\n').filter(Boolean).filter(file => file !== 'native/backend/Cargo.lock');
  assert(JSON.stringify(currentFiles) === JSON.stringify(sourceFiles), 'native backend source closure changed');
  for (const file of currentFiles) {
    const current = await regularFile(join(repo, file), file);
    const original = (await gitRaw(repo, ['show', `${source}:${file}`]))
      .replaceAll('\r\n', '\n');
    assert(new TextDecoder().decode(current).replaceAll('\r\n', '\n') === original, `${file} differs from prepared source`);
  }
}
async function assertCleanCurrentRepo(repo) {
  const status = await git(repo, ['status', '--porcelain=v1', '--untracked-files=all']);
  assert(status === '', 'current cmeet checkout is not clean');
  const commit = await git(repo, ['rev-parse', '--verify', 'HEAD^{commit}']);
  assert(HEX40.test(commit), 'current cmeet commit');
  return commit;
}
async function verifyPrepared(prepared, repo, currentCommit) {
  const sourcePreparationPath = join(prepared, 'source-preparation.json');
  const preparation = json(await regularFile(sourcePreparationPath, 'source-preparation.json'), 'source-preparation.json');
  assert(preparation?.ok === true && HEX40.test(preparation.source), 'source preparation evidence');
  const currentSources = json(await regularFile(join(repo, '.ci/sources.json'), '.ci/sources.json'), '.ci/sources.json');
  assert(canonical(currentSources) === canonical(preparation.sources), 'library source pins changed');
  await assertGitSourceClosure(repo, preparation.source);
  const preparedLock = await regularFile(join(prepared, 'package-lock.json'), 'prepared package-lock.json');
  const currentLock = await regularFile(join(repo, 'package-lock.json'), 'current package-lock.json');
  assert(sha256(preparedLock) === sha256(currentLock), 'package lock differs from prepared source');
  const preparedCargoLock = await regularFile(join(prepared, 'cmeet-native-backend-Cargo.lock'), 'prepared native Cargo.lock');
  const currentCargoLock = await regularFile(join(repo, 'native/backend/Cargo.lock'), 'current native Cargo.lock');
  assert(sha256(preparedCargoLock) === sha256(currentCargoLock), 'native Cargo.lock differs from prepared source');
  if (preparation.source !== currentCommit) {
    const reusePath = join(prepared, 'source-reuse.json');
    const reuse = json(await regularFile(reusePath, 'source-reuse.json'), 'source-reuse.json');
    assert(reuse.source === currentCommit && reuse.originalSource === preparation.source
      && /^[0-9]+$/.test(String(reuse.originalRun)) && reuse.nativeSourceUnchanged === true
      && reuse.exactPackagesAndLocks === true, 'source reuse proof does not bind current checkout');
  }
  return preparation;
}
async function verifyArchive(prepared, record) {
  assert(record && PACKAGE_NAMES.has(record.name), 'prepared package name');
  assert(typeof record.archive === 'string' && basename(record.archive) === record.archive, `${record.name} archive name`);
  assert(HEX64.test(record.sha256) && typeof record.integrity === 'string', `${record.name} archive digest`);
  const bytes = await regularFile(join(prepared, 'packages', record.archive), `${record.name} archive`);
  assert(sha256(bytes) === record.sha256 && sha512Integrity(bytes) === record.integrity, `${record.name} archive mismatch`);
  return bytes;
}
async function extractPackage(prepared, output, record) {
  const archive = join(prepared, 'packages', record.archive);
  const directory = join(output, 'vendor', PACKAGE_DIRS.get(record.name));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const listing = (await run('tar', ['--list', '--file', archive], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 })).stdout;
  for (const item of listing.split('\n').map(value => value.trim()).filter(Boolean)) {
    const path = item.replaceAll('\\', '/');
    const parts = path.split('/');
    assert(parts[0] === 'package' && parts.length >= 2
      && parts.slice(1).every((part, index, tail) => part
        ? part !== '.' && part !== '..'
        : index === tail.length - 1), `${record.name} archive path`);
  }
  await run('tar', ['--extract', '--file', archive, '--directory', directory, '--strip-components=1', '--no-same-owner', '--no-same-permissions'], { timeout: 120_000 });
  const manifest = json(await regularFile(join(directory, 'package.json'), `${record.name} extracted package.json`), `${record.name} package.json`);
  assert(manifest.name === record.name, `${record.name} extracted package name`);
}
async function mergeProof(proof, destination) {
  await copyTree(proof, destination, 'public proof artifacts', true);
  for (const path of ['manifest.json', 'circuit.json', 'vk.bin', 'setup/g1.dat', 'setup/g2.dat',
    'barretenberg-threads.wasm', 'peer-reservation/circuit.json', 'peer-reservation/vk.bin']) {
    await regularFile(join(destination, ...path.split('/')), `public proof ${path}`);
  }
}
async function readLinkRecord(root, path) {
  const full = join(root, ...path.split('/'));
  const target = await readlink(full);
  assert(target && !target.startsWith('/') && !target.includes('\0'), `${path} symlink target`);
  const rootReal = await realpath(root);
  const targetReal = await realpath(full).catch(() => null);
  assert(targetReal && targetReal !== rootReal && targetReal.startsWith(rootReal + sep), `${path} symlink escapes output`);
  return { path, type: 'symlink', target };
}
async function collect(root, relativePath, records) {
  const full = join(root, ...relativePath.split('/'));
  const info = await lstat(full);
  if (info.isSymbolicLink()) { records.push(await readLinkRecord(root, relativePath)); return; }
  if (info.isDirectory()) {
    for (const entry of await readdir(full, { withFileTypes: true })) await collect(root, `${relativePath}/${entry.name}`, records);
    return;
  }
  assert(info.isFile(), `${relativePath} has unsupported output type`);
  records.push({ path: relativePath, sha256: sha256(await readFile(full)) });
}
async function normalizePublicTree(root, relativePath) {
  const full = join(root, ...relativePath.split('/'));
  const info = await lstat(full);
  if (info.isSymbolicLink()) return;
  if (info.isDirectory()) {
    await chmod(full, 0o755);
    for (const entry of await readdir(full, { withFileTypes: true })) {
      await normalizePublicTree(root, `${relativePath}/${entry.name}`);
    }
    return;
  }
  assert(info.isFile(), `${relativePath} has unsupported output type`);
  await chmod(full, info.mode & 0o111 ? 0o755 : 0o644);
}
async function main() {
  assert(process.env.CI === 'true', 'release staging is CI-only');
  assert(Number(process.versions.node.split('.')[0]) >= 24, 'Node 24 is required');
  assert(process.argv.length === 10, 'usage: node deploy/stage-release.mjs --prepared DIR --proof DIR --repo DIR --output DIR');
  const values = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index], value = process.argv[index + 1];
    assert(['--prepared', '--proof', '--repo', '--output'].includes(key) && value && value.startsWith('/'), 'explicit absolute staging arguments required');
    assert(!values.has(key), `duplicate ${key}`); values.set(key, value);
  }
  const prepared = await existingDirectory(values.get('--prepared'), 'prepared artifact');
  const proof = await existingDirectory(values.get('--proof'), 'public proof');
  const repo = await existingDirectory(values.get('--repo'), 'current repository');
  const output = resolve(values.get('--output'));
  assert(output === values.get('--output') && output.startsWith('/'), 'output must be absolute');
  assert(!(await lstat(output).catch(() => null)), 'output directory already exists');

  const currentCommit = await assertCleanCurrentRepo(repo);
  const preparation = await verifyPrepared(prepared, repo, currentCommit);
  assert(Array.isArray(preparation.packages) && preparation.packages.length === PACKAGE_NAMES.size, 'prepared package set');
  const seen = new Set();
  for (const record of preparation.packages) {
    assert(!seen.has(record.name), `${record.name} package duplicated`); seen.add(record.name);
    await verifyArchive(prepared, record);
  }
  assert(seen.size === PACKAGE_NAMES.size, 'prepared package set incomplete');

  // Create the exclusive destination only after all source and input checks;
  // a destination beneath the checkout must not make the checkout appear dirty.
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await mkdir(output, { recursive: false, mode: 0o700 });

  await copyRegularFile(join(repo, 'package.json'), join(output, 'package.json'), 'package.json');
  await copyRegularFile(join(repo, 'package-lock.json'), join(output, 'package-lock.json'), 'package-lock.json');
  await copyTree(join(repo, 'server'), join(output, 'server'), 'server');
  await copyTree(join(repo, 'dist'), join(output, 'dist'), 'dist');
  await mergeProof(proof, join(output, 'dist/accounting'));
  for (const record of preparation.packages) await extractPackage(prepared, output, record);
  await run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: output, timeout: 600_000 });
  await mkdir(join(output, 'bin'), { recursive: true, mode: 0o700 });
  await copyRegularFile(join(prepared, 'native/cmeet-cfrm-backend'), join(output, 'bin/cmeet-cfrm-backend'), 'native cfrm backend');
  await copyRegularFile(join(prepared, 'native/cvld-voucher-bridge'), join(output, 'bin/cvld-voucher-bridge'), 'native voucher bridge');
  await chmod(join(output, 'bin/cmeet-cfrm-backend'), 0o755);
  await chmod(join(output, 'bin/cvld-voucher-bridge'), 0o755);
  await copyRegularFile(join(prepared, 'source-preparation.json'), join(output, 'source-preparation.json'), 'source-preparation.json');
  if (await lstat(join(prepared, 'source-reuse.json')).catch(() => null)) {
    await copyRegularFile(join(prepared, 'source-reuse.json'), join(output, 'source-reuse.json'), 'source-reuse.json');
  }
  await mkdir(join(output, 'packages'), { recursive: true, mode: 0o700 });
  for (const record of preparation.packages) await copyRegularFile(join(prepared, 'packages', record.archive), join(output, 'packages', record.archive), `${record.name} archive`);

  const installerBytes = await regularFile(join(output, NATIVE_INSTALLER_SCRIPT), NATIVE_INSTALLER_SCRIPT);
  assert(new TextDecoder().decode(installerBytes).includes(NATIVE_INSTALLER_SOURCE)
    && new TextDecoder().decode(installerBytes).includes(NATIVE_INSTALLER_ARCHIVE_SHA256), 'cvld native installer pin changed');
  await run(process.execPath, ['node_modules/@corbet-labs/cvld/scripts/install-native.js'], { cwd: output, timeout: 120_000 });
  const nativeResult = await regularFile(join(output, NATIVE_INSTALLER_RESULT), NATIVE_INSTALLER_RESULT);
  const nativeInstaller = {
    source: NATIVE_INSTALLER_SOURCE, archiveSha256: NATIVE_INSTALLER_ARCHIVE_SHA256,
    scriptPath: NATIVE_INSTALLER_SCRIPT, resultPath: NATIVE_INSTALLER_RESULT, resultSha256: sha256(nativeResult),
  };
  await writeFile(join(output, 'native-installer.json'), JSON.stringify(nativeInstaller, null, 2) + '\n', { mode: 0o600 });

  // Docker COPY preserves these modes. Public application trees must remain
  // traversable after the image drops from root to the node user.
  for (const root of ['server', 'dist', 'vendor', 'node_modules', 'bin']) {
    await normalizePublicTree(output, root);
  }

  const records = [];
  for (const root of ['package.json', 'package-lock.json', 'server', 'dist', 'vendor', 'node_modules', 'bin',
    'source-preparation.json', 'packages', 'native-installer.json']) await collect(output, root, records);
  if (await lstat(join(output, 'source-reuse.json')).catch(() => null)) await collect(output, 'source-reuse.json', records);
  const release = {
    format: 'cmeet.release.v1', source: currentCommit, sourcePreparation: 'source-preparation.json',
    nativeInstaller, files: records.sort((left, right) => left.path.localeCompare(right.path)),
  };
  await writeFile(join(output, 'release-manifest.json'), JSON.stringify(release, null, 2) + '\n', { mode: 0o600 });
  await run(process.execPath, [join(repo, 'deploy/validate-release.mjs'), output], { cwd: repo, timeout: 300_000 });
  process.stdout.write(JSON.stringify({ ok: true, source: currentCommit, output, files: records.length,
    anoncredsSha256: nativeInstaller.resultSha256 }) + '\n');
}

try { await main(); }
catch (error) { process.stderr.write(`${error.message ?? 'release staging failed'}\n`); process.exitCode = 1; }
