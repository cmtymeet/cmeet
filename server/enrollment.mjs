import { createHash } from 'node:crypto';
import { createAccountVerifier } from 'cfrm/accounting';
import { nodeArtifactOptions } from 'cfrm/accounting/node-verifier';
import { createEnrollmentService } from 'cfrm/accounting/enrollment-node';
import { createEnrollmentStore } from 'cfrm/accounting/enrollment-store';
import { storeConnectionOptions } from './storage.mjs';

// The same pinned cfrm hash runtime derives the common public enrollment tree.
// Member secrets and proofs are absent from this process's enrollment input.
export async function composeEnrollment({ config, account, trust, backend, operatorPrivateKey, clock, storage = { driver: 'sqlite' } }) {
  const connection = storeConnectionOptions(storage, config);
  const limits = { maxMembers: config.maxMembers, maxRetainedSlots: config.maxRetainedSlots,
    maxPublicationBytes: config.maxPublicationBytes };
  const store = storage.driver === 'turso'
    ? await (await import('cfrm/accounting/enrollment-turso')).createTursoEnrollmentStore({
      url: connection.url, authToken: connection.authToken, requestTimeoutMs: connection.networkTimeoutMs, ...limits })
    : createEnrollmentStore({ ...connection, ...limits });
  let runtime, service, queue = Promise.resolve(), closed = false;
  try {
    if (storage.driver === 'turso' && store.healthy !== true) throw new Error('Turso enrollment readiness contract required');
    runtime = await createAccountVerifier(await nodeArtifactOptions(account.verifier.artifactConfigPath));
    service = createEnrollmentService({
      communityId: trust.communityId, policyDigest: trust.policyDigest,
      community: new Uint8Array(createHash('sha256').update(trust.communityId).digest()),
      hashes: runtime.hashes, clock, store, operatorPrivateKey,
      checkpointPeriodSeconds: account.policy.checkpointPeriodSeconds, maxMembers: config.maxMembers,
      async verifyDelegation({ delegation }) {
        const result = await backend.callOperation('verify_accounting_delegation', { delegation },
          { principal: { kind: 'member', memberId: delegation.admission.memberId } });
        if (typeof result?.digest !== 'string') throw new Error('Missing verified delegation digest');
        const bytes = Buffer.from(result.digest, 'base64url');
        if (bytes.length !== 32 || bytes.toString('base64url') !== result.digest) throw new Error('Delegation digest encoding');
        return new Uint8Array(bytes);
      },
      installCheckpoint: payload => backend.installEnrollmentCheckpoint(payload),
    });
  } catch (error) { await runtime?.destroy(); await store.close(); throw error; }
  function call(method, value) {
    if (closed) return Promise.reject(new Error('Enrollment is closed'));
    const input = structuredClone(value);
    const next = queue.catch(() => {}).then(() => service[method](input));
    queue = next.catch(() => {}); return next;
  }
  let closing;
  return Object.freeze({
    get healthy() { return !closed && store.healthy !== false; },
    enroll: value => call('enroll', value),
    publishCheckpoint: () => call('publishCheckpoint'),
    current: () => call('current'),
    checkpoint: slot => call('checkpoint', slot),
    close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => { await queue; service.close(); await runtime.destroy(); await store.close(); })();
      return closing;
    },
  });
}
