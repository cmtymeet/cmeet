import { createHash } from 'node:crypto';
import { statePolicyDigest } from 'cfrm/accounting';
import { nodeArtifactOptions } from 'cfrm/accounting/node-verifier';

const positive = value => Number.isSafeInteger(value) && value > 0;
function select(input, names) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Explicit client configuration required');
  const result = Object.fromEntries(names.map(name => [name, input[name]]));
  if (Object.values(result).some(value => value === undefined)) throw new Error('Incomplete client configuration');
  return structuredClone(result);
}

// Copy public fields individually. The deployment file also holds storage
// credentials and private key paths and is never a public configuration object.
export async function publicClientConfig({ client, nativeConfig, origin, operatorPublicKey }) {
  const profiles = select(client.profiles, ['profileLimits', 'discoveryRequestSeconds', 'discoveryMaxResponseBytes',
    'presenceLeaseSeconds', 'profileTicket', 'profilePolicy']);
  const tor = select(client.tor, ['gateway', 'bootstrapDeadlineMs', 'operationDeadlineMs', 'listenPort',
    'maximumStreams', 'acceptDeadlineMs', 'maxHelloBytes', 'maxProfileFrames']);
  const website = select(client.website, ['discoveryPageSize', 'profileTicketPoolSize', 'heartbeatSeconds', 'profileLifetimeSeconds']);
  const messaging = select(client.messaging, ['maxConversations', 'maxPendingInvitations', 'maxMessages',
    'maxMessageBytes', 'liveSessionSeconds', 'handshakeDeadlineMs', 'maxQueuedFrames', 'keepaliveMs']);
  const boardLimits = select(nativeConfig.presence, ['maxMembers', 'maxDevicesPerMember', 'maxLeaseSeconds', 'maxReplayEntries']);
  const accounting = select(client.accounting, ['artifactBaseUrl', 'requestSeconds', 'checkpointLimits',
    'maxJournalBytes', 'maxCiphertextBytes', 'workerDeadlineMs', 'workerMaxPending']);
  const checkpoint = accounting.checkpointLimits;
  const checkpointBounds = { maxBytes: 16 * 1024 * 1024, maxMapEntries: 65_536, maxSlots: 65_535 };
  if (!checkpoint || Object.keys(checkpoint).length !== 3 || Object.entries(checkpointBounds)
    .some(([key, maximum]) => !positive(checkpoint[key]) || checkpoint[key] > maximum)) throw new Error('Client checkpoint limits');
  const artifact = await nodeArtifactOptions(nativeConfig.account.verifier.artifactConfigPath);
  const assetUrl = new URL(accounting.artifactBaseUrl, origin);
  if (assetUrl.origin !== origin || assetUrl.search || assetUrl.hash || !assetUrl.pathname.endsWith('/')) throw new Error('Same-origin accounting artifacts required');
  const policy = nativeConfig.account.policy;
  if (!Object.values(website).every(positive) || !Object.values(messaging).every(positive)
      || !Object.values(boardLimits).every(positive) || !positive(accounting.requestSeconds)
      || accounting.requestSeconds > policy.maxAuthorizationSeconds
      || accounting.maxJournalBytes > 1_048_576 || accounting.maxCiphertextBytes > 1_572_864
      || !positive(accounting.maxJournalBytes) || !positive(accounting.maxCiphertextBytes)
      || accounting.maxCiphertextBytes < accounting.maxJournalBytes
      || !positive(accounting.workerDeadlineMs) || !positive(accounting.workerMaxPending)
      || profiles.presenceLeaseSeconds > boardLimits.maxLeaseSeconds
      || JSON.stringify(profiles.profileTicket.epoch) !== JSON.stringify(nativeConfig.keyAccess.epoch)) {
    throw new Error('Client limits or profile ticket epoch mismatch');
  }
  const community = new Uint8Array(createHash('sha256').update(nativeConfig.trust.communityId).digest());
  return {
    ...profiles, tor, website, messaging, boardLimits,
    boardTrust: structuredClone(nativeConfig.trust), profileTrust: structuredClone(nativeConfig.trust),
    keyAccessRedeemEndpoint: select(client.keyAccessRedeemEndpoint ?? client.messaging.keyAccessRedeemEndpoint, ['host', 'port']),
    accounting: { ...accounting, artifactBaseUrl: assetUrl.pathname, manifestSha256: artifact.manifestSha256,
      artifactLimits: structuredClone(artifact.limits), operatorPublicKey,
      policy: structuredClone(policy.account), checkpointPeriodSeconds: policy.checkpointPeriodSeconds,
      statePolicyDigest: Array.from(await statePolicyDigest(community, policy.account)) },
  };
}
