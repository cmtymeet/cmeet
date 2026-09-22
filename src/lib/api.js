/**
 * Small browser transport for cmeet's cookie-authenticated API.
 *
 * Route names are supplied by the application composition layer. Keeping them
 * out of this module prevents a UI bundle from silently choosing an auth or
 * profile endpoint for a community.
 */

const JSON_HEADERS = Object.freeze({
  accept: 'application/json',
  'content-type': 'application/json'
});

export class ApiError extends Error {
  constructor(message, { status = 0, category = 'network', body = null } = {}) {
    super(String(message).slice(0, 240));
    this.name = 'ApiError';
    this.status = status;
    this.category = category;
    this.body = body;
  }
}

function requirePath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > 512 || !path.startsWith('/') || path.startsWith('//') || /[\\\x00-\x20\x7f]/.test(path)) {
    throw new TypeError('API route must be a bounded absolute path');
  }
  return path;
}

function boundedError(body, status) {
  const category = typeof body?.category === 'string' ? body.category.slice(0, 80) : 'request';
  const message = typeof body?.error === 'string' ? body.error : `Request failed (${status})`;
  return new ApiError(message, { status, category, body: null });
}

async function readJson(response, maxResponseBytes) {
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError('Invalid API response', { status: response.status, category: 'response_format' });
  const chunks = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxResponseBytes) {
      await reader.cancel();
      throw new ApiError('Response too large', { status: response.status, category: 'response_limit' });
    }
    chunks.push(part.value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (buffer.byteLength === 0) return null;
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  } catch {
    throw new ApiError('Invalid API response', { status: response.status, category: 'response_format' });
  }
}

export function createApiClient({
  baseUrl = '',
  fetchImpl = globalThis.fetch,
  credentials = 'include',
  headers = {},
  maxResponseBytes = 512 * 1024,
  maxRequestBytes = 256 * 1024
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Cookie-authenticated fetch is required');
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024) throw new TypeError('Response limit is invalid');
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1024) throw new TypeError('Request limit is invalid');

  function urlFor(path) {
    requirePath(path);
    try {
      const base = new URL(baseUrl || globalThis.location?.origin || undefined);
      const target = new URL(path, base);
      if (target.origin !== base.origin) throw new Error('Origin rejected');
      return target.toString();
    } catch {
      throw new TypeError('API base URL is invalid');
    }
  }

  async function request(path, { method = 'GET', body, signal, headers: requestHeaders = {} } = {}) {
    const init = {
      method,
      credentials,
      signal,
      redirect: 'error',
      headers: { ...JSON_HEADERS, ...headers, ...requestHeaders }
    };
    if (body !== undefined) {
      const encodedBody = JSON.stringify(body);
      if (new TextEncoder().encode(encodedBody).byteLength > maxRequestBytes) throw new ApiError('Request too large', { category: 'request_limit' });
      init.body = encodedBody;
    }
    let response;
    try {
      response = await fetchImpl(urlFor(path), init);
    } catch {
      throw new ApiError('The community service is unavailable.', { category: 'network' });
    }
    const parsed = await readJson(response, maxResponseBytes);
    if (!response.ok) throw boundedError(parsed, response.status);
    return parsed;
  }

  return Object.freeze({ request });
}

/**
 * Adapt explicitly configured cvld routes to the controller's auth seam.
 * The server owns the route contract; this helper only moves JSON and cookies.
 */
export function createAuthApi({ api, routes }) {
  if (!api || typeof api.request !== 'function') throw new TypeError('API client is required');
  const configured = routes && typeof routes === 'object' ? routes : {};
  const route = (name) => requirePath(configured[name]);
  return Object.freeze({
    registerBegin: (payload) => api.request(route('registerBegin'), { method: 'POST', body: payload }),
    registerPrecommit: (payload) => api.request(route('registerPrecommit'), { method: 'POST', body: payload }),
    registerFinish: (payload) => api.request(route('registerFinish'), { method: 'POST', body: payload }),
    loginBegin: () => api.request(route('loginBegin'), { method: 'POST', body: {} }),
    loginFinish: (payload) => api.request(route('loginFinish'), { method: 'POST', body: payload }),
    rebindDevice: (payload) => api.request(route('rebindDevice'), { method: 'POST', body: payload }),
    session: async () => {
      try {
        return await api.request(route('session'));
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    logout: () => api.request(route('logout'), { method: 'POST', body: {} })
  });
}
