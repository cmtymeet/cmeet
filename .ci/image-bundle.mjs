// CI-only public build context. Inputs are the already validated release stage.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { copyFile, cp, lstat, mkdir, readFile, readdir, readlink, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function digestFile(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function regular(path) { assert.ok((await lstat(path)).isFile(), `Regular file required: ${path}`); }
assert.equal(process.env.CI, 'true');
const source = process.env.CI_COMMIT_SHA;
assert.match(source ?? '', /^[0-9a-f]{40}$/);
const output = process.env.BUILD_BUNDLE_DIR, artifacts = process.env.ARTIFACT_ROOT;
assert.ok(output && isAbsolute(output) && artifacts && isAbsolute(artifacts));
const repo = await realpath(process.cwd()), stage = join(repo, 'deploy/stage');
const release = await json(join(stage, 'release-manifest.json'));
assert.equal(release.source, source);
const smoke = await json(join(artifacts, 'runtime-smoke.json'));
assert.equal(smoke.ok, true); assert.equal(smoke.stage, 'complete');
assert.equal(smoke.uid, 1000); assert.equal(smoke.lddAvailable, true);
const setup = await json(join(artifacts, 'setup-smoke.json'));
assert.equal(setup.ok, true); assert.equal(setup.uid, 1000); assert.equal(setup.strictHost, true);
const [image] = await json(join(artifacts, 'runtime-image.json'));
assert.match(image.Id, /^sha256:[0-9a-f]{64}$/);
assert.equal(image.Config.Labels['org.opencontainers.image.revision'], source);
const [base] = await json(join(artifacts, 'base-image.json'));
const baseImage = base.RepoDigests[0];
assert.match(baseImage, /^node@sha256:[0-9a-f]{64}$/);
await mkdir(output);
const context = join(repo, '.ci-work/image-bundle-context');
await mkdir(context);
await mkdir(join(context, 'deploy'));
await cp(stage, join(context, 'deploy/stage'), { recursive: true, verbatimSymlinks: true });
const scripts = ['deploy/entrypoint.mjs', 'deploy/validate-release.mjs', 'deploy/validate-accounting-assets.mjs'];
for (const path of ['.dockerignore', ...scripts]) {
  await regular(join(repo, path)); await copyFile(join(repo, path), join(context, path));
}
await regular(join(repo, 'Dockerfile'));
const originalDockerfile = await readFile(join(repo, 'Dockerfile'), 'utf8');
assert.equal(originalDockerfile.match(/^ARG NODE_IMAGE=.*$/gm)?.length, 1);
assert.equal(originalDockerfile.match(/^ARG SOURCE_REVISION(?:=.*)?$/gm)?.length, 1);
const dockerfile = originalDockerfile.replace(/^ARG NODE_IMAGE=.*$/m, `ARG NODE_IMAGE=${baseImage}`)
  .replace(/^ARG SOURCE_REVISION(?:=.*)?$/m, `ARG SOURCE_REVISION=${source}`);
await writeFile(join(context, 'Dockerfile'), dockerfile, { mode: 0o644 });
// Recheck the copied runtime and its links, without dependency installation or
// native work. The external builder runs this same verifier in its first stage.
await execFile(process.execPath, [join(context, 'deploy/validate-release.mjs'), join(context, 'deploy/stage')],
  { timeout: 120_000, maxBuffer: 65_536 });
const files = [];
async function collect(relative) {
  const path = join(context, relative), info = await lstat(path);
  if (info.isDirectory()) {
    for (const entry of (await readdir(path)).sort()) await collect(`${relative}/${entry}`);
  } else if (info.isSymbolicLink()) {
    const target = await readlink(path), actual = await realpath(path);
    assert.ok(!isAbsolute(target) && actual.startsWith(context + sep), `Context link escapes: ${relative}`);
    files.push({ path: relative, type: 'symlink', target });
  } else {
    assert.ok(info.isFile(), `Unsupported context member: ${relative}`);
    files.push({ path: relative, sha256: await digestFile(path), bytes: info.size });
  }
}
for (const path of ['Dockerfile', '.dockerignore', 'deploy']) await collect(path);
const manifest = { format: 'cmeet.build-context.v1', source, baseImage, smokeTestedImageId: image.Id,
  originalDockerfileSha256: digest(originalDockerfile), bundledDockerfileSha256: digest(dockerfile),
  releaseManifestSha256: await digestFile(join(stage, 'release-manifest.json')),
  runtimeSmokeSha256: await digestFile(join(artifacts, 'runtime-smoke.json')),
  setupSmokeSha256: await digestFile(join(artifacts, 'setup-smoke.json')),
  scope: 'Pinned inputs from the smoke-tested image; an external Docker rebuild has its own image digest', files };
await writeFile(join(context, 'build-context.json'), JSON.stringify(manifest, null, 2) + '\n');
const archive = join(output, 'cmeet-build-context.tar.gz');
await execFile('tar', ['--create', '--gzip', '--file', archive, '--directory', context,
  '--sort=name', '--owner=0', '--group=0', '--numeric-owner', 'Dockerfile', '.dockerignore', 'deploy', 'build-context.json'],
  { timeout: 180_000, maxBuffer: 65_536 });
await copyFile(join(context, 'build-context.json'), join(output, 'build-context.json'));
for (const path of ['runtime-smoke.json', 'setup-smoke.json', 'runtime-image.json', 'base-image.json']) {
  await copyFile(join(artifacts, path), join(output, path));
}
const hashes = [];
for (const name of (await readdir(output)).sort()) hashes.push(`${await digestFile(join(output, name))}  ${name}`);
await writeFile(join(output, 'SHA256SUMS'), hashes.join('\n') + '\n');
console.log(JSON.stringify({ ok: true, source, baseImage, archive: 'cmeet-build-context.tar.gz',
  sha256: await digestFile(archive), contextFiles: files.length, smokeTestedImageId: image.Id }));
