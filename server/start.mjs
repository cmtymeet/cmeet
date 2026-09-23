import { fileURLToPath } from 'node:url';
import { jsonFile } from './config-files.mjs';
import { resolveWebsiteAddress } from './domains.mjs';

/** Setup is explicit operator configuration, never a fallback for broken live
 * configuration. It serves no member functionality and cannot enroll an admin. */
export async function startCmeet(configFile) {
  const input = await jsonFile(configFile, true);
  const config = { ...input, ...resolveWebsiteAddress(input) };
  if (config.serviceMode === 'setup') {
    return (await import('./setup.mjs')).startSetup(config);
  }
  if (config.serviceMode !== undefined && config.serviceMode !== 'community') {
    throw new Error('Unknown service mode');
  }
  return (await import('./community.mjs')).startCommunity(config);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--config') throw new Error('Configuration required');
    const application = await startCmeet(process.argv[3]);
    application.onFailure(() => {
      process.exitCode = 1;
      process.stderr.write('cmeet durable backend retired; supervisor restart required\n');
      void application.close();
    });
    let closing = false;
    const stop = async () => { if (closing) return; closing = true; await application.close(); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    process.stdout.write(application.mode === 'setup' ? 'cmeet setup page ready\n' : 'cmeet ready\n');
  } catch {
    process.stderr.write('cmeet startup rejected; check the configured files and backend readiness\n');
    process.exitCode = 1;
  }
}
