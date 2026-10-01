#!/usr/bin/env bash
# Verify and load an already checked image archive; never rebuild or publish it.
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
mkdir "$ARTIFACT_ROOT"
capture() {
  local status=$?
  trap - EXIT
  printf '%s\n' "$status" > "$ARTIFACT_ROOT/verification-status.txt"
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
printf '%s\n' "Verified image $loaded_id from $EXPECTED_ARCHIVE_SHA"
