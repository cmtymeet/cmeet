#!/usr/bin/env bash
set -euo pipefail
test "${CI:-}" = true
test -n "${ARTIFACT_ROOT:-}"
mkdir -p "$ARTIFACT_ROOT"
capture() {
  local status=$?
  trap - EXIT
  printf '%s\n' "$status" > "$ARTIFACT_ROOT/validation-status.txt"
  if test -f package-lock.json; then cp package-lock.json "$ARTIFACT_ROOT/package-lock.json"; fi
  (
    cd "$ARTIFACT_ROOT"
    find . -type f ! -path ./SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
  )
  exit "$status"
}
trap capture EXIT
node .ci/prepare-sources.mjs 2>&1 | tee "$ARTIFACT_ROOT/source-preparation.log"
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(packageJson.dependencies?.['tor-js'], 'file:vendor/tor-js',
  'Tor transport must use the reviewed vendored package');
const tor = JSON.parse(await readFile('vendor/tor-js/package.json', 'utf8'));
assert.equal(tor.name, 'tor-js');
assert.equal(tor.version, '0.4.1-cmsg-experiment.1d5217bea907');
JS
if ! test -f package-lock.json; then
  test "${RESOLVE_DEPENDENCIES:-0}" = 1
  timeout --kill-after=15 600 npm install --package-lock-only --ignore-scripts --no-audit --no-fund \
    2>&1 | tee "$ARTIFACT_ROOT/npm-resolution.log"
  date -u +%FT%TZ > "$ARTIFACT_ROOT/dependency-resolution-time.txt"
fi
test -f package-lock.json
cp package-lock.json "$ARTIFACT_ROOT/candidate-package-lock.json"
timeout --kill-after=15 600 npm ci --ignore-scripts --no-audit --no-fund \
  2>&1 | tee "$ARTIFACT_ROOT/npm-install.log"
cmp package-lock.json "$ARTIFACT_ROOT/candidate-package-lock.json"
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert.equal(lock.lockfileVersion, 3);
assert.equal(lock.packages?.['node_modules/tor-js']?.resolved, 'vendor/tor-js',
  'Tor transport must resolve from the reviewed vendor package');
JS
test -x "$ARTIFACT_ROOT/native/cvld-voucher-bridge"
export CVLD_VOUCHER_EXECUTABLE="$ARTIFACT_ROOT/native/cvld-voucher-bridge"
export PLAYWRIGHT_CHROMIUM_EXECUTABLE="${BROWSER_BIN:?Browser executable required}"
timeout --kill-after=15 180 npm run build 2>&1 | tee "$ARTIFACT_ROOT/build.log"
timeout --kill-after=15 120 npm run test:server 2>&1 | tee "$ARTIFACT_ROOT/server-tests.log"
timeout --kill-after=15 300 npm run test:browser 2>&1 | tee "$ARTIFACT_ROOT/browser.log"
tar --create --file "$ARTIFACT_ROOT/cmeet-dist.tar" dist
