// Remote CI only: build exact library source revisions, without rerunning proofs.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

assert.equal(process.env.CI, 'true', 'Source preparation is remote CI work');
assert.match(process.env.CI_COMMIT_SHA ?? '', /^[0-9a-f]{40}$/);
assert(process.env.ARTIFACT_ROOT && process.env.CARGO_TARGET_DIR, 'Owned artifact and Cargo directories required');
const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, '.ci-work'), vendor = join(root, 'vendor');
const artifacts = resolve(process.env.ARTIFACT_ROOT), packageDir = join(artifacts, 'packages');
await mkdir(work, { recursive: true }); await mkdir(vendor, { recursive: true });
await mkdir(packageDir, { recursive: true });
const reviewedTor = Object.freeze({
  repository: 'cmtymeet/cmsg',
  runId: '35756419650',
  artifact: 'cmsg-tor-public-package-1d5217bea90730e2a5c018b88576d2d3ef9c6c21',
  source: '1d5217bea90730e2a5c018b88576d2d3ef9c6c21',
  archive: 'runtime/tor-js-0.4.1-cmsg-experiment.1d5217bea907.tgz',
  sha256: 'b4de87950de0ffcf331efa5c1a3617c5bcc41c48d7706f547d975bf419f06f39'
});
const sources = JSON.parse(await readFile(join(root, '.ci/sources.json'), 'utf8'));
if (process.env.CVLD_SOURCE_SHA) sources.cvld.revision = process.env.CVLD_SOURCE_SHA;
const resolveDependencies = process.env.RESOLVE_DEPENDENCIES === '1';
const evidence = { source: process.env.CI_COMMIT_SHA, ok: false, sources, packages: [],
  scope: 'Source-built library packages, browser credential holder, native voucher verifier, native cmeet cfrm backend and exact reviewed Tor package; no accounting proofs or Tor network runtime',
  dependencyResolutionRequested: resolveDependencies, resolvedCargoLocks: [], privateHolderBuilt: false,
  torPackage: { ...reviewedTor, downloaded: false } };
const execute = promisify(execFile);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function run(label, command, args, cwd = root, env = process.env, timeout = 1_200_000) {
  process.stdout.write(label + '\n');
  let output, failure;
  try { output = await execute(command, args, { cwd, env, timeout, killSignal: 'SIGTERM', maxBuffer: 8 * 1024 * 1024 }); }
  catch (error) { output = error; failure = error; }
  await writeFile(join(artifacts, label + '.stdout.log'), String(output.stdout ?? ''));
  await writeFile(join(artifacts, label + '.stderr.log'), String(output.stderr ?? ''));
  if (failure) throw new Error(label + ' failed; see retained logs', { cause: failure });
  return output.stdout;
}
async function checkout(name, target = join(work, name)) {
  const pin = sources[name];
  assert.match(pin.revision ?? '', /^[0-9a-f]{40}$/, 'Exact ' + name + ' revision required');
  assert.match(pin.repository, /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/);
  await mkdir(target, { recursive: true });
  await run(name + '-git-init', 'git', ['init', '--quiet'], target);
  await run(name + '-git-origin', 'git', ['remote', 'add', 'origin', 'https://github.com/' + pin.repository + '.git'], target);
  await run(name + '-git-fetch', 'git', ['fetch', '--depth=1', 'origin', pin.revision], target);
  await run(name + '-git-checkout', 'git', ['-c', 'advice.detachedHead=false', 'checkout', '--detach', 'FETCH_HEAD'], target);
  assert.equal((await run(name + '-git-revision', 'git', ['rev-parse', 'HEAD'], target)).trim(), pin.revision);
  return target;
}
async function retainLock(label, file) {
  const bytes = await readFile(file);
  await writeFile(join(artifacts, label), bytes);
  return sha256(bytes);
}
async function ensureCargoLock(label, manifest, cwd) {
  const lock = join(dirname(manifest), 'Cargo.lock');
  try { return sha256(await readFile(lock)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert(resolveDependencies, label + ' Cargo.lock is absent; explicit first resolution is required');
  await run(label + '-resolve', 'cargo', ['generate-lockfile', '--manifest-path', manifest], cwd);
  evidence.resolvedCargoLocks.push(label);
  return sha256(await readFile(lock));
}
async function nativeBackend() {
  const directory = join(root, 'native/backend');
  const manifest = await readFile(join(directory, 'Cargo.toml'), 'utf8');
  for (const name of ['cfrm', 'cmsg']) {
    assert(manifest.split('\n').find(line => line.startsWith(name + ' ='))?.includes('rev = "' + sources[name].revision + '"'),
      'The native backend must use the same exact ' + name + ' source as the browser package');
  }
  const lock = join(directory, 'Cargo.lock');
  const nativeEvidence = { directory, built: false };
  evidence.nativeBackend = nativeEvidence;
  try {
    if (resolveDependencies) {
      // Source-pin changes may require new transitive dependencies. Resolve
      // only the two changed workspace libraries and retain that exact graph.
      await run('cmeet-native-update', 'cargo', ['update', '--manifest-path', join(directory, 'Cargo.toml'),
        '--package', 'cfrm', '--package', 'cmsg'], root);
      evidence.resolvedCargoLocks.push('cmeet-native-pins');
    }
    const lockDigest = await ensureCargoLock('cmeet-native', join(directory, 'Cargo.toml'), root);
    await run('cmeet-native-build', 'cargo', ['build', '--locked', '--release', '--manifest-path', join(directory, 'Cargo.toml')], root, process.env, 1_500_000);
    assert.equal(sha256(await readFile(lock)), lockDigest, 'Native backend lock must remain unchanged');
    const binary = join(process.env.CARGO_TARGET_DIR, 'release/cmeet-cfrm-backend');
    await mkdir(join(artifacts, 'native'), { recursive: true });
    await copyFile(binary, join(artifacts, 'native/cmeet-cfrm-backend'));
    nativeEvidence.built = true;
    nativeEvidence.binary = 'native/cmeet-cfrm-backend';
    nativeEvidence.binarySha256 = sha256(await readFile(binary));
  } finally {
    try { nativeEvidence.lockSha256 = await retainLock('cmeet-native-backend-Cargo.lock', lock); }
    catch (error) { nativeEvidence.lockError = String(error.message ?? error); }
  }
}
async function bindings(name, directory) {
  const sourceLock = await retainLock(name + '-Cargo.lock', join(directory, 'Cargo.lock'));
  const helperLock = await retainLock(name + '-bindgen-Cargo.lock', join(directory, '.ci/browser-bindgen/Cargo.lock'));
  const featureArgs = name === 'cfrm' ? ['--no-default-features', '--features', 'browser'] : [];
  await run(name + '-wasm-build', 'cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', ...featureArgs, '--lib'], directory);
  await run(name + '-bindgen', 'cargo', ['run', '--locked', '--manifest-path', '.ci/browser-bindgen/Cargo.toml', '--',
    join(process.env.CARGO_TARGET_DIR, 'wasm32-unknown-unknown/release', name + '.wasm'), 'browser/pkg', name], directory);
  assert.equal(sha256(await readFile(join(directory, 'Cargo.lock'))), sourceLock, 'Source binding lock must remain unchanged');
  assert.equal(sha256(await readFile(join(directory, '.ci/browser-bindgen/Cargo.lock'))), helperLock, 'Binding helper lock must remain unchanged');
}
async function installArchive(name, archive, source, expectedIntegrity) {
  const bytes = await readFile(archive), integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  if (expectedIntegrity) assert.equal(integrity, expectedIntegrity);
  const retainedArchive = join(packageDir, basename(archive));
  if (resolve(archive) !== retainedArchive) {
    await copyFile(archive, retainedArchive);
    assert.equal(sha256(await readFile(retainedArchive)), sha256(bytes), 'Retained archive copy');
  }
  const target = join(vendor, name);
  await mkdir(target);
  await run(name + '-extract-package', 'tar', ['--extract', '--file', archive, '--directory', target,
    '--strip-components=1', '--no-same-owner'], root, process.env, 30_000);
  const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
  assert.equal(manifest.name, { cfrm: 'cfrm', 'cfrm-browser': 'cfrm-browser', cmsg: '@corbet-labs/cmsg', cvld: '@corbet-labs/cvld', 'tor-js': 'tor-js' }[name]);
  let licensed = false;
  for (const file of ['LICENSE.md', 'LICENSE-MIT', 'LICENSE-APACHE']) {
    try { if ((await readFile(join(target, file))).length > 0) { licensed = true; break; } } catch {}
  }
  assert(licensed, 'Library license required');
  evidence.packages.push({ name: manifest.name, source, archive: basename(archive), sha256: sha256(bytes), integrity });
}

async function downloadReviewedTor() {
  const stage = join(artifacts, 'tor-download');
  await mkdir(stage, { recursive: true });
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  assert(typeof token === 'string' && token.length > 0, 'Authenticated GitHub token required for reviewed Tor artifact');
  await run('tor-artifact-download', 'gh', ['run', 'download', reviewedTor.runId, '--repo', reviewedTor.repository,
    '--name', reviewedTor.artifact, '--dir', stage], root, { ...process.env, GH_TOKEN: token }, 120_000);
  const archive = join(stage, reviewedTor.archive);
  const bytes = await readFile(archive);
  assert.equal(sha256(bytes), reviewedTor.sha256, 'Reviewed Tor archive hash mismatch');
  evidence.torPackage.downloaded = true;
  evidence.torPackage.archiveSha256 = reviewedTor.sha256;
  evidence.torPackage.artifact = reviewedTor.artifact;
  return archive;
}
async function pack(name, directory, source) {
  const records = JSON.parse(await run(name + '-npm-pack', 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packageDir],
    directory, { ...process.env, npm_config_update_notifier: 'false' }, 120_000));
  assert.equal(records.length, 1);
  const record = records[0]; assert.equal(record.filename, basename(record.filename));
  await installArchive(name, join(packageDir, record.filename), source, record.integrity);
}
try {
  evidence.toolchains = { node: process.version, npm: (await run('npm-version', 'npm', ['--version'])).trim(),
    rust: (await run('rust-version', 'rustc', ['--version'])).trim(), cargo: (await run('cargo-version', 'cargo', ['--version'])).trim() };
  const cfrm = await checkout('cfrm'), cmsg = await checkout('cmsg'), cvld = await checkout('cvld');
  await bindings('cfrm', cfrm); await bindings('cmsg', cmsg);
  await pack('cfrm', cfrm, sources.cfrm.revision);
  await retainLock('cfrm-package-lock.json', join(cfrm, 'package-lock.json'));
  const cfrmStage = join(work, 'cfrm-browser-package');
  await mkdir(join(cfrmStage, 'pkg'), { recursive: true });
  for (const file of ['cfrm.js', 'cfrm.d.ts', 'cfrm_bg.wasm', 'cfrm_bg.wasm.d.ts']) {
    await copyFile(join(cfrm, 'browser/pkg', file), join(cfrmStage, 'pkg', file));
  }
  await copyFile(join(cfrm, 'browser/package.json'), join(cfrmStage, 'package.json'));
  await copyFile(join(cfrm, 'browser/CONSUMER.md'), join(cfrmStage, 'README.md'));
  await copyFile(join(cfrm, 'LICENSE.md'), join(cfrmStage, 'LICENSE.md'));
  await pack('cfrm-browser', cfrmStage, sources.cfrm.revision);
  const torArchive = await downloadReviewedTor();
  await installArchive('tor-js', torArchive, reviewedTor.source);
  const cmsgArtifacts = join(artifacts, 'cmsg-package');
  await run('cmsg-package', process.execPath, ['.ci/browser-package.mjs', cmsgArtifacts], cmsg,
    { ...process.env, CI_COMMIT_SHA: sources.cmsg.revision, BROWSER_BUILD_PROFILE: 'release' }, 180_000);
  const cmsgPackage = JSON.parse(await readFile(join(cmsgArtifacts, 'browser-package-evidence.json'), 'utf8'));
  assert.equal(cmsgPackage.ok, true); assert.equal(cmsgPackage.source, sources.cmsg.revision);
  for (const file of ['peer-channel.mjs', 'peer-channel.d.ts']) {
    assert(cmsgPackage.package.files.includes(file), 'Declared cmsg peer channel must be packed');
  }
  const cmsgArchive = join(packageDir, cmsgPackage.package.archive);
  await copyFile(join(cmsgArtifacts, cmsgPackage.package.archive), cmsgArchive);
  await installArchive('cmsg', cmsgArchive, sources.cmsg.revision, cmsgPackage.package.integrity);
  const cmsgManifest = JSON.parse(await readFile(join(vendor, 'cmsg/package.json'), 'utf8'));
  assert.equal(cmsgManifest.exports['./peer-channel']?.import, './peer-channel.mjs');
  assert.equal(cmsgManifest.exports['./peer-channel']?.types, './peer-channel.d.ts');
  for (const file of ['peer-channel.mjs', 'peer-channel.d.ts', 'pkg/cmsg.js', 'pkg/cmsg.d.ts', 'pkg/cmsg_bg.wasm', 'pkg/cmsg_bg.wasm.d.ts']) {
    assert.equal(sha256(await readFile(join(vendor, 'cmsg', file))), sha256(await readFile(join(cmsg, 'browser', file))),
      'Packed cmsg asset must equal the source preparation output');
  }
  const voucherManifest = join(cvld, 'native/voucher/Cargo.toml');
  assert((await readFile(voucherManifest, 'utf8')).includes('rev = "' + sources.cvch.revision + '"'), 'The voucher verifier must pin cvch');
  const originalVoucherLock = await ensureCargoLock('voucher', voucherManifest, cvld);
  await retainLock('cvld-voucher-Cargo.lock', join(cvld, 'native/voucher/Cargo.lock'));
  await run('voucher-build', 'cargo', ['build', '--locked', '--release', '--manifest-path', voucherManifest], cvld);
  const voucherLockSha256 = await retainLock('cvld-voucher-Cargo.lock', join(cvld, 'native/voucher/Cargo.lock'));
  assert.equal(voucherLockSha256, originalVoucherLock, 'Voucher lock must remain unchanged');
  const voucherBinary = join(process.env.CARGO_TARGET_DIR, 'release/cvld-voucher-bridge');
  await mkdir(join(artifacts, 'native'), { recursive: true });
  await copyFile(voucherBinary, join(artifacts, 'native/cvld-voucher-bridge'));
  evidence.voucherBridge = { path: voucherBinary, sha256: sha256(await readFile(voucherBinary)), cvchSource: sources.cvch.revision, lockSha256: voucherLockSha256 };
  await nativeBackend();
  const holderArtifacts = join(artifacts, 'cvld-holder');
  await mkdir(holderArtifacts);
  const holderPreparation = await readFile(join(cvld, '.ci/prepare-holder.sh'), 'utf8');
  assert(holderPreparation.includes('anoncreds_revision=' + sources.anoncreds.revision), 'Reviewed AnonCreds source pin required');
  const holderLocks = await Promise.all(['holder', 'holder-bindgen'].map(async name => {
    const file = join(cvld, 'native', name, 'Cargo.lock');
    return { name, file, digest: await retainLock('cvld-' + name + '-Cargo.lock', file) };
  }));
  await run('cvld-holder-build', 'bash', ['.ci/prepare-holder.sh'], cvld,
    { ...process.env, ARTIFACT_ROOT: holderArtifacts, RESOLVE_DEPENDENCIES: '0' }, 1_500_000);
  for (const lock of holderLocks) assert.equal(sha256(await readFile(lock.file)), lock.digest, 'Retained ' + lock.name + ' lock must remain unchanged');
  evidence.privateHolderBuilt = true;
  await pack('cvld', cvld, sources.cvld.revision);
  for (const file of ['cvld_holder.js', 'cvld_holder.d.ts', 'cvld_holder_bg.wasm', 'cvld_holder_bg.wasm.d.ts']) {
    assert.equal(sha256(await readFile(join(vendor, 'cvld/generated/holder', file))),
      sha256(await readFile(join(cvld, 'generated/holder', file))), 'Packed holder asset must equal generated asset');
  }
  await retainLock('cvld-package-lock.json', join(cvld, 'package-lock.json'));
  await writeFile(join(work, 'paths.json'), JSON.stringify({ cvld, voucherBinary }, null, 2) + '\n');
  evidence.ok = true;
} catch (error) { evidence.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  await writeFile(join(artifacts, 'source-preparation.json'), JSON.stringify(evidence, null, 2) + '\n');
  await writeFile(join(packageDir, 'SHA256SUMS'), evidence.packages.map(pack => pack.sha256 + '  ' + pack.archive).join('\n') + '\n');
}
process.stdout.write(JSON.stringify({ ok: evidence.ok, evidence: join(artifacts, 'source-preparation.json'), error: evidence.error }) + '\n');
