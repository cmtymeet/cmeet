// CI-only image check; run under an external timeout with networking disabled.
// All keys and the voucher policy are ephemeral synthetic test configuration.
// Exercises native issuer creation/restoration, not Turso, Northflank, Tor,
// voucher redemption, credential issuance, or full server startup. RSS measures
// this process only and is not a production service capacity measurement.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = '/app';
const nativePackage = `${root}/node_modules/@hyperledger/anoncreds-nodejs`;
const koffiPackage = `${root}/node_modules/koffi`;
const nativeFiles = [
  ['community-backend', `${root}/bin/cmeet-cfrm-backend`],
  ['voucher-bridge', `${root}/bin/cvld-voucher-bridge`],
  ['anoncreds', `${nativePackage}/native/libanoncreds.so`],
  ['koffi', `${koffiPackage}/build/koffi/linux_x64/koffi.node`],
];
const began = performance.now();
const report = { version: 1, ok: false, stage: 'environment', checks: 0,
  scope: 'Isolated production-image native dependency and real ephemeral issuer restoration smoke; synthetic voucher policy; no issuance, deployment, database, Tor or server-start claim',
  node: process.version, platform: process.platform, arch: process.arch, libraries: [] };
const check = (condition) => { if (!condition) throw new Error('Runtime smoke check failed'); report.checks++; };
const memory = () => {
  const value = process.memoryUsage();
  return { rssBytes: value.rss, peakRssBytes: process.resourceUsage().maxRSS * 1024,
    heapUsedBytes: value.heapUsed, externalBytes: value.external, arrayBuffersBytes: value.arrayBuffers };
};
report.memoryBefore = memory();
let wrappingKey, wrongKey;
try {
  check(process.env.CI === 'true' && process.platform === 'linux' && process.arch === 'x64'
    && process.versions.node.split('.')[0] === '24');
  check(typeof process.getuid === 'function' && process.getuid() === 1000);
  report.uid = process.getuid();
  check(!process.env.LIB_ANONCREDS_PATH);
  report.stage = 'runtime-files-readable';
  for (const file of [`${root}/server/start.mjs`, `${root}/dist/accounting/manifest.json`]) {
    const info = await lstat(file);
    check(info.isFile() && info.size > 0);
    await access(file, constants.R_OK);
    report.checks++;
  }
  report.stage = 'ldd-required';
  let ldd;
  for (const candidate of ['/usr/bin/ldd', '/bin/ldd']) {
    if (await access(candidate, constants.X_OK).then(() => true, () => false)) { ldd = candidate; break; }
  }
  report.lddAvailable = Boolean(ldd);
  check(report.lddAvailable);
  for (const [name, file] of nativeFiles) {
    report.stage = `native-file:${name}`;
    const info = await lstat(file);
    check(info.isFile() && info.size > 0);
    report.stage = `native-linkage:${name}`;
    const result = spawnSync(ldd, [file], { encoding: 'utf8', timeout: 10_000,
      killSignal: 'SIGKILL', maxBuffer: 65_536,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const library = { name, exitStatus: result.status, signal: result.signal,
      missingLibrary: /not found/i.test(output), timedOut: result.error?.code === 'ETIMEDOUT' };
    report.libraries.push(library);
    check(!result.error && result.signal === null);
    check(!library.missingLibrary);
    // glibc ldd returns 1 for a valid static executable; all other nonzero
    // statuses fail. The shared library/addon must always be dynamically linked.
    const staticExecutable = (name === 'community-backend' || name === 'voucher-bridge')
      && /(?:not a dynamic executable|statically linked)/.test(output);
    check(result.status === 0 || (result.status === 1 && staticExecutable));
    library.linkage = staticExecutable ? 'static' : 'dynamic';
  }

  report.stage = 'installed-package-import';
  const require = createRequire(`${root}/package.json`);
  check(require.resolve('@hyperledger/anoncreds-nodejs/package.json') === `${nativePackage}/package.json`);
  check(require.resolve('koffi/package.json') === `${koffiPackage}/package.json`);
  const { createIssuer, restoreIssuer, createMemoryReceiptStore } = await import(
    pathToFileURL(require.resolve('@corbet-labs/cvld')).href);
  check([createIssuer, restoreIssuer, createMemoryReceiptStore].every(value => typeof value === 'function'));

  report.stage = 'native-issuer-create';
  const attester = generateKeyPairSync('ed25519');
  const clock = () => 1_800_000_000; // CI-only trusted time, not deployment policy.
  const issuer = createIssuer({ issuerId: 'https://runtime-smoke.invalid/cvld',
    communityId: 'runtime-smoke.invalid',
    policy: { version: 'synthetic-release-smoke', mode: 'any', factors: ['voucher'] },
    attesters: { voucher: { factor: 'voucher', publicKey: attester.publicKey.export({ format: 'pem', type: 'spki' }) } },
    receiptStore: createMemoryReceiptStore({ maxEntries: 2 }), maxCredentialLifetimeSeconds: 300, clock });
  const publicIssuer = issuer.public;
  check(publicIssuer.schema && publicIssuer.credentialDefinition && publicIssuer.keyCorrectnessProof);
  report.memoryAfterCreate = memory();

  report.stage = 'encrypted-issuer-export';
  wrappingKey = randomBytes(32);
  const encryptedState = await issuer.exportState({ wrappingKey });
  const serialized = JSON.stringify(encryptedState);
  check(serialized.length < 2 * 1024 * 1024 && typeof encryptedState.ciphertext === 'string'
    && !serialized.includes('credentialDefinitionPrivate'));

  report.stage = 'native-issuer-restore';
  const restored = await restoreIssuer({ encryptedState, wrappingKey, clock,
    receiptStore: createMemoryReceiptStore({ maxEntries: 2 }) });
  check(isDeepStrictEqual(restored.public, publicIssuer));
  report.stage = 'restored-native-offer';
  const offer = restored.offer();
  check(offer.schema_id === publicIssuer.schemaId && offer.cred_def_id === publicIssuer.credentialDefinitionId
    && typeof offer.nonce === 'string' && offer.nonce.length > 0);

  report.stage = 'wrong-wrapping-key-rejected';
  wrongKey = Buffer.from(wrappingKey); wrongKey[0] ^= 1;
  let rejected = false;
  try { await restoreIssuer({ encryptedState, wrappingKey: wrongKey, clock,
    receiptStore: createMemoryReceiptStore({ maxEntries: 2 }) }); }
  catch { rejected = true; }
  check(rejected);
  report.ok = true; report.stage = 'complete';
} catch {
  // Never serialize thrown assertions, native errors or their attached values:
  // they may contain ephemeral issuer material. The bounded stage identifies
  // which operation failed; native-linkage status is reported without output.
  report.error = 'Release runtime smoke failed at the recorded stage';
  process.exitCode = 1;
} finally {
  wrappingKey?.fill(0); wrongKey?.fill(0);
  report.elapsedMs = Math.round(performance.now() - began);
  report.memoryAfter = memory();
  process.stdout.write(JSON.stringify(report) + '\n');
}
