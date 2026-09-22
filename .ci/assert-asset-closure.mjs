// Build output validation only: a missing nested Worker must fail before a
// browser waits for that Worker's readiness handshake.
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function assertAssetClosure(directory) {
  const assets = join(directory, 'assets');
  for (const entry of await readdir(assets, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.js.map')) {
      await access(join(assets, entry.name.slice(0, -4))).catch(() => {
        throw new Error(`Build omitted generated JavaScript: ${entry.name.slice(0, -4)}`);
      });
    }
    if (!entry.name.endsWith('.js')) continue;
    const code = await readFile(join(assets, entry.name), 'utf8');
    for (const [path] of code.matchAll(/\/assets\/[A-Za-z0-9_.-]+\.(?:js|wasm|css)\b/g)) {
      await access(join(directory, path.slice(1))).catch(() => {
        throw new Error(`Build references missing asset: ${path}`);
      });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error('Build output directory required');
  await assertAssetClosure(process.argv[2]);
}
