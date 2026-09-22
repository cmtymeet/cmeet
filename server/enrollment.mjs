import { createHash } from 'node:crypto';
import { createAccountVerifier } from 'cfrm/accounting';
import { nodeArtifactOptions } from 'cfrm/accounting/node-verifier';
import { createEnrollmentService } from 'cfrm/accounting/enrollment-node';
import { createEnrollmentStore } from 'cfrm/accounting/enrollment-store';

// The same pinned cfrm hash runtime derives the common public enrollment tree.
// Member secrets and proofs are absent from this process's enrollment input.
export async function composeEnrollment({ config, account, trust, backend, operatorPrivateKey, clock }) {
  const store = createEnrollmentStore(config);
  let runtime, service, queue = Promise.resolve(), closed = false;
  try {
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
  } catch (error) { await runtime?.destroy(); store.close(); throw error; }
  function call(method, value) {
    if (closed) return Promise.reject(new Error('Enrollment is closed'));
    const input = structuredClone(value);
    const next = queue.catch(() => {}).then(() => service[method](input));
    queue = next.catch(() => {}); return next;
  }
  let closing;
  return Object.freeze({
    enroll: value => call('enroll', value),
    publishCheckpoint: () => call('publishCheckpoint'),
    current: () => call('current'),
    close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => { await queue; service.close(); await runtime.destroy(); store.close(); })();
      return closing;
    },
  });
}
