import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { createAnonymousTicketListener } from '../server/anonymous-tickets.mjs';

function frame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  const result = Buffer.alloc(4 + payload.length);
  result.writeUInt32BE(payload.length, 0);
  payload.copy(result, 4);
  return result;
}

function connect(address) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address.port, address.host);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function collect(socket) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    socket.on('data', chunk => chunks.push(chunk));
    socket.once('error', reject);
    socket.once('close', () => resolve(Buffer.concat(chunks)));
  });
}

function decodeResponse(wire) {
  assert.ok(wire.length >= 5);
  const length = wire.readUInt32BE(0);
  assert.equal(wire.length, length + 4);
  return JSON.parse(wire.subarray(4).toString('utf8'));
}

function requestFixture() {
  return {
    request: {
      // These are shape-only test values. The production native cfrm backend
      // performs the permit and redemption cryptographic checks.
      permit: { contextId: 'context', serial: 'serial', randomizer: 'randomizer', signature: 'signature' },
      challengeDigest: 'challenge',
      expiresAt: 42,
      claim: 'claim',
    },
  };
}

async function listenerWith(calls, overrides = {}) {
  return createAnonymousTicketListener({
    backend: { callOperation: async (...args) => { calls.push(args); return { contextId: 'stamp' }; } },
    host: '127.0.0.1', port: 0, maxConnections: 4, maxFrameBytes: 4096, deadlineMs: 1000,
    ...overrides,
  });
}

test('anonymous listener uses cmsg framing and forwards only the anonymous key redemption operation', async () => {
  const calls = [];
  const listener = await listenerWith(calls);
  try {
    const socket = await connect(listener.address());
    socket.write(frame(requestFixture()));
    const response = decodeResponse(await collect(socket));
    assert.deepEqual(response, { contextId: 'stamp' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'key_redeem');
    assert.deepEqual(calls[0][1], requestFixture());
    assert.deepEqual(calls[0][2], { principal: { kind: 'anonymous' } });
  } finally {
    await listener.close();
  }
});

test('anonymous listener rejects a trailing frame and an oversized frame without invoking the backend', async () => {
  const calls = [];
  const listener = await listenerWith(calls);
  try {
    const trailing = await connect(listener.address());
    const wire = frame(requestFixture());
    trailing.end(Buffer.concat([wire, wire]));
    const trailingResponse = await collect(trailing);
    assert.equal(trailingResponse.length, 0);

    const oversized = await connect(listener.address());
    const header = Buffer.alloc(4); header.writeUInt32BE(4097, 0);
    oversized.end(header);
    assert.equal((await collect(oversized)).length, 0);
    assert.equal(calls.length, 0);
  } finally {
    await listener.close();
  }
});
