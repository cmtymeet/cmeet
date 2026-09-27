import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TUNABLE_FIELDS, createRevisionStore, sqliteSql, createPolicyAdmin, createPolicyAdminApi } from '../server/policy-admin.mjs';

const bounds = Object.fromEntries(TUNABLE_FIELDS.map(field => [field, { min: 1, max: 1_000_000 }]));
const values = { initialCredit: 20, maximumAvailable: 40, outgoingReservation: 4, incomingReservation: 2,
  newcomerPeriod: 604800, rateWindow: 86400, newcomerAdmissions: 3, maximumAdmissions: 10,
  refillPeriod: 86400, refillUnits: 5, abandonAfter: 172800 };

async function setup() {
  let time = 1_900_000_000;
  const store = await createRevisionStore(sqliteSql(new DatabaseSync(':memory:')));
  const admin = createPolicyAdmin({ store, now: () => time });
  return { admin, advance: seconds => { time += seconds; }, time: () => time };
}
const ceilings = { communityId: '*', expectedRevision: 0, bounds, noticeSeconds: 3600, lifetimeSeconds: 30 * 86400 };

test('community revisions need global ceilings and start only after the notice period', async () => {
  const { admin, advance, time } = await setup();
  await assert.rejects(admin.schedulePolicy({ communityId: 'c1', expectedRevision: 0, values }, 'owner'), { status: 409 });
  assert.equal((await admin.setCeilings(ceilings, 'root')).revision, 1);
  await assert.rejects(admin.schedulePolicy({ communityId: 'c1', expectedRevision: 0, values, validFrom: time() }, 'owner'));
  const scheduled = await admin.schedulePolicy({ communityId: 'c1', expectedRevision: 0, values }, 'owner');
  assert.equal(scheduled.policy.policyRevision, 1);
  assert.equal(scheduled.policy.policyValidFrom, time() + 3600);
  let state = await admin.read({ communityId: 'c1' });
  assert.equal(state.effective, null);
  assert.equal(state.upcoming.length, 1);
  advance(3600);
  state = await admin.read({ communityId: 'c1' });
  assert.equal(state.effective.revision, 1);
  assert.deepEqual(state.upcoming, []);
});

test('stale writers, out-of-ceiling values and cfrm invariant violations are rejected', async () => {
  const { admin } = await setup();
  await admin.setCeilings(ceilings, 'root');
  await assert.rejects(admin.setCeilings(ceilings, 'root'), { status: 409 });
  await admin.schedulePolicy({ communityId: 'c1', expectedRevision: 0, values }, 'owner');
  await assert.rejects(admin.schedulePolicy({ communityId: 'c1', expectedRevision: 0, values }, 'owner'), { status: 409 });
  await admin.setCeilings({ ...ceilings, communityId: 'c1', bounds: { ...bounds, initialCredit: { min: 1, max: 10 } } }, 'root');
  await assert.rejects(admin.schedulePolicy({ communityId: 'c1', expectedRevision: 1, values }, 'owner'), /initialCredit/);
  // outgoingReservation above initialCredit is invalid in cfrm.
  await assert.rejects(admin.schedulePolicy({ communityId: 'c2', expectedRevision: 0,
    values: { ...values, outgoingReservation: 30 } }, 'owner'), /cfrm invariants/);
  // Earlier revisions stay untouched: history is append-only.
  const history = await admin.history({ communityId: 'c1', layer: 'policy', limit: 10 });
  assert.equal(history.revisions.length, 1);
});

test('API separates global and community administration', async () => {
  const { admin } = await setup();
  const principals = { root: { actor: 'root', global: true, communities: [] },
    owner: { actor: 'owner', global: false, communities: ['c1'] } };
  const api = createPolicyAdminApi({ admin, maxBodyBytes: 65536,
    authenticate: async request => principals[request.headers.get('authorization')] ?? null });
  const call = (who, name, body) => api.handle(new Request(`https://api.admin.example/v1/admin/${name}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(who ? { authorization: who } : {}) } }));
  assert.equal((await call(null, 'policy_read', { communityId: 'c1' })).status, 401);
  assert.equal((await call('owner', 'policy_set_ceilings', ceilings)).status, 403);
  assert.equal((await call('root', 'policy_set_ceilings', ceilings)).status, 200);
  assert.equal((await call('owner', 'policy_schedule', { communityId: 'c2', expectedRevision: 0, values })).status, 403);
  assert.equal((await call('owner', 'policy_schedule', { communityId: 'c1', expectedRevision: 0, values })).status, 200);
  assert.equal((await call('root', 'policy_schedule', { communityId: 'c2', expectedRevision: 0, values })).status, 200);
  const read = await (await call('owner', 'policy_read', { communityId: 'c1' })).json();
  assert.equal(read.latestRevision, 1);
});
