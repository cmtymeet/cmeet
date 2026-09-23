#!/usr/bin/env bash
# Public remote CI only. Does not publish an image or provision live resources.
set -euo pipefail
test "${CI:-}" = true
test -n "${ARTIFACT_ROOT:-}"
[[ "${REUSE_SOURCE_RUN:-}" =~ ^[0-9]+$ ]]
[[ "${REUSE_SOURCE_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
[[ "${CI_COMMIT_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
[[ "${EXPORT_IMAGE_ARCHIVE:-false}" =~ ^(true|false)$ ]]
[[ "${EXPORT_BUILD_BUNDLE:-false}" =~ ^(true|false)$ ]]
mkdir -p "$ARTIFACT_ROOT" .ci-work/image-prepared
image_tag="cmeet-runtime:${CI_COMMIT_SHA}"
container_name="cmeet-runtime-${CI_COMMIT_SHA}"
capture() {
  local status=$?
  trap - EXIT
  docker rm --force "$container_name" "cmeet-setup-${CI_COMMIT_SHA}" >/dev/null 2>&1 || true
  printf '%s\n' "$status" > "$ARTIFACT_ROOT/validation-status.txt"
  (cd "$ARTIFACT_ROOT" && find . -type f ! -path ./SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
  exit "$status"
}
trap capture EXIT
gh api "repos/cmtymeet/cmeet/actions/runs/$REUSE_SOURCE_RUN" > "$ARTIFACT_ROOT/package-run.json"
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const run = JSON.parse(await readFile(process.env.ARTIFACT_ROOT + '/package-run.json'));
assert.equal(run.head_sha, process.env.REUSE_SOURCE_SHA);
assert.equal(run.status, 'completed'); assert.equal(run.conclusion, 'success');
assert.equal(run.path, '.github/workflows/website.yml');
JS
prepared_directory="$(realpath .ci-work/image-prepared)"
ARTIFACT_ROOT="$prepared_directory" node .ci/reuse-sources.mjs 2>&1 | tee "$ARTIFACT_ROOT/source-reuse.log"
cp package-lock.json "$prepared_directory/package-lock.json"
timeout --kill-after=15 600 npm ci --ignore-scripts --no-audit --no-fund 2>&1 | tee "$ARTIFACT_ROOT/npm-install.log"
cmp package-lock.json "$prepared_directory/package-lock.json"
timeout --kill-after=15 180 npm run build 2>&1 | tee "$ARTIFACT_ROOT/build.log"
node .ci/assert-asset-closure.mjs dist

gh run download 35731679245 --repo cmtymeet/cfrm --name private-accounting-experiment --dir .ci-work/image-proof-evidence
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const archive = resolve('.ci-work/image-proof-evidence/ee566e01382dbf4abef3034663af099bc25f4e37/private-accounting-account-state-v2/browser-package.tar');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await readFile(archive)), 'aa8d7e773f2a34f760bf45809b083aa5654cce2f20d3df49bc664b734d409b78');
const proof = resolve('.ci-work/image-public-proofs'); await mkdir(proof);
// Extract this public-only allowlist; never copy the surrounding experiment.
const files = ['manifest.json', 'circuit.json', 'vk.bin', 'setup/g1.dat', 'setup/g2.dat',
  'barretenberg-threads.wasm', 'peer-reservation/circuit.json', 'peer-reservation/vk.bin'];
execFileSync('tar', ['--extract', '--file', archive, '--directory', proof,
  '--strip-components=1', '--no-same-owner', ...files.map(file => 'dist/' + file)], { timeout: 120000 });
assert.equal(hash(await readFile(join(proof, 'manifest.json'))), '1d7390c6f81a1560a6863be4cfe71f019f833fbbdf4124eb667faf93ea12fae7');
JS
timeout --kill-after=15 900 node deploy/stage-release.mjs \
  --prepared "$prepared_directory" --proof "$(realpath .ci-work/image-public-proofs)" \
  --repo "$PWD" --output "$PWD/deploy/stage" 2>&1 | tee "$ARTIFACT_ROOT/staging.log"
cp deploy/stage/release-manifest.json deploy/stage/native-installer.json \
  deploy/stage/source-preparation.json deploy/stage/source-reuse.json "$ARTIFACT_ROOT/"

timeout --kill-after=15 300 docker pull node:24-trixie-slim 2>&1 | tee "$ARTIFACT_ROOT/base-pull.log"
docker image inspect node:24-trixie-slim > "$ARTIFACT_ROOT/base-image.json"
base_digest="$(docker image inspect node:24-trixie-slim --format '{{index .RepoDigests 0}}')"
[[ "$base_digest" =~ ^node@sha256:[0-9a-f]{64}$ ]]
timeout --kill-after=15 300 docker build --network none --build-arg "NODE_IMAGE=$base_digest" \
  --build-arg "SOURCE_REVISION=$CI_COMMIT_SHA" \
  --tag "$image_tag" --file Dockerfile . 2>&1 | tee "$ARTIFACT_ROOT/image-build.log"
docker image inspect "$image_tag" > "$ARTIFACT_ROOT/runtime-image.json"
timeout --kill-after=15 180 docker run --rm --name "$container_name" \
  --network none --read-only --user node --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=16777216 \
  --mount "type=bind,source=$PWD/deploy/runtime-smoke.mjs,target=/runtime-smoke.mjs,readonly" \
  --entrypoint node --env CI=true "$image_tag" /runtime-smoke.mjs \
  > "$ARTIFACT_ROOT/runtime-smoke.json" 2> "$ARTIFACT_ROOT/runtime-smoke.stderr.log"
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const result = JSON.parse(await readFile(process.env.ARTIFACT_ROOT + '/runtime-smoke.json'));
assert.equal(result.ok, true); assert.equal(result.stage, 'complete');
assert.equal(result.lddAvailable, true); assert.equal(result.libraries.length, 4);
JS
timeout --kill-after=15 90 node .ci/image-setup-smoke.mjs "$image_tag"

if [[ "${EXPORT_BUILD_BUNDLE:-false}" = true ]]; then
  timeout --kill-after=15 300 node .ci/image-bundle.mjs
fi

# Export only the exact image whose native smoke passed. The separate publisher
# gets no build command and verifies this archive and image ID before pushing.
if [[ "${EXPORT_IMAGE_ARCHIVE:-false}" = true ]]; then
  test -n "${IMAGE_ARCHIVE_DIR:-}"
  test -n "${GITHUB_OUTPUT:-}"
  mkdir "$IMAGE_ARCHIVE_DIR"
  timeout --kill-after=15 300 docker image save "$image_tag" | gzip -1 > "$IMAGE_ARCHIVE_DIR/image.tar.gz"
  node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
const [image] = JSON.parse(await readFile(process.env.ARTIFACT_ROOT + '/runtime-image.json'));
assert.match(image.Id, /^sha256:[0-9a-f]{64}$/);
assert.equal(image.Config.Labels['org.opencontainers.image.source'], 'https://github.com/cmtymeet/cmeet');
assert.equal(image.Config.Labels['org.opencontainers.image.revision'], process.env.CI_COMMIT_SHA);
const hash = createHash('sha256');
for await (const bytes of createReadStream(process.env.IMAGE_ARCHIVE_DIR + '/image.tar.gz')) hash.update(bytes);
const archiveSha256 = hash.digest('hex');
await writeFile(process.env.IMAGE_ARCHIVE_DIR + '/image-archive.json', JSON.stringify({
  format: 1, source: process.env.CI_COMMIT_SHA, imageId: image.Id,
  archiveSha256, originalTag: 'cmeet-runtime:' + process.env.CI_COMMIT_SHA,
}, null, 2) + '\n');
await appendFile(process.env.GITHUB_OUTPUT, `archive_sha256=${archiveSha256}\nimage_id=${image.Id}\n`);
JS
  (cd "$IMAGE_ARCHIVE_DIR" && sha256sum image.tar.gz image-archive.json > SHA256SUMS)
fi
