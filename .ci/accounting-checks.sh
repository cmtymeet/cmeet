#!/usr/bin/env bash
# Separate manual real-proof lane; never part of the first website build.
set -euo pipefail
test "${CI:-}" = true
test -n "${ARTIFACT_ROOT:-}"
test -n "${CARGO_TARGET_DIR:-}"
[[ "${PACKAGE_RUN_ID:-}" =~ ^[0-9]+$ ]]
[[ "${PACKAGE_SOURCE_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
mkdir -p "$ARTIFACT_ROOT" .ci-work/accounting-contract
capture() {
  local status=$?
  trap - EXIT
  printf '%s\n' "$status" > "$ARTIFACT_ROOT/validation-status.txt"
  if test -f .ci/accounting-native/Cargo.lock; then cp .ci/accounting-native/Cargo.lock "$ARTIFACT_ROOT/accounting-native-Cargo.lock"; fi
  if test -f package-lock.json; then cp package-lock.json "$ARTIFACT_ROOT/package-lock.json"; fi
  (cd "$ARTIFACT_ROOT" && find . -type f ! -path ./SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
  exit "$status"
}
trap capture EXIT
gh run view "$PACKAGE_RUN_ID" --repo cmtymeet/cmeet --json headSha > "$ARTIFACT_ROOT/package-run.json"
gh run download "$PACKAGE_RUN_ID" --repo cmtymeet/cmeet --name "cmeet-$PACKAGE_SOURCE_SHA" --dir .ci-work/accounting-contract/packages
gh run download 35731679245 --repo cmtymeet/cfrm --name private-accounting-experiment --dir .ci-work/accounting-contract/proofs
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
const hash = value => createHash('sha256').update(value).digest('hex');
const work = resolve('.ci-work/accounting-contract'), artifacts = resolve(process.env.ARTIFACT_ROOT);
const prior = join(work, 'packages');
assert.equal(JSON.parse(await readFile(join(artifacts, 'package-run.json'))).headSha, process.env.PACKAGE_SOURCE_SHA);
const manifest = JSON.parse(await readFile(join(prior, 'source-preparation.json')));
assert.equal(manifest.ok, true); assert.equal(manifest.source, process.env.PACKAGE_SOURCE_SHA);
const sources = JSON.parse(await readFile('.ci/sources.json'));
for (const name of ['cfrm', 'cmsg', 'cvld']) assert.deepEqual(manifest.sources[name], sources[name], 'Exact prepared library source required');
const nativeManifest = await readFile('.ci/accounting-native/Cargo.toml', 'utf8');
for (const name of ['cfrm', 'cmsg']) assert(nativeManifest.split('\n').find(line => line.startsWith(name + ' ='))
  ?.includes('rev = "' + sources[name].revision + '"'), 'Native fixture and browser package source must match');
const names = { cfrm: 'cfrm', 'cfrm-browser': 'cfrm-browser', '@corbet-labs/cmsg': 'cmsg', '@corbet-labs/cvld': 'cvld', 'tor-js': 'tor-js' };
assert.equal(manifest.packages.length, Object.keys(names).length);
const seen = new Set();
await mkdir('vendor');
for (const record of manifest.packages) {
  const name = names[record.name]; assert(name && !seen.has(name)); seen.add(name);
  assert.equal(record.archive, basename(record.archive));
  const archive = join(prior, 'packages', record.archive), bytes = await readFile(archive);
  assert.equal(hash(bytes), record.sha256);
  assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), record.integrity);
  if (name === 'tor-js') assert.equal(record.sha256, 'b4de87950de0ffcf331efa5c1a3617c5bcc41c48d7706f547d975bf419f06f39');
  else assert.equal(record.source, sources[name.startsWith('cfrm') ? 'cfrm' : name].revision);
  const target = join('vendor', name); await mkdir(target);
  execFileSync('tar', ['--extract', '--file', archive, '--directory', target, '--strip-components=1', '--no-same-owner']);
  assert.equal(JSON.parse(await readFile(join(target, 'package.json'))).name, record.name);
}
const priorLock = await readFile(join(prior, 'package-lock.json'));
try { assert.deepEqual(await readFile('package-lock.json'), priorLock, 'Use the reviewed prepared dependency snapshot'); }
catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile('package-lock.json', priorLock); }
const proofRoot = join(work, 'proofs/ee566e01382dbf4abef3034663af099bc25f4e37/private-accounting-account-state-v2');
const archive = join(proofRoot, 'browser-package.tar');
assert.equal(hash(await readFile(archive)), 'aa8d7e773f2a34f760bf45809b083aa5654cce2f20d3df49bc664b734d409b78');
const runtime = join(work, 'runtime'); await mkdir(runtime);
const files = ['manifest.json', 'circuit.json', 'vk.bin', 'peer-reservation/circuit.json', 'peer-reservation/vk.bin',
  'setup/g1.dat', 'setup/g2.dat', 'barretenberg-threads.wasm'];
execFileSync('tar', ['--extract', '--file', archive, '--directory', runtime, '--strip-components=1', '--no-same-owner', ...files.map(file => 'dist/' + file)]);
const pin = '1d7390c6f81a1560a6863be4cfe71f019f833fbbdf4124eb667faf93ea12fae7';
const manifestBytes = await readFile(join(runtime, 'manifest.json')); assert.equal(hash(manifestBytes), pin);
const proofManifest = JSON.parse(manifestBytes);
const expected = { 'circuit.json': proofManifest.circuitSha256, 'vk.bin': proofManifest.vkSha256,
  'peer-reservation/circuit.json': proofManifest.peerReservation.circuitSha256,
  'peer-reservation/vk.bin': proofManifest.peerReservation.vkSha256,
  ...Object.fromEntries(proofManifest.setup.map(value => ['setup/' + value.name, value.sha256])),
  ...Object.fromEntries(proofManifest.wasm.map(value => [value.name, value.sha256])) };
for (const [file, digest] of Object.entries(expected)) assert.equal(hash(await readFile(join(runtime, file))), digest);
await copyFile(join(runtime, 'manifest.json'), join(artifacts, 'runtime-manifest.json'));
await writeFile(join(artifacts, 'prepared-inputs.json'), JSON.stringify({ source: process.env.CI_COMMIT_SHA,
  packageSource: process.env.PACKAGE_SOURCE_SHA, sources, packages: manifest.packages, runtimeManifestSha256: pin, artifactSha256: expected }, null, 2) + '\n');
JS
npm ci --ignore-scripts --no-audit --no-fund 2>&1 | tee "$ARTIFACT_ROOT/npm-install.log"
if ! test -f .ci/accounting-native/Cargo.lock; then
  test "${RESOLVE_DEPENDENCIES:-0}" = 1
  cargo generate-lockfile --manifest-path .ci/accounting-native/Cargo.toml 2>&1 | tee "$ARTIFACT_ROOT/native-resolution.log"
fi
cp .ci/accounting-native/Cargo.lock "$ARTIFACT_ROOT/accounting-native-Cargo.lock"
cargo fmt --manifest-path .ci/accounting-native/Cargo.toml -- --check
cargo build --locked --release --manifest-path .ci/accounting-native/Cargo.toml 2>&1 | tee "$ARTIFACT_ROOT/native-build.log"
cmp .ci/accounting-native/Cargo.lock "$ARTIFACT_ROOT/accounting-native-Cargo.lock"
export ACCOUNT_CONTRACT_NATIVE="$CARGO_TARGET_DIR/release/cmeet-accounting-contract"
export ACCOUNT_ARTIFACT_DIRECTORY="$(realpath .ci-work/accounting-contract/runtime)"
export PLAYWRIGHT_CHROMIUM_EXECUTABLE="${BROWSER_BIN:?}"
rustc --version > "$ARTIFACT_ROOT/rust-version.txt"
timeout --kill-after=15 2400 node .ci/accounting-browser.mjs 2>&1 | tee "$ARTIFACT_ROOT/accounting-browser.log"
