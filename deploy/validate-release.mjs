import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const PACKAGE_NAMES = new Set(['cfrm', 'cfrm-browser', '@corbet-labs/cmsg', '@corbet-labs/cvld', 'tor-js']);
const VENDOR_DIRS = ['cmsg', 'cvld', 'cfrm', 'cfrm-browser', 'tor-js'];
const SERVER_FILES = ['start.mjs', 'app.mjs', 'api.mjs', 'mcp.mjs', 'backend.mjs', 'enrollment.mjs',
  'anonymous-tickets.mjs', 'storage.mjs', 'account-config.mjs', 'client-config.mjs', 'domains.mjs'];
const PUBLIC_ACCOUNTING_FILES = ['manifest.json', 'circuit.json', 'vk.bin', 'setup/g1.dat', 'setup/g2.dat',
  'barretenberg-threads.wasm', 'peer-reservation/circuit.json', 'peer-reservation/vk.bin'];
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
async function regularFile(root, relativePath, label = relativePath) {
  const safe = safeRelative(relativePath, label);
  const path = join(root, ...safe.split('/'));
  const info = await lstat(path).catch(() => null);
  assert(info?.isFile(), `${label} missing or not a regular file`);
  const resolved = await realpath(path);
  const rootReal = await realpath(root);
  assert(resolved === rootReal || resolved.startsWith(rootReal + sep), `${label} symlink escapes staging`);
  return { path, bytes: await readFile(path), relativePath: safe };
}
async function digestFile(root, relativePath, expected, label = relativePath) {
  assert(HEX64.test(expected), `${label} digest`);
  const file = await regularFile(root, relativePath, label);
  assert(sha256(file.bytes) === expected, `${label} digest mismatch`);
  return file;
}
function safeLinkTarget(target, label) {
  assert(typeof target === 'string' && target.length > 0 && !target.includes('\0') && !target.startsWith('/'), `${label} symlink target`);
  return target;
}
async function validateSymlink(root, relativePath, record) {
  assert(record?.type === 'symlink', `${relativePath} must declare symlink type`);
  const linkPath = join(root, ...safeRelative(relativePath, 'runtime link').split('/'));
  const target = safeLinkTarget(record.target, relativePath);
  assert(await readlink(linkPath) === target, `${relativePath} symlink target mismatch`);
  const rootReal = await realpath(root);
  const targetPath = resolve(dirname(linkPath), target);
  const targetReal = await realpath(targetPath).catch(() => null);
  assert(targetReal && targetReal !== rootReal && targetReal.startsWith(rootReal + sep), `${relativePath} symlink escapes staging`);
  const targetInfo = await stat(targetPath).catch(() => null);
  assert(targetInfo?.isFile() || targetInfo?.isDirectory(), `${relativePath} symlink target type`);
}
async function validateRuntimeTree(root, relativeRoot, declared) {
  const rootPath = join(root, ...safeRelative(relativeRoot, 'runtime root').split('/'));
  const rootInfo = await lstat(rootPath).catch(() => null);
  assert(rootInfo?.isDirectory(), `${relativeRoot} runtime directory missing`);
  async function walk(current) {
    for (const entry of await readdir(join(root, ...current.split('/')), { withFileTypes: true })) {
      const path = `${current}/${entry.name}`;
      safeRelative(path, 'runtime file');
      if (entry.isDirectory()) { await walk(path); continue; }
      const record = declared.get(path);
      if (entry.isSymbolicLink()) {
        await validateSymlink(root, path, record);
        continue;
      }
      assert(entry.isFile(), `${path} has unsupported runtime file type`);
      assert(record && record.type !== 'symlink', `${path} is missing from release manifest`);
      await digestFile(root, path, record.sha256, path);
    }
  }
  await walk(relativeRoot);
}
async function jsonFile(root, relativePath) {
  const file = await regularFile(root, relativePath);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)); }
  catch { fail(`${relativePath} is not valid UTF-8 JSON`); }
}
function assertSourceRevision(value, label) { assert(typeof value === 'string' && HEX40.test(value), `${label} source revision`); }
async function validatePublicAccounting(stage, declared) {
  const root = 'dist/accounting';
  const manifestPath = `${root}/manifest.json`;
  const manifest = await jsonFile(stage, manifestPath);
  assert(manifest.version === 1 && manifest.compiler === '1.0.0-beta.26' && manifest.backend === '5.0.0'
    && manifest.verifierTarget === 'noir-recursive' && manifest.accountingMode === 'account-state-v2'
    && manifest.hashScheme === 'poseidon2-bn254-fixed-128-v1', 'accounting artifact manifest contract');
  const expected = [['circuit.json', manifest.circuitSha256], ['vk.bin', manifest.vkSha256]];
  assert(Array.isArray(manifest.setup) && manifest.setup.length === 2, 'accounting setup manifest');
  const setup = new Set();
  for (const item of manifest.setup) {
    assert(item && ['g1.dat', 'g2.dat'].includes(item.name) && !setup.has(item.name)
      && Number.isSafeInteger(item.bytes) && item.bytes > 0 && HEX64.test(item.sha256), 'accounting setup pin');
    setup.add(item.name);
    expected.push([`setup/${item.name}`, item.sha256, item.bytes]);
  }
  assert(setup.size === 2, 'accounting setup names');
  assert(Array.isArray(manifest.wasm) && manifest.wasm.length === 1
    && manifest.wasm[0]?.name === 'barretenberg-threads.wasm'
    && Number.isSafeInteger(manifest.wasm[0].bytes) && manifest.wasm[0].bytes > 0
    && HEX64.test(manifest.wasm[0].sha256), 'accounting browser Wasm pin');
  expected.push(['barretenberg-threads.wasm', manifest.wasm[0].sha256, manifest.wasm[0].bytes]);
  const peer = manifest.peerReservation;
  assert(peer && peer.mode === 'peer-reservation-v3' && peer.publicInputs === 389
    && peer.sharesAccountSetup === true && HEX64.test(peer.circuitSha256) && HEX64.test(peer.vkSha256), 'accounting peer pins');
  expected.push(['peer-reservation/circuit.json', peer.circuitSha256]);
  expected.push(['peer-reservation/vk.bin', peer.vkSha256]);
  for (const [path, digest, bytes] of expected) {
    const fullPath = `${root}/${path}`;
    assert(declared.has(fullPath), `${fullPath} is not declared in release manifest`);
    const file = await digestFile(stage, fullPath, digest, fullPath);
    if (bytes !== undefined) assert(file.bytes.length === bytes, `${fullPath} byte count mismatch`);
  }
}
async function main() {
  assert(process.argv.length === 3, 'usage: node deploy/validate-release.mjs /absolute/stage');
  const stage = resolve(process.argv[2]);
  assert(stage === process.argv[2] && stage.startsWith('/'), 'an absolute staging path is required');
  const stageReal = await realpath(stage).catch(() => null);
  assert(stageReal, 'staging directory is missing');

  const release = await jsonFile(stageReal, 'release-manifest.json');
  assert(release?.format === 'cmeet.release.v1', 'release manifest format');
  assertSourceRevision(release.source, 'release');
  assert(release.sourcePreparation === 'source-preparation.json', 'source-preparation path');
  assert(Array.isArray(release.files) && release.files.length > 0, 'release file manifest');
  const declared = new Map();
  for (const record of release.files) {
    assert(record && typeof record === 'object' && !Array.isArray(record), 'release file record');
    const path = safeRelative(record.path, 'release file');
    assert(!declared.has(path), `duplicate release file ${path}`);
    assert(record.type === undefined || record.type === 'file' || record.type === 'symlink', `${path} record type`);
    declared.set(path, record);
    if (record.type === 'symlink') await validateSymlink(stageReal, path, record);
    else await digestFile(stageReal, path, record.sha256);
  }
  const requireDeclared = path => assert(declared.has(path), `${path} is not declared in release manifest`);
  requireDeclared('source-preparation.json');

  const preparation = await jsonFile(stageReal, 'source-preparation.json');
  assert(preparation?.ok === true, 'source preparation was not successful');
  assertSourceRevision(preparation.source, 'source preparation');
  if (preparation.source !== release.source) {
    requireDeclared('source-reuse.json');
    const reuse = await jsonFile(stageReal, 'source-reuse.json');
    assert(reuse.source === release.source && reuse.originalSource === preparation.source
      && /^[0-9]+$/.test(String(reuse.originalRun)) && reuse.nativeSourceUnchanged === true
      && reuse.exactPackagesAndLocks === true, 'source reuse proof');
  }
  assert(preparation.sources && typeof preparation.sources === 'object' && !Array.isArray(preparation.sources), 'source preparation pins');
  for (const [name, pin] of Object.entries(preparation.sources)) {
    assert(pin && typeof pin === 'object', `${name} source pin`);
    assertSourceRevision(pin.revision, name);
    assert(typeof pin.repository === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pin.repository), `${name} repository`);
  }
  assert(Array.isArray(preparation.packages) && preparation.packages.length === PACKAGE_NAMES.size, 'prepared package set');
  const seenPackages = new Set();
  for (const record of preparation.packages) {
    assert(record && PACKAGE_NAMES.has(record.name) && !seenPackages.has(record.name), 'prepared package name');
    seenPackages.add(record.name);
    assert(typeof record.source === 'string' && HEX40.test(record.source), `${record.name} package source`);
    const expectedSource = {
      cfrm: preparation.sources.cfrm?.revision,
      'cfrm-browser': preparation.sources.cfrm?.revision,
      '@corbet-labs/cmsg': preparation.sources.cmsg?.revision,
      '@corbet-labs/cvld': preparation.sources.cvld?.revision,
      'tor-js': preparation.torPackage?.source,
    }[record.name];
    assert(record.source === expectedSource, `${record.name} package/source binding`);
    assert(typeof record.archive === 'string' && basename(record.archive) === record.archive, `${record.name} package archive`);
    assert(HEX64.test(record.sha256), `${record.name} package digest`);
    assert(typeof record.integrity === 'string' && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(record.integrity), `${record.name} package integrity`);
    const archive = await regularFile(stageReal, `packages/${record.archive}`, `${record.name} archive`);
    assert(sha256(archive.bytes) === record.sha256, `${record.name} archive digest mismatch`);
    const integrity = `sha512-${createHash('sha512').update(archive.bytes).digest('base64')}`;
    assert(integrity === record.integrity, `${record.name} archive integrity mismatch`);
  }
  assert(seenPackages.size === PACKAGE_NAMES.size, 'prepared package set incomplete');
  assert(preparation.torPackage?.downloaded === true && HEX64.test(preparation.torPackage.sha256), 'Tor package evidence');
  assert(preparation.nativeBackend?.built === true && HEX64.test(preparation.nativeBackend.binarySha256), 'native backend evidence');
  assert(preparation.voucherBridge && HEX64.test(preparation.voucherBridge.sha256), 'voucher bridge evidence');
  assert(release.nativeInstaller?.source === NATIVE_INSTALLER_SOURCE
    && release.nativeInstaller.archiveSha256 === NATIVE_INSTALLER_ARCHIVE_SHA256
    && release.nativeInstaller.scriptPath === NATIVE_INSTALLER_SCRIPT
    && release.nativeInstaller.resultPath === NATIVE_INSTALLER_RESULT
    && HEX64.test(release.nativeInstaller.resultSha256), 'anoncreds native installer provenance');
  requireDeclared(NATIVE_INSTALLER_SCRIPT);
  requireDeclared(NATIVE_INSTALLER_RESULT);
  await digestFile(stageReal, NATIVE_INSTALLER_RESULT, release.nativeInstaller.resultSha256);

  const required = [
    'package.json', 'package-lock.json', 'server/start.mjs', ...SERVER_FILES.slice(1).map(file => `server/${file}`),
    'dist/index.html', ...PUBLIC_ACCOUNTING_FILES.map(file => `dist/accounting/${file}`),
    'bin/cmeet-cfrm-backend', 'bin/cvld-voucher-bridge',
  ];
  for (const path of required) { requireDeclared(path); await regularFile(stageReal, path); }
  await digestFile(stageReal, 'bin/cmeet-cfrm-backend', preparation.nativeBackend.binarySha256);
  await digestFile(stageReal, 'bin/cvld-voucher-bridge', preparation.voucherBridge.sha256);
  await validatePublicAccounting(stageReal, declared);

  const packageJson = await jsonFile(stageReal, 'package.json');
  const lock = await jsonFile(stageReal, 'package-lock.json');
  assert(packageJson?.engines?.node === '>=24', 'Node 24 package engine');
  assert(lock?.lockfileVersion === 3, 'npm lockfile version');
  assert(packageJson.dependencies?.['@corbet-labs/cmsg'] === 'file:vendor/cmsg'
    && packageJson.dependencies?.['@corbet-labs/cvld'] === 'file:vendor/cvld'
    && packageJson.dependencies?.cfrm === 'file:vendor/cfrm'
    && packageJson.dependencies?.['cfrm-browser'] === 'file:vendor/cfrm-browser'
    && packageJson.dependencies?.['tor-js'] === 'file:vendor/tor-js', 'vendored package dependencies');
  for (const directory of VENDOR_DIRS) {
    const packageFile = await jsonFile(stageReal, `vendor/${directory}/package.json`);
    assert(typeof packageFile.name === 'string', `vendor/${directory} package name`);
  }
  const nodeModules = await lstat(join(stageReal, 'node_modules')).catch(() => null);
  assert(nodeModules?.isDirectory(), 'production node_modules directory');
  for (const devPath of ['node_modules/vite', 'node_modules/svelte', 'node_modules/playwright', 'node_modules/@sveltejs']) {
    assert(!(await lstat(join(stageReal, devPath)).catch(() => null)), `development dependency present: ${devPath}`);
  }
  for (const [name, directory] of [['@corbet-labs/cmsg', 'cmsg'], ['@corbet-labs/cvld', 'cvld'], ['cfrm', 'cfrm'], ['cfrm-browser', 'cfrm-browser'], ['tor-js', 'tor-js']]) {
    const entry = lock.packages?.[`node_modules/${name}`];
    assert(entry?.resolved === `vendor/${directory}`, `${name} lock vendor resolution`);
  }
  for (const directory of ['server', 'dist', 'vendor', 'node_modules', 'bin']) {
    await validateRuntimeTree(stageReal, directory, declared);
  }

  const config = {
    source: release.source,
    files: release.files.length,
    packages: preparation.packages.map(record => record.name).sort(),
    nativeBackendSha256: preparation.nativeBackend.binarySha256,
    voucherBridgeSha256: preparation.voucherBridge.sha256,
  };
  process.stdout.write(JSON.stringify({ ok: true, release: config }) + '\n');
}

try { await main(); }
catch (error) { process.stderr.write(`${error.message ?? 'release validation failed'}\n`); process.exitCode = 1; }
