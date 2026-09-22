// The website and MCP call this one operation boundary. Authentication comes
// from cvld; every submitted cfrm authority/proof is still verified by cfrm.
export const OPERATIONS = Object.freeze({
  discovery_query: { scope: 'discovery:read', path: '/v1/discovery/query', backend: 'discovery', kind: 'query', readOnly: true },
  profile_fetch: { scope: 'discovery:read', path: '/v1/profiles/fetch', backend: 'discovery', kind: 'fetch', readOnly: true },
  presence_directory: { scope: 'discovery:read', path: '/v1/presence', backend: 'presenceDirectory', kind: 'query', readOnly: true },
  profile_publish: { scope: 'profile:write', path: '/v1/profiles/publish', backend: 'discovery', kind: 'publish', readOnly: false },
  discovery_heartbeat: { scope: 'profile:write', path: '/v1/discovery/heartbeat', backend: 'discovery', kind: 'heartbeat', readOnly: false },
  discovery_disconnect: { scope: 'profile:write', path: '/v1/discovery/disconnect', backend: 'discovery', kind: 'disconnect', readOnly: false },
  presence_apply: { scope: 'profile:write', path: '/v1/presence/apply', backend: 'presence', readOnly: false },
  presence_lookup: { scope: 'discovery:read', path: '/v1/presence/lookup', backend: 'presenceLookup', readOnly: true },
  account_enroll: { scope: 'account:write', path: '/v1/account/enrollment', backend: 'enrollment', kind: 'enroll', readOnly: false },
  account_enrollment: { scope: 'account:read', path: '/v1/account/enrollment', backend: 'enrollment', kind: 'current', readOnly: true },
  profile_key_ticket: { scope: 'profiles:read', path: '/v1/profile-keys/issue', backend: 'keyIssue', readOnly: false },
  account_status: { scope: 'account:read', path: '/v1/account/status', backend: 'account', kind: 'status', readOnly: true },
  account_apply: { scope: 'account:write', path: '/v1/account/apply', backend: 'account', kind: 'apply', readOnly: false },
});

export class RequestRejected extends Error {
  constructor(status = 403) { super('Request rejected'); this.status = status; }
}
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function json(status, value) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  } });
}
export async function readJson(request, maxBytes) {
  if (request.headers.get('content-type')?.toLowerCase() !== 'application/json') throw new RequestRejected(415);
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new RequestRejected(413);
  if (!request.body) throw new RequestRejected(400);
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new RequestRejected(413);
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
  catch { throw new RequestRejected(400); }
}

export function createApi({ entryHandler, authenticate, backend, publicConfig, maxBodyBytes, enrollment }) {
  if (typeof entryHandler !== 'function' || typeof authenticate !== 'function' || typeof backend?.call !== 'function'
      || !Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) throw new TypeError('Complete API composition required');
  if (enrollment !== undefined && (!enrollment || typeof enrollment.enroll !== 'function'
      || typeof enrollment.publishCheckpoint !== 'function' || typeof enrollment.current !== 'function')) {
    throw new TypeError('Enrollment service is incomplete');
  }
  // publicConfig is an explicit public-only object built by the trusted startup
  // composition. Never serialize the deployment configuration or environment.
  const publicBytes = JSON.stringify(publicConfig);
  async function invoke(name, input, request) {
    const operation = OPERATIONS[name];
    if (!operation) throw new RequestRejected(404);
    const principal = await authenticate(request, operation.scope);
    if (!principal) throw new RequestRejected(401);
    const snapshot = structuredClone(input);
    if (!snapshot || typeof snapshot !== 'object' || JSON.stringify(snapshot).length > maxBodyBytes) throw new RequestRejected(413);
    if (operation.backend === 'discovery') {
      if (snapshot.operation?.kind !== operation.kind || snapshot.admission?.memberId !== principal.memberId
          || snapshot.admission.communityId !== publicConfig.communityId) throw new RequestRejected();
    }
    if (operation.backend === 'account') {
      if (snapshot.action !== operation.kind || snapshot.grant?.memberId !== principal.memberId
          || snapshot.grant.communityId !== publicConfig.communityId) throw new RequestRejected();
    }
    if (operation.backend === 'presenceLookup') {
      if (snapshot.operation?.kind !== 'fetch' || snapshot.admission?.memberId !== principal.memberId
          || snapshot.admission.communityId !== publicConfig.communityId) throw new RequestRejected();
    }
    if (operation.backend === 'presenceDirectory') {
      if (!snapshot.operation || snapshot.operation.kind !== 'query'
          || !snapshot.operation.filters || typeof snapshot.operation.filters !== 'object'
          || Array.isArray(snapshot.operation.filters) || Object.keys(snapshot.operation.filters).length !== 0
          || snapshot.operation.after !== null
          || snapshot.admission?.memberId !== principal.memberId
          || snapshot.admission.communityId !== publicConfig.communityId) throw new RequestRejected();
    }
    if (operation.backend === 'enrollment') {
      if (!enrollment) throw new RequestRejected(503);
      if (operation.kind === 'enroll') {
        if (!exact(snapshot, ['action', 'delegation']) || snapshot.action !== 'enroll'
            || snapshot.delegation?.admission?.memberId !== principal.memberId
            || snapshot.delegation?.admission?.communityId !== publicConfig.communityId) throw new RequestRejected();
      } else if (!exact(snapshot, ['action']) || snapshot.action !== 'current') {
        throw new RequestRejected();
      }
    }
    if (operation.backend === 'presence' || operation.backend === 'keyIssue') {
      if (snapshot.grant?.memberId !== principal.memberId || snapshot.grant.communityId !== publicConfig.communityId) throw new RequestRejected();
    }
    // cfrm verifies signatures, deadlines, community, device authority, request
    // replay and proof scope. Neither API-key possession nor this check replaces it.
    if (operation.backend === 'enrollment') {
      if (operation.kind === 'enroll') {
        await enrollment.enroll(snapshot.delegation);
        return { action: 'enroll', publication: await enrollment.publishCheckpoint() };
      }
      return { action: 'current', publication: await enrollment.current() };
    }
    return backend.call(operation.backend, snapshot, { principal: { kind: 'member', memberId: principal.memberId } });
  }
  return Object.freeze({
    invoke,
    authenticate,
    async handle(request) {
      const path = new URL(request.url).pathname;
      if (path === '/api/config' && request.method === 'GET') return new Response(publicBytes, { headers: {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      } });
      if (path.startsWith('/auth/') || path.startsWith('/credential/')) return entryHandler(request);
      if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
      try {
        const body = await readJson(request, maxBodyBytes);
        let name;
        if (path === '/v1/discovery') name = Object.keys(OPERATIONS).find(key => OPERATIONS[key].backend === 'discovery' && OPERATIONS[key].kind === body?.operation?.kind);
        else if (path === '/v1/account') name = Object.keys(OPERATIONS).find(key => OPERATIONS[key].backend === 'account' && OPERATIONS[key].kind === body?.action);
        else if (path === '/v1/account/enrollment') name = body?.action === 'enroll' ? 'account_enroll' : body?.action === 'current' ? 'account_enrollment' : undefined;
        else name = Object.keys(OPERATIONS).find(key => OPERATIONS[key].path === path);
        return json(200, await invoke(name, body, request));
      } catch (error) { return json(error instanceof RequestRejected ? error.status : 403, { error: 'Request rejected' }); }
    },
  });
}
