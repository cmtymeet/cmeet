import { createBrowserCredentialHolder } from '@corbet-labs/cvld/holder';
import CredentialWorker from '@corbet-labs/cvld/holder-worker?worker';

/** Private holder and public verification both run off the UI thread. Only
 * blinded requests and issuer credentials cross the authenticated API. */
export async function openPrivateCredential({ api, wallet, store, config, memberId }) {
  const issuer = config.publicIssuer;
  if (!issuer?.schemaId || !issuer.credentialDefinitionId || !issuer.schema || !issuer.credentialDefinition) throw new Error('Credential issuer is not configured');
  const create = () => createBrowserCredentialHolder({ worker: new CredentialWorker(), publicIssuer: issuer, deadlineMs: config.credentialDeadlineMs });
  const holder = await create();
  let verifier;
  const key = await wallet.storageKey('eligibility-credential');
  const context = 'cmeet.eligibility.v1';
  try {
    const saved = (await store.read()).credential;
    if (saved && saved.schemaId === issuer.schemaId && saved.credentialDefinitionId === issuer.credentialDefinitionId
        && saved.expiresAt > Math.floor(Date.now() / 1000) + config.profileLimits.maxChallengeSeconds) {
      await holder.restore({ envelope: saved.envelope, key, context });
    } else {
      const start = await api.request('/credential/begin', { method: 'POST', body: {} });
      if (!start?.id || start.issuer?.schemaId !== issuer.schemaId || start.issuer?.credentialDefinitionId !== issuer.credentialDefinitionId) throw new Error('Credential offer rejected');
      const credentialRequest = await holder.request(start.offer);
      const credential = await api.request('/credential/issue', { method: 'POST', body: {
        id: start.id, request: { credentialRequest, binding: { communityId: config.communityId, memberId } },
      } });
      const values = credential?.values;
      const expiresAt = Number(values?.valid_until?.raw);
      if (values?.member_id?.raw !== memberId || values?.community_id?.raw !== config.communityId
          || values?.policy?.raw !== issuer.policyDigest || values?.eligible?.raw !== '1'
          || !Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('Eligibility credential rejected');
      const envelope = await holder.accept({ credential, key, context });
      await store.update(state => ({ ...state, credential: {
        schemaId: issuer.schemaId, credentialDefinitionId: issuer.credentialDefinitionId, expiresAt, envelope,
      } }));
    }
    verifier = await create();
    return Object.freeze({
      presentProfile: request => holder.presentProfile(request),
      verifyProfile: (request, proof) => verifier.verifyProfile(request, proof),
      close() { holder.close(); verifier.close(); },
    });
  } catch (error) { holder.close(); verifier?.close(); throw error; }
  finally { key.fill(0); }
}
