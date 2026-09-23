#!/usr/bin/env bash
# Public remote CI only. Publish an already checked image; never rebuild it.
set -euo pipefail
test "${CI:-}" = true
test "${GITHUB_REPOSITORY:-}" = cmtymeet/cmeet
[[ "${CI_COMMIT_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
[[ "${EXPECTED_ARCHIVE_SHA:-}" =~ ^[0-9a-f]{64}$ ]]
[[ "${EXPECTED_IMAGE_ID:-}" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]]
[[ "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]]
test -n "${IMAGE_ARCHIVE_DIR:-}"
test -n "${IMAGE_EVIDENCE_DIR:-}"
test -n "${ARTIFACT_ROOT:-}"
test -n "${GHCR_TOKEN:-}"
test -n "${GITHUB_ACTOR:-}"
mkdir "$ARTIFACT_ROOT"
export DOCKER_CONFIG
DOCKER_CONFIG="$(mktemp -d)"
capture() {
  local status=$?
  trap - EXIT
  rm -rf "$DOCKER_CONFIG"
  printf '%s\n' "$status" > "$ARTIFACT_ROOT/publication-status.txt"
  (cd "$ARTIFACT_ROOT" && find . -type f ! -path ./SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
  exit "$status"
}
trap capture EXIT
(cd "$IMAGE_ARCHIVE_DIR" && sha256sum --check SHA256SUMS) > "$ARTIFACT_ROOT/archive-verification.log"
(cd "$IMAGE_EVIDENCE_DIR" && sha256sum --check SHA256SUMS) > "$ARTIFACT_ROOT/evidence-verification.log"
printf '%s  %s\n' "$EXPECTED_ARCHIVE_SHA" "$IMAGE_ARCHIVE_DIR/image.tar.gz" | sha256sum --check >> "$ARTIFACT_ROOT/archive-verification.log"
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const json = async path => JSON.parse(await readFile(path));
const archive = await json(process.env.IMAGE_ARCHIVE_DIR + '/image-archive.json');
assert.equal(archive.format, 1);
assert.equal(archive.source, process.env.CI_COMMIT_SHA);
assert.equal(archive.imageId, process.env.EXPECTED_IMAGE_ID);
assert.equal(archive.archiveSha256, process.env.EXPECTED_ARCHIVE_SHA);
assert.equal(archive.originalTag, 'cmeet-runtime:' + process.env.CI_COMMIT_SHA);
const evidence = process.env.IMAGE_EVIDENCE_DIR;
assert.equal((await readFile(evidence + '/validation-status.txt', 'utf8')).trim(), '0');
const smoke = await json(evidence + '/runtime-smoke.json');
assert.equal(smoke.ok, true); assert.equal(smoke.stage, 'complete');
assert.equal(smoke.uid, 1000); assert.equal(smoke.lddAvailable, true);
assert.equal(smoke.libraries.length, 4);
for (const library of smoke.libraries) {
  assert.equal(library.missingLibrary, false); assert.equal(library.timedOut, false);
}
const [image] = await json(evidence + '/runtime-image.json');
assert.equal(image.Id, process.env.EXPECTED_IMAGE_ID);
assert.equal(image.Os, 'linux'); assert.equal(image.Architecture, 'amd64');
assert.equal(image.Config.Labels['org.opencontainers.image.source'], 'https://github.com/cmtymeet/cmeet');
assert.equal(image.Config.Labels['org.opencontainers.image.revision'], process.env.CI_COMMIT_SHA);
assert.equal((await json(evidence + '/release-manifest.json')).source, process.env.CI_COMMIT_SHA);
JS
timeout --kill-after=15 300 docker image load --input "$IMAGE_ARCHIVE_DIR/image.tar.gz" > "$ARTIFACT_ROOT/image-load.log"
loaded_id="$(docker image inspect "cmeet-runtime:$CI_COMMIT_SHA" --format '{{.Id}}')"
test "$loaded_id" = "$EXPECTED_IMAGE_ID"
# Include the run identity because the same source can select a newer base
# image later. Deployments consume the resulting digest, never a mutable tag.
registry_tag="ghcr.io/cmtymeet/cmeet:${CI_COMMIT_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
docker image tag "$loaded_id" "$registry_tag"
printf '%s' "$GHCR_TOKEN" | timeout --kill-after=5 60 docker login ghcr.io --username "$GITHUB_ACTOR" --password-stdin > "$ARTIFACT_ROOT/registry-login.log" 2>&1
unset GHCR_TOKEN
timeout --kill-after=15 600 docker image push "$registry_tag" 2>&1 | tee "$ARTIFACT_ROOT/image-push.log"
docker image inspect "$registry_tag" > "$ARTIFACT_ROOT/published-image.json"
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
const root = process.env.ARTIFACT_ROOT;
const [image] = JSON.parse(await readFile(root + '/published-image.json'));
assert.equal(image.Id, process.env.EXPECTED_IMAGE_ID);
const digests = image.RepoDigests.filter(value => /^ghcr\.io\/cmtymeet\/cmeet@sha256:[0-9a-f]{64}$/.test(value));
assert.equal(digests.length, 1);
const publication = { format: 1, source: process.env.CI_COMMIT_SHA,
  runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  imageId: image.Id, archiveSha256: process.env.EXPECTED_ARCHIVE_SHA,
  image: digests[0], tag: `ghcr.io/cmtymeet/cmeet:${process.env.CI_COMMIT_SHA}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}` };
await writeFile(root + '/publication.json', JSON.stringify(publication, null, 2) + '\n');
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
  `Published checked image: \`${publication.image}\`\n\nPackage visibility is managed separately; publication does not imply anonymous pull access.\n`);
console.log(JSON.stringify(publication));
JS
