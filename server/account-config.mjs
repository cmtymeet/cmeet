import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadArtifacts } from 'cfrm/accounting';
import { nodeArtifactOptions } from 'cfrm/accounting/node-verifier';

const accountKeys = ['operatorPrivateKeyPath', 'policy', 'maxRequestBytes', 'verifier', 'checkpoints'];
const verifierKeys = ['artifactConfigPath', 'scope', 'timeoutMillis', 'maximumParallel', 'maxProofBytes', 'nodeHeapMegabytes'];
const limitKeys = ['maxArtifactBytes', 'maxTotalBytes', 'maxProofBytes', 'memoryPages'];
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const bytes32 = value => Array.isArray(value) && value.length === 32
  && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255);
const positive = value => Number.isSafeInteger(value) && value > 0;
const absolute = value => typeof value === 'string' && isAbsolute(value);

/**
 * Validate operator configuration before starting the native backend. This loads
 * and hashes existing public circuit/VK/setup files; it never proves or compiles.
 * Checkpoint roots must already have been independently verified as the common
 * enrollment tree. This function checks their representation, not enrollment
 * signatures, and must never receive member-supplied configuration.
 */
export async function prepareAccountConfig(input, { storageDriver = 'sqlite' } = {}) {
  const config = structuredClone(input);
  const suppliedNodePath = config?.verifier?.nodePath;
  const suppliedScriptPath = config?.verifier?.scriptPath;
  if (config?.verifier && typeof config.verifier === 'object') {
    delete config.verifier.nodePath;
    delete config.verifier.scriptPath;
  }
  if (!['sqlite', 'turso'].includes(storageDriver)
      || !exact(config, storageDriver === 'sqlite' ? [...accountKeys, 'databasePath'] : accountKeys)
      || (storageDriver === 'sqlite' && !absolute(config.databasePath))
      || !absolute(config.operatorPrivateKeyPath) || !positive(config.maxRequestBytes)
      || !exact(config.verifier, verifierKeys) || !Array.isArray(config.checkpoints)) {
    throw new Error('Explicit operator account configuration required');
  }
  const verifier = config.verifier;
  if (!absolute(verifier.artifactConfigPath)
      || !exact(verifier.scope, ['circuitDigest', 'verifyingKeyDigest'])
      || !Object.values(verifier.scope).every(bytes32)
      || !['timeoutMillis', 'maximumParallel', 'maxProofBytes', 'nodeHeapMegabytes'].every(key => positive(verifier[key]))
      || config.policy?.maxProofBytes !== verifier.maxProofBytes) {
    throw new Error('Explicit account verifier scope and limits required');
  }
  const slots = new Set();
  for (const checkpoint of config.checkpoints) {
    if (!exact(checkpoint, ['slot', 'root']) || !Number.isSafeInteger(checkpoint.slot)
        || checkpoint.slot < 0 || !bytes32(checkpoint.root) || slots.has(checkpoint.slot)) {
      throw new Error('Common account checkpoint configuration');
    }
    slots.add(checkpoint.slot);
  }
  const options = await nodeArtifactOptions(verifier.artifactConfigPath);
  if (!exact(options.limits, limitKeys) || !Object.values(options.limits).every(positive)
      || options.limits.maxProofBytes !== verifier.maxProofBytes) {
    throw new Error('All account artifact resource limits must be explicit and consistent');
  }
  // The shipped loader independently checks the manifest pin, every artifact
  // hash, compiler/backend versions, setup sizes and cumulative resource limits.
  const artifacts = await loadArtifacts(options);
  const digest = bytes => Buffer.from(bytes).toString('hex');
  if (digest(verifier.scope.circuitDigest) !== artifacts.manifest.circuitSha256
      || digest(verifier.scope.verifyingKeyDigest) !== artifacts.manifest.vkSha256) {
    throw new Error('Account proof scope differs from pinned artifacts');
  }
  const nodePath = process.execPath;
  const scriptPath = fileURLToPath(import.meta.resolve('cfrm/accounting/node-verifier'));
  if ((suppliedNodePath !== undefined && suppliedNodePath !== nodePath)
      || (suppliedScriptPath !== undefined && suppliedScriptPath !== scriptPath)) {
    throw new Error('Account verifier executable paths are not trusted');
  }
  return {
    ...config,
    verifier: {
      ...verifier,
      nodePath,
      scriptPath,
    },
  };
}
