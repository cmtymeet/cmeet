import { policyDigest } from 'cfrm/accounting';
import { json, readJson, RequestRejected } from './api.mjs';

// Two administration layers for the cfrm account policy (14 circuit inputs).
// Global administrators set per-community ceilings (or the '*' default);
// community administrators schedule policy revisions inside those ceilings.
// Every write appends an immutable revision under compare-and-swap. A revision
// only takes effect in the future, so accepted accounts, committed reservation
// deadlines and earlier policy digests are never changed retroactively.
// cfrm policy revision, validity window and period fields are unix seconds.

export const TUNABLE_FIELDS = Object.freeze(['initialCredit', 'maximumAvailable', 'outgoingReservation',
  'incomingReservation', 'newcomerPeriod', 'rateWindow', 'newcomerAdmissions', 'maximumAdmissions',
  'refillPeriod', 'refillUnits', 'abandonAfter']);
const U32 = 2 ** 32 - 1;
const DEFAULT = '*';
const MAX_HISTORY = 64;

export class PolicyRejected extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const count = value => Number.isSafeInteger(value) && value >= 0;
const communityKey = (value, allowDefault) => {
  if (allowDefault && value === DEFAULT) return value;
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(value) || value === DEFAULT) throw new PolicyRejected('Invalid community');
  return value;
};

/** Append-only revision log over a minimal SQL port (see the adapters below). */
export async function createRevisionStore(sql) {
  if (typeof sql?.query !== 'function' || typeof sql?.run !== 'function') throw new TypeError('SQL port required');
  await sql.run(`CREATE TABLE IF NOT EXISTS cmeet_admin_revisions (
    scope TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), document TEXT NOT NULL,
    actor TEXT NOT NULL, recorded_at INTEGER NOT NULL, PRIMARY KEY (scope, revision)) STRICT, WITHOUT ROWID`);
  const row = value => ({ revision: Number(value.revision), document: JSON.parse(value.document),
    actor: value.actor, recordedAt: Number(value.recorded_at) });
  const list = async (scope, limit) => (await sql.query(`SELECT revision, document, actor, recorded_at
    FROM cmeet_admin_revisions WHERE scope = ? ORDER BY revision DESC LIMIT ?`, [scope, limit])).map(row);
  return Object.freeze({
    list,
    latest: async scope => (await list(scope, 1))[0] ?? null,
    // One statement, so the revision check and the insert are atomic in SQLite and libSQL.
    async append(scope, expectedRevision, document, actor, recordedAt) {
      return (await sql.run(`INSERT INTO cmeet_admin_revisions (scope, revision, document, actor, recorded_at)
        SELECT ?, ?, ?, ?, ? WHERE (SELECT COALESCE(MAX(revision), 0) FROM cmeet_admin_revisions WHERE scope = ?) = ?
        ON CONFLICT DO NOTHING`, [scope, expectedRevision + 1, JSON.stringify(document), actor, recordedAt,
        scope, expectedRevision])) === 1;
    },
  });
}
export const sqliteSql = db => ({
  query: async (text, args = []) => db.prepare(text).all(...args),
  run: async (text, args = []) => Number(db.prepare(text).run(...args).changes),
});
export const libsqlSql = client => ({
  query: async (text, args = []) => (await client.execute({ sql: text, args })).rows,
  run: async (text, args = []) => Number((await client.execute({ sql: text, args })).rowsAffected),
});

// cfrm owns the policy invariants; the digest check rejects anything it would.
const cfrmValidate = async policy => { await policyDigest(new Uint8Array(32), policy); };

export function createPolicyAdmin({ store, now = () => Math.floor(Date.now() / 1000), validate = cfrmValidate }) {
  if (!store || typeof now !== 'function' || typeof validate !== 'function') throw new TypeError('Complete policy admin composition required');

  async function ceilings(communityId) {
    return (await store.latest(`ceilings:${communityId}`)) ?? (await store.latest(`ceilings:${DEFAULT}`));
  }
  function effectiveAt(revisions, time) {
    return revisions.find(({ document: p }) => p.policyValidFrom <= time && time < p.policyValidUntil) ?? null;
  }

  return Object.freeze({
    async read({ communityId }) {
      communityKey(communityId, false);
      const [limits, revisions] = await Promise.all([ceilings(communityId), store.list(`policy:${communityId}`, MAX_HISTORY)]);
      const time = now();
      return { communityId, time, ceilings: limits, latestRevision: revisions[0]?.revision ?? 0,
        effective: effectiveAt(revisions, time), upcoming: revisions.filter(r => r.document.policyValidFrom > time).reverse() };
    },
    async history({ communityId, layer, limit }) {
      if (!['ceilings', 'policy'].includes(layer) || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_HISTORY) throw new PolicyRejected('Invalid history request');
      return { revisions: await store.list(`${layer}:${communityKey(communityId, layer === 'ceilings')}`, limit) };
    },
    /** Global layer. New ceilings bind the next community revision only. */
    async setCeilings({ communityId, expectedRevision, bounds, noticeSeconds, lifetimeSeconds }, actor) {
      communityKey(communityId, true);
      if (!count(expectedRevision) || !exact(bounds, TUNABLE_FIELDS) || !count(noticeSeconds)
          || !Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds < 1) throw new PolicyRejected('Invalid ceilings');
      for (const field of TUNABLE_FIELDS) {
        const bound = bounds[field];
        if (!exact(bound, ['min', 'max']) || !count(bound.min) || !count(bound.max) || bound.min > bound.max
            || bound.max > U32) throw new PolicyRejected(`Invalid bound: ${field}`);
      }
      const document = { bounds: structuredClone(bounds), noticeSeconds, lifetimeSeconds };
      if (!(await store.append(`ceilings:${communityId}`, expectedRevision, document, actor, now()))) throw new PolicyRejected('Stale revision', 409);
      return { communityId, revision: expectedRevision + 1, document };
    },
    /** Community layer. The revision number is the cfrm policyRevision. */
    async schedulePolicy({ communityId, expectedRevision, values, validFrom }, actor) {
      communityKey(communityId, false);
      if (!count(expectedRevision) || !exact(values, TUNABLE_FIELDS)) throw new PolicyRejected('Invalid policy values');
      const limits = await ceilings(communityId);
      if (!limits) throw new PolicyRejected('Global ceilings required', 409);
      for (const field of TUNABLE_FIELDS) {
        const { min, max } = limits.document.bounds[field];
        if (!count(values[field]) || values[field] < min || values[field] > max) throw new PolicyRejected(`Outside ceilings: ${field}`);
      }
      const scope = `policy:${communityId}`, time = now();
      const previous = await store.latest(scope);
      if ((previous?.revision ?? 0) !== expectedRevision) throw new PolicyRejected('Stale revision', 409);
      const earliest = time + limits.document.noticeSeconds;
      const from = validFrom ?? earliest;
      if (!Number.isSafeInteger(from) || from < earliest || from <= time) throw new PolicyRejected('Policy must start after the notice period');
      if (previous && from <= previous.document.policyValidFrom) throw new PolicyRejected('Policy must start after the previous revision', 409);
      const policy = { ...values, policyRevision: expectedRevision + 1, policyValidFrom: from,
        policyValidUntil: from + limits.document.lifetimeSeconds };
      if (!Number.isSafeInteger(policy.policyValidUntil)) throw new PolicyRejected('Invalid validity window');
      try { await validate(policy); } catch { throw new PolicyRejected('Policy violates cfrm invariants'); }
      if (!(await store.append(scope, expectedRevision, policy, actor, time))) throw new PolicyRejected('Stale revision', 409);
      return { communityId, revision: policy.policyRevision, policy, ceilingsRevision: limits.revision };
    },
  });
}

// Scopes are granted by authenticated credentials; the hostname
// (api.admin / api.root) only selects the route. authenticate returns
// { actor, global: boolean, communities: string[] } or null.
export const ADMIN_OPERATIONS = Object.freeze({
  policy_read: { scope: 'policy:read', readOnly: true, layer: 'community' },
  policy_history: { scope: 'policy:read', readOnly: true, layer: 'community' },
  policy_schedule: { scope: 'policy:community', readOnly: false, layer: 'community' },
  policy_set_ceilings: { scope: 'policy:global', readOnly: false, layer: 'global' },
});
const METHODS = { policy_read: 'read', policy_history: 'history', policy_schedule: 'schedulePolicy', policy_set_ceilings: 'setCeilings' };

export function createPolicyAdminApi({ admin, authenticate, maxBodyBytes }) {
  if (!admin || typeof authenticate !== 'function' || !Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) throw new TypeError('Complete admin API composition required');
  async function invoke(name, input, request) {
    const operation = ADMIN_OPERATIONS[name];
    if (!operation) throw new RequestRejected(404);
    const principal = await authenticate(request, operation.scope);
    if (!principal || typeof principal.actor !== 'string' || !principal.actor) throw new RequestRejected(401);
    const snapshot = structuredClone(input);
    if (!record(snapshot) || JSON.stringify(snapshot).length > maxBodyBytes) throw new RequestRejected(413);
    const own = principal.global === true
      || (Array.isArray(principal.communities) && principal.communities.includes(snapshot.communityId));
    if (operation.layer === 'global' ? principal.global !== true : !own) throw new RequestRejected(403);
    // Ceilings history is readable by the community; writing ceilings is global only.
    if (name === 'policy_history' && snapshot.communityId === DEFAULT && principal.global !== true) throw new RequestRejected(403);
    return admin[METHODS[name]](snapshot, principal.actor);
  }
  return Object.freeze({
    invoke,
    authenticate,
    async handle(request) {
      const name = new URL(request.url).pathname.match(/^\/v1\/admin\/(policy_[a-z_]+)$/)?.[1];
      if (!name || !ADMIN_OPERATIONS[name]) return json(404, { error: 'Not found' });
      if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
      try { return json(200, await invoke(name, await readJson(request, maxBodyBytes), request)); }
      catch (error) {
        if (error instanceof PolicyRejected) return json(error.status, { error: error.message });
        return json(error instanceof RequestRejected ? error.status : 403, { error: 'Request rejected' });
      }
    },
  });
}

export async function createPolicyAdminMcp({ api, maxBodyBytes }) {
  const [{ McpServer, createMcpHandler }, z] = await Promise.all([import('@modelcontextprotocol/server'), import('zod/v4')]);
  const handler = createMcpHandler(({ requestInfo }) => {
    const server = new McpServer({ name: 'cmeet-admin', version: '0.1.0-alpha.0' });
    for (const [name, operation] of Object.entries(ADMIN_OPERATIONS)) {
      server.registerTool(name, {
        description: `cmeet account-policy administration (${operation.layer} layer). Requires ${operation.scope}.`,
        inputSchema: z.object({ request: z.record(z.string(), z.unknown()) }).strict(),
        annotations: { readOnlyHint: operation.readOnly, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      }, async ({ request }) => {
        try { return { content: [{ type: 'text', text: JSON.stringify(await api.invoke(name, request, requestInfo)) }] }; }
        catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof PolicyRejected ? error.message : 'Request rejected' }] }; }
      });
    }
    return server;
  }, { legacy: 'stateless', responseMode: 'json', maxRequestBodySize: maxBodyBytes });
  return Object.freeze({
    async handle(request) {
      if (!(await api.authenticate(request))) return json(401, { error: 'Authentication required' });
      const response = await handler.fetch(request);
      response.headers.set('Cache-Control', 'no-store');
      return response;
    },
    close: () => handler.close(),
  });
}
