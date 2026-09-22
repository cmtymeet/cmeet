// Reuse only the exact native source/dependency closure and compiler. Browser
// or fixture-JS changes do not justify recompiling an unchanged verifier bridge.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
assert.equal(process.env.CI, 'true');
assert.match(process.env.REUSE_ACCOUNT_NATIVE_RUN ?? '', /^[0-9]+$/);
const command = (tool, args) => execFileSync(tool, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim();
const run = JSON.parse(command('gh', ['run', 'view', process.env.REUSE_ACCOUNT_NATIVE_RUN,
  '--repo', 'cmtymeet/cmeet', '--json', 'headSha']));
assert.match(run.headSha, /^[0-9a-f]{40}$/);
const prior = resolve('.ci-work/accounting-contract/native-reuse');
await mkdir(prior, { recursive: true });
command('gh', ['run', 'download', process.env.REUSE_ACCOUNT_NATIVE_RUN, '--repo', 'cmtymeet/cmeet',
  '--name', `accounting-contract-${run.headSha}`, '--dir', prior]);
const sums = await readFile(join(prior, 'SHA256SUMS'), 'utf8');
const digests = new Map(sums.trim().split('\n').map(line => {
  const match = /^([a-f0-9]{64})  \.\/(.+)$/.exec(line); assert(match);
  return [match[2], match[1]];
}));
for (const file of ['cmeet-accounting-contract', 'accounting-native-Cargo.lock', 'rust-version.txt']) {
  assert.equal(createHash('sha256').update(await readFile(join(prior, file))).digest('hex'), digests.get(file));
}
command('git', ['fetch', '--no-tags', '--depth=1', 'origin', run.headSha]);
const tree = revision => command('git', ['rev-parse', `${revision}:.ci/accounting-native`]);
assert.equal(tree(run.headSha), tree('HEAD'), 'Native fixture source/dependency closure changed');
assert.deepEqual(await readFile('.ci/accounting-native/Cargo.lock'), await readFile(join(prior, 'accounting-native-Cargo.lock')));
assert.equal(command('rustc', ['--version']), (await readFile(join(prior, 'rust-version.txt'), 'utf8')).trim());
const target = join(resolve(process.env.CARGO_TARGET_DIR), 'release');
await mkdir(target, { recursive: true });
await copyFile(join(prior, 'cmeet-accounting-contract'), join(target, 'cmeet-accounting-contract'));
await chmod(join(target, 'cmeet-accounting-contract'), 0o755);
await writeFile(join(process.env.ARTIFACT_ROOT, 'native-reuse.json'), JSON.stringify({
  source: process.env.CI_COMMIT_SHA, retainedSource: run.headSha, retainedRun: process.env.REUSE_ACCOUNT_NATIVE_RUN,
  nativeSourceTree: tree('HEAD'), binarySha256: digests.get('cmeet-accounting-contract'),
  compiler: command('rustc', ['--version']),
}, null, 2) + '\n');
