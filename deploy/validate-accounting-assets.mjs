// Public artifact contract shared by staging and image validation.
const HEX64 = /^[0-9a-f]{64}$/;

export async function validatePublicAccounting(stage, declared, { assert, jsonFile, digestFile }) {
  const root = 'dist/accounting';
  const manifestPath = `${root}/manifest.json`;
  const manifest = await jsonFile(stage, manifestPath);
  assert(manifest.version === 1 && manifest.compiler === '1.0.0-beta.26' && manifest.backend === '5.0.0'
    && manifest.verifierTarget === 'noir-recursive' && manifest.accountingMode === 'account-state-v2'
    && manifest.hashScheme === 'poseidon2-bn254-fixed-128-v1', 'accounting artifact manifest contract');
  const expected = [['circuit.json', manifest.circuitSha256], ['vk.bin', manifest.vkSha256]];
  assert(Array.isArray(manifest.setup) && manifest.setup.length === 2, 'accounting setup manifest');
  const setup = new Set();
  for (const item of manifest.setup) {
    assert(item && ['g1.dat', 'g2.dat'].includes(item.name) && !setup.has(item.name)
      && Number.isSafeInteger(item.bytes) && item.bytes > 0 && HEX64.test(item.sha256), 'accounting setup pin');
    setup.add(item.name);
    expected.push([`setup/${item.name}`, item.sha256, item.bytes]);
  }
  assert(setup.size === 2, 'accounting setup names');
  assert(Array.isArray(manifest.wasm) && manifest.wasm.length === 1
    && manifest.wasm[0]?.name === 'barretenberg-threads.wasm'
    && Number.isSafeInteger(manifest.wasm[0].bytes) && manifest.wasm[0].bytes > 0
    && HEX64.test(manifest.wasm[0].sha256), 'accounting browser Wasm pin');
  expected.push(['barretenberg-threads.wasm', manifest.wasm[0].sha256, manifest.wasm[0].bytes]);
  const peer = manifest.peerReservation;
  assert(peer && peer.mode === 'peer-reservation-v3' && peer.publicInputs === 389
    && peer.sharesAccountSetup === true && HEX64.test(peer.circuitSha256) && HEX64.test(peer.vkSha256), 'accounting peer pins');
  expected.push(['peer-reservation/circuit.json', peer.circuitSha256]);
  expected.push(['peer-reservation/vk.bin', peer.vkSha256]);
  for (const [path, digest, bytes] of expected) {
    const fullPath = `${root}/${path}`;
    assert(declared.has(fullPath), `${fullPath} is not declared in release manifest`);
    const file = await digestFile(stage, fullPath, digest, fullPath);
    if (bytes !== undefined) assert(file.bytes.length === bytes, `${fullPath} byte count mismatch`);
  }
}
