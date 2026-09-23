import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentDomains, resolveWebsiteAddress } from '../server/domains.mjs';

test('one base domain selects the community and reserved administration namespaces', () => {
  const address = resolveWebsiteAddress({ baseDomain: 'test.example', communityLabel: null });
  assert.equal(address.origin, 'https://test.example');
  assert.equal(address.rpID, 'test.example');
  assert.deepEqual(address.domains, {
    baseDomain: 'test.example',
    community: { origin: 'https://test.example', apiOrigin: 'https://api.test.example', mcpOrigin: 'https://mcp.test.example' },
    admin: { origin: 'https://admin.test.example', apiOrigin: 'https://api.admin.test.example' },
    root: { origin: 'https://root.test.example', apiOrigin: 'https://api.root.test.example' },
  });
  const changed = resolveWebsiteAddress({ baseDomain: 'new.example', communityLabel: 'garden' });
  assert.equal(changed.origin, 'https://garden.new.example');
  assert.equal(changed.rpID, 'garden.new.example');
  assert.equal(changed.domains.community.apiOrigin, 'https://api.garden.new.example');
  assert.equal(changed.domains.community.mcpOrigin, 'https://mcp.garden.new.example');
  assert.equal(changed.domains.admin.origin, 'https://admin.new.example');
  assert.equal(changed.domains.root.apiOrigin, 'https://api.root.new.example');
  assert.throws(() => { changed.domains.root.origin = 'https://attacker.example'; }, TypeError);
});

test('configured base domain cannot disagree with authentication origin or RP ID', () => {
  const base = { baseDomain: 'test.example', communityLabel: 'garden' };
  for (const overrides of [
    { origin: 'https://old.example' }, { rpID: 'test.example' },
    { origin: 'https://api.garden.test.example' },
    { origin: 'http://garden.test.example' },
  ]) assert.throws(() => resolveWebsiteAddress({ ...base, ...overrides }), /conflicts/);
  assert.equal(resolveWebsiteAddress({ ...base, origin: 'https://garden.test.example', rpID: 'garden.test.example' }).rpID,
    'garden.test.example');
  assert.throws(() => resolveWebsiteAddress({ communityLabel: 'garden', origin: 'https://garden.example', rpID: 'garden.example' }), /requires/);
  assert.throws(() => resolveWebsiteAddress({ ...base, allowInsecureLocalhost: true }), /HTTPS/);
});

test('deployment DNS inputs reject URL injection, IPs and reserved host collisions', () => {
  for (const baseDomain of ['', null, 1, 'localhost', '127.0.0.1', '127.1', '[::1]', 'Test.example',
    'https://test.example', 'test.example:443', 'test.example/', 'test.example?x',
    'test.example#x', 'test.example@attacker.example', '*.test.example', 'test.example.',
    'test..example', '-test.example', 'test_.example', 'test.example\n', `${'a'.repeat(64)}.example`]) {
    assert.throws(() => deploymentDomains({ baseDomain }), /DNS/);
  }
  for (const communityLabel of ['root', 'admin', 'api', 'mcp', '', 'a.b', '../root', 1, 'Root', 'root\n']) {
    assert.throws(() => deploymentDomains({ baseDomain: 'test.example', communityLabel }), /label/);
  }
  // An individually valid base can still overflow when the longest host is derived.
  const baseDomain = [63, 63, 63, 56].map(size => 'a'.repeat(size)).join('.');
  assert.throws(() => deploymentDomains({ baseDomain, communityLabel: 'garden' }), /DNS/);
});

test('explicit custom origins and localhost retain their strict authentication boundary', () => {
  const custom = resolveWebsiteAddress({ origin: 'https://community.example', rpID: 'community.example',
    domains: { root: { origin: 'https://attacker.example' } }, issuerPrivateKey: 'not-public' });
  assert.deepEqual(custom, { origin: 'https://community.example', rpID: 'community.example', domains: undefined });
  assert.equal(resolveWebsiteAddress({ origin: 'http://localhost:8123', rpID: 'localhost', allowInsecureLocalhost: true }).rpID, 'localhost');
  for (const config of [
    { origin: 'http://community.example', rpID: 'community.example', allowInsecureLocalhost: true },
    { origin: 'http://localhost:8123', rpID: 'localhost' },
    { origin: 'https://community.example/path', rpID: 'community.example' },
    { origin: 'https://community.example', rpID: 'example' },
  ]) assert.throws(() => resolveWebsiteAddress(config));
});
