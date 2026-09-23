import { realpath } from 'node:fs/promises';
import { createCmeetServer } from './app.mjs';
import { json } from './api.mjs';
import { absolute, positive } from './config-files.mjs';

/** Public deployment state only. There is no bootstrap token, account creation,
 * administrator claim, policy default, or fallback storage in this mode. */
export async function startSetup(config) {
  if (config.serviceMode !== 'setup' || typeof config.communityName !== 'string'
      || !config.communityName.trim() || config.communityName.length > 120) {
    throw new Error('Explicit setup configuration required');
  }
  const port = positive(config.http?.port);
  if (port > 65535 || !['127.0.0.1', '0.0.0.0', '::1', '::'].includes(config.http.bindAddress)) {
    throw new Error('Explicit listen address required');
  }
  const publicConfig = Object.freeze({ status: 'setup-required', communityName: config.communityName,
    ...(config.domains ? { domains: config.domains } : {}) });
  const unavailable = () => json(503, { error: 'setup_required' });
  const api = {
    handle(request) {
      if (new URL(request.url).pathname === '/api/config' && request.method === 'GET') {
        return json(200, publicConfig);
      }
      return unavailable();
    },
  };
  const server = await createCmeetServer({ api, mcp: { handle: unavailable }, origin: config.origin,
    distDir: await realpath(absolute(config.http.distDir)), limits: config.http.limits,
    torGatewayOrigins: [], health: () => true });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, config.http.bindAddress, () => { server.off('error', reject); resolve(); });
  });
  let closing;
  return Object.freeze({ mode: 'setup', server,
    get healthy() { return server.listening && !closing; },
    onFailure(listener) {
      if (typeof listener !== 'function') throw new TypeError('Failure listener required');
      server.on('error', listener);
      return () => server.off('error', listener);
    },
    close() {
      closing ??= new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      return closing;
    },
  });
}
