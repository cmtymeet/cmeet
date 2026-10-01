import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyChangedFiles, revisionRange, decodePaths } from './web-impact.mjs';

const a = 'a'.repeat(40), b = 'b'.repeat(40);
test('frontend and shared source changes select frontend validation', () => {
  for (const file of ['apps/web/src/App.svelte', 'apps/web/package-lock.json', 'ui/src/index.ts', 'core/src/cmsg.ts', '.ci/assert-asset-closure.mjs']) {
    assert.deepEqual(classifyChangedFiles([file]), {web:true,cli:false});
  }
});
test('CLI, toy and policy changes retain all backend acceptance gates', () => {
  for (const file of ['apps/cli/src/main.rs','apps/cli/Cargo.lock','tests/toy/README.md','.ci/policy/check-source-coverage.py']) {
    assert.deepEqual(classifyChangedFiles([file]),{web:false,cli:true});
  }
});
test('routing infrastructure has its own validation; unknown scope is conservative', () => {
  for(const file of ['.github/workflows/web.yml','.github/workflows/ci.yml','.github/workflows/dependabot-auto-merge.yml','.ci/web-impact.mjs','.ci/web-impact.test.mjs']) {
    assert.deepEqual(classifyChangedFiles([file]), {web:true,cli:false});
  }
  for(const file of ['Cargo.lock','backend/new.rs','src/main.rs','.github/workflows/new.yml']) {
    assert.deepEqual(classifyChangedFiles([file]),{web:true,cli:true});
  }
  assert.deepEqual(classifyChangedFiles(['ui/a','apps/cli/a']),{web:true,cli:true});
  assert.deepEqual(classifyChangedFiles(['docs/product/user-stories.md','README.md']),{web:false,cli:false});
});
test('invalid classifications fail instead of manufacturing unrelated changes', () => {
  for(const input of [null,{},[''],[42]]) assert.throws(()=>classifyChangedFiles(input));
  assert.deepEqual(decodePaths(Buffer.from('ui/name\nwith newline.svelte\0core/space file.ts\0')),['ui/name\nwith newline.svelte','core/space file.ts']);
  assert.throws(()=>decodePaths(Buffer.from('ui/truncated')));
  assert.deepEqual(decodePaths(Buffer.alloc(0)),[]);
});
test('PR and push ranges use validated exact revisions; dispatch validates everything',()=>{
  assert.equal(revisionRange('pull_request',{pull_request:{base:{sha:a},head:{sha:b}}},''),`${a}...${b}`);
  assert.equal(revisionRange('push',{before:a},b),`${a}..${b}`);
  assert.equal(revisionRange('push',{before:'0'.repeat(40)},b),null);
  assert.equal(revisionRange('workflow_dispatch',{},''),null);
  for(const name of ['push','pull_request','unsupported']) assert.throws(()=>revisionRange(name,{},''));
  assert.throws(()=>revisionRange('pull_request',{pull_request:{base:{sha:'--help'},head:{sha:b}}},''));
});
test('CI retains real substantive commands and the blocked real toy scenario',()=>{
  const cli=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
  for(const text of ['cargo update','cargo fmt','cargo clippy','cargo test','cargo llvm-cov','check-first-party.py','test-source-coverage.py','check-source-coverage.py']) assert.ok(cli.includes(text),text);
  assert.ok(cli.includes('echo "::error::BLOCKED: the conjunctive real member/admin/root, Tor, groups and device-loss scenario is not implemented. See tests/toy/README.md."\n          exit 1'));
  for(const context of ['resolve','dependency-policy','check','coverage','toy']) assert.ok(cli.includes(`  ${context}:\n`));
  assert.ok(!cli.includes('|| true'));
  const web=readFileSync(new URL('../.github/workflows/web.yml',import.meta.url),'utf8');
  for(const command of ['npm run typecheck','npm run test:unit','npm run build','assert-asset-closure.mjs','npm run test:e2e','npm run test:production']) assert.ok(web.includes(command),command);
  for(const workflow of [cli,web]) {
    assert.ok(workflow.includes('if: always() && !cancelled()'));
    assert.ok(workflow.includes('Require successful applicability and prerequisite checks'));
    assert.ok(workflow.includes('No '));
    assert.ok(workflow.includes('tests or product acceptance claimed.'));
  }
});
