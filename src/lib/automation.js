const JSON_HEADERS = Object.freeze({ accept: 'application/json', 'content-type': 'application/json' });
const MAX_RESPONSE_BYTES = 128 * 1024;

// Public configuration must explicitly expose the allowed API scopes and
// expiry choices. This client deliberately has no policy defaults.

function safeFailure(status = 0) {
  const error = new Error(status === 401 ? 'Sign in is required.' : status === 403 ? 'This request was not accepted.' : 'Automation settings could not be updated.');
  error.safeMessage = true;
  return error;
}

function boundedPolicy(config) {
  const policy = config?.apiKeys;
  if (!policy || typeof policy !== 'object' || !Array.isArray(policy.allowedScopes) ||
      !Array.isArray(policy.expirySeconds) || policy.allowedScopes.length < 1 || policy.expirySeconds.length < 1 ||
      policy.allowedScopes.some(scope => typeof scope !== 'string' || !/^[a-z][a-z0-9:._-]{0,63}$/.test(scope)) ||
      new Set(policy.allowedScopes).size !== policy.allowedScopes.length ||
      policy.expirySeconds.some(value => !Number.isSafeInteger(value) || value < 1)) throw safeFailure();
  return Object.freeze({
    scopes: Object.freeze([...new Set(policy.allowedScopes)]),
    expirySeconds: Object.freeze([...new Set(policy.expirySeconds)].sort((a, b) => a - b)),
    mcpEndpoint: typeof config.mcpEndpoint === 'string' && config.mcpEndpoint.startsWith('/') && !config.mcpEndpoint.startsWith('//') ? config.mcpEndpoint : null,
    mcpCapabilities: Array.isArray(config.mcpCapabilities) && config.mcpCapabilities.length <= 128 ? config.mcpCapabilities.map(capability => {
      if (!capability || typeof capability !== 'object' || typeof capability.name !== 'string' || capability.name.length < 1 || capability.name.length > 120) throw safeFailure();
      return Object.freeze({ name: capability.name, description: typeof capability.description === 'string' ? capability.description.slice(0, 240) : '' });
    }) : []
  });
}

async function readJson(response) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) throw safeFailure();
  const reader = response.body?.getReader();
  if (!reader) throw safeFailure(response.status);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw safeFailure();
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error?.safeMessage ? error : safeFailure(response.status);
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return bytes.length ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) : null; }
  catch { throw safeFailure(response.status); }
}

export function createAutomationApi({ fetchImpl = globalThis.fetch, configPath = '/api/config' } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Automation fetch is required');
  if (typeof configPath !== 'string' || !configPath.startsWith('/') || configPath.startsWith('//')) throw new TypeError('Automation config path is invalid');
  let configPromise;

  async function request(path, { method = 'GET', body } = {}) {
    let response;
    let encoded;
    if (body !== undefined) {
      try { encoded = JSON.stringify(body); } catch { throw safeFailure(); }
      if (new TextEncoder().encode(encoded).byteLength > MAX_RESPONSE_BYTES) throw safeFailure();
    }
    try {
      response = await fetchImpl(path, {
        method, credentials: 'include', redirect: 'error', headers: JSON_HEADERS,
        ...(encoded === undefined ? {} : { body: encoded })
      });
    } catch { throw safeFailure(); }
    const parsed = await readJson(response);
    if (!response.ok) throw safeFailure(response.status);
    return parsed;
  }

  async function config() {
    configPromise ??= request(configPath);
    try { return await configPromise; }
    catch (error) { configPromise = undefined; throw error; }
  }

  return Object.freeze({
    async policy() { return boundedPolicy(await config()); },
    async list() {
      const result = await request('/auth/api-keys');
      if (!Array.isArray(result) || result.some(key => !key || typeof key !== 'object' || typeof key.id !== 'string' || typeof key.label !== 'string' || !Array.isArray(key.scopes) || !Number.isSafeInteger(key.expiresAt))) throw safeFailure();
      return result;
    },
    async create({ name, scopes, expiresAt }) {
      const result = await request('/auth/api-keys', { method: 'POST', body: { name, scopes, expiresAt } });
      if (!result || typeof result !== 'object' || typeof result.token !== 'string' || typeof result.id !== 'string') throw safeFailure();
      return result;
    },
    async revoke(id) { return await request('/auth/api-keys/revoke', { method: 'POST', body: { id } }); },
    async mcp() { return boundedPolicy(await config()); }
  });
}
