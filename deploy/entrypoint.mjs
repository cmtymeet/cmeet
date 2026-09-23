import { chown, chmod, mkdir, open, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';

const inputRoot = process.env.CMEET_CONFIG_BUNDLE ?? '/run/secrets/cmeet';
const outputRoot = '/run/cmeet';
const configPath = `${outputRoot}/cmeet.json`;
const nativeConfigPath = `${outputRoot}/native.json`;
const MAX_FILE_BYTES = 64 * 1024 * 1024;

function reject(message) { throw new Error(`cmeet config bundle rejected: ${message}`); }
function assert(condition, message) { if (!condition) reject(message); }
function relativeSafe(value) {
  assert(value && !value.includes('\0') && !value.startsWith('/') && !value.split('/').includes('..'), 'path escape');
  return value;
}
async function copyBundle(source, destination, root = '', mountedRoot = source) {
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    relativeSafe(entry.name);
    const rel = root ? `${root}/${entry.name}` : entry.name;
    const sourcePath = join(source, entry.name), destinationPath = join(destination, rel);
    if (entry.isSymbolicLink()) {
      const target = await realpath(sourcePath).catch(() => null);
      assert(target && target.startsWith(mountedRoot + sep) && target !== mountedRoot, `bundle link ${rel} escapes mounted root`);
      const targetInfo = await stat(target).catch(() => null);
      if (targetInfo?.isDirectory()) {
        assert(entry.name.startsWith('..'), `directory symlink ${rel}`);
        continue;
      }
      assert(targetInfo?.isFile(), `bundle link ${rel} is not a regular file`);
      await copyFileFromMountedRoot(sourcePath, mountedRoot, destinationPath, rel);
      continue;
    }
    if (entry.isDirectory()) {
      await mkdir(destinationPath, { recursive: true, mode: 0o700 });
      await copyBundle(sourcePath, destination, rel, mountedRoot);
      continue;
    }
    if (!entry.isFile()) reject(`non-file ${rel}`);
    await copyFileFromMountedRoot(sourcePath, mountedRoot, destinationPath, rel);
  }
}
async function copyFileFromMountedRoot(sourcePath, sourceRoot, destinationPath, label) {
  const file = await open(sourcePath, 'r');
  try {
    const target = await realpath(`/proc/self/fd/${file.fd}`).catch(() => null);
    assert(target && target.startsWith(sourceRoot + sep), `${label} resolves outside mounted root`);
    const info = await file.stat();
    assert(info.isFile() && info.size <= MAX_FILE_BYTES, `${label} is not a bounded regular file`);
    const chunks = [];
    let total = 0;
    const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, MAX_FILE_BYTES));
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      assert(total <= MAX_FILE_BYTES, `${label} exceeds bundle bound`);
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    await mkdir(join(destinationPath, '..'), { recursive: true, mode: 0o700 });
    await writeFile(destinationPath, Buffer.concat(chunks, total), { flag: 'wx', mode: 0o600 });
    await chmod(destinationPath, 0o600);
  } finally { await file.close(); }
}
function json(bytes, name) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { reject(`${name} is not valid JSON`); }
}
async function readJson(path, name) {
  const info = await stat(path).catch(() => null);
  assert(info?.isFile() && info.size <= 1_048_576, `${name} missing or too large`);
  return json(await readFile(path), name);
}
function exactPath(value, expected, label) { assert(value === expected, `${label} must be ${expected}`); }
async function nodeIdentity() {
  const passwd = await readFile('/etc/passwd', 'utf8');
  const line = passwd.split('\n').find(value => value.startsWith('node:'));
  assert(line, 'image node user missing');
  const fields = line.split(':');
  const uid = Number(fields[2]), gid = Number(fields[3]);
  assert(Number.isSafeInteger(uid) && uid > 0 && Number.isSafeInteger(gid) && gid > 0, 'image node identity invalid');
  return { uid, gid };
}
async function chownTree(path, uid, gid) {
  const info = await stat(path);
  await chown(path, uid, gid);
  if (!info.isDirectory()) return;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'copied bundle contains symbolic link');
    await chownTree(join(path, entry.name), uid, gid);
  }
}

async function main() {
  assert(process.argv.length === 2, 'no command overrides are accepted');
  assert(typeof inputRoot === 'string' && /^\/run\/secrets\/[A-Za-z0-9._-]+$/.test(inputRoot), 'mounted bundle path must be under /run/secrets');
  const source = await realpath(inputRoot).catch(() => null);
  assert(source && source.startsWith('/run/secrets/') && source !== '/run/secrets' && source !== outputRoot, 'bundle directory missing');
  assert((await stat(source)).isDirectory(), 'bundle must be a directory');

  await mkdir(outputRoot, { recursive: false, mode: 0o700 });
  await copyBundle(source, outputRoot);
  await chmod(outputRoot, 0o700);
  const config = await readJson(configPath, 'cmeet.json');
  exactPath(config?.http?.distDir, '/app/dist', 'static asset path');
  if (config.serviceMode !== 'setup') {
    const native = await readJson(nativeConfigPath, 'native.json');
    exactPath(config?.backend?.binaryPath, '/app/bin/cmeet-cfrm-backend', 'backend binary path');
    exactPath(config?.backend?.configPath, nativeConfigPath, 'backend config path');
    exactPath(config?.voucherBridge?.executable, '/app/bin/cvld-voucher-bridge', 'voucher bridge path');
    assert(native?.storage?.driver === 'turso', 'native durable storage must be Turso');
    assert(config?.storage?.driver === 'turso', 'website durable storage must be Turso');
  }

  const identity = await nodeIdentity();
  if (process.getuid?.() === 0) {
    await chownTree(outputRoot, identity.uid, identity.gid);
    if (typeof process.setgroups !== 'function') reject('supplemental group control unavailable');
    process.setgroups([identity.gid]);
    process.setgid(identity.gid);
    process.setuid(identity.uid);
  } else {
    assert(process.getuid?.() === identity.uid, 'entrypoint must run as root or node');
  }
  process.argv = [process.argv[0], '/app/server/start.mjs', '--config', configPath];
  await import('file:///app/server/start.mjs');
}

try { await main(); }
catch (error) {
  process.stderr.write('cmeet startup rejected; check the mounted config bundle\n');
  process.exitCode = 1;
}
