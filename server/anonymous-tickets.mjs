import net from 'node:net';

// cmsg::FrameCodec uses a uint32 big-endian payload length and caps the
// payload at MAX_WIRE_BYTES. Keep these values local to this transport seam so
// the raw Tor-facing listener cannot accidentally become an unbounded JSON
// service. The native backend remains responsible for cfrm verification.
const FRAME_HEADER_BYTES = 4;
const CMSG_MAX_WIRE_BYTES = 1024 * 1024;
const MAX_DEADLINE_MS = 60_000;
const MAX_CONNECTIONS = 1024;
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1']);
const textDecoder = new TextDecoder('utf-8', { fatal: true });

function positiveInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${name} must be an explicit bounded integer`);
  }
  return value;
}

function validateOptions(options) {
  if (!options || typeof options !== 'object') throw new TypeError('Listener options required');
  const { backend, host, port, maxConnections, maxFrameBytes, deadlineMs } = options;
  if (!backend || typeof backend.callOperation !== 'function') throw new TypeError('Backend operation boundary required');
  if (typeof host !== 'string' || !LOOPBACK_ADDRESSES.has(host)) {
    throw new TypeError('Numeric loopback host required');
  }
  // Port zero is deliberately accepted only as an explicit ephemeral test
  // port. Production startup supplies the configured HiddenServicePort target.
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError('Numeric port required');
  positiveInteger(maxConnections, 'maxConnections', MAX_CONNECTIONS);
  positiveInteger(maxFrameBytes, 'maxFrameBytes', CMSG_MAX_WIRE_BYTES);
  positiveInteger(deadlineMs, 'deadlineMs', MAX_DEADLINE_MS);
  return { backend, host, port, maxConnections, maxFrameBytes, deadlineMs };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && wanted.every((key, index) => actual[index] === key);
}

function validateRequest(value) {
  if (!hasExactKeys(value, ['request'])) throw new Error('Malformed key redemption frame');
  const request = value.request;
  if (!hasExactKeys(request, ['permit', 'challengeDigest', 'expiresAt', 'claim'])) {
    throw new Error('Malformed key redemption request');
  }
  const permit = request.permit;
  if (!hasExactKeys(permit, ['contextId', 'serial', 'randomizer', 'signature']) ||
      Object.values(permit).some(field => typeof field !== 'string')) {
    throw new Error('Malformed permit');
  }
  if (typeof request.challengeDigest !== 'string' || typeof request.claim !== 'string' ||
      !Number.isSafeInteger(request.expiresAt) || request.expiresAt < 1) {
    throw new Error('Malformed key redemption fields');
  }
  return request;
}

function parseFrame(socket, maxFrameBytes, deadlineMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = Buffer.alloc(0);
    let expected;
    const timer = setTimeout(() => fail(new Error('Frame deadline exceeded')), deadlineMs);

    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('end', onEnd);
      socket.off('error', onError);
      socket.off('close', onClose);
    }
    function fail(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }
    function onEnd() { fail(new Error('Frame ended before completion')); }
    function onError(error) { fail(error); }
    function onClose() { fail(new Error('Frame connection closed')); }
    function onData(chunk) {
      if (!Buffer.isBuffer(chunk) || chunk.length === 0) return fail(new Error('Invalid frame bytes'));
      // Until the header is known, four bytes are the only unbounded state
      // permitted. Once known, the only accepted total is header + payload;
      // bytes beyond that are a trailing frame or malformed input.
      const cap = expected === undefined ? FRAME_HEADER_BYTES + maxFrameBytes : FRAME_HEADER_BYTES + expected;
      if (buffer.length > cap - chunk.length) return fail(new Error('Trailing or oversized frame'));
      buffer = Buffer.concat([buffer, chunk]);
      if (expected === undefined && buffer.length >= FRAME_HEADER_BYTES) {
        expected = buffer.readUInt32BE(0);
        if (expected === 0 || expected > maxFrameBytes) return fail(new Error('Frame size rejected'));
      }
      if (expected !== undefined && buffer.length === FRAME_HEADER_BYTES + expected) {
        const body = buffer.subarray(FRAME_HEADER_BYTES);
        let trailing = false;
        const onTrailing = () => { trailing = true; socket.destroy(); };
        socket.on('data', onTrailing);
        settled = true;
        cleanup();
        resolve({ body, hasTrailing: () => trailing, stopWatching: () => socket.off('data', onTrailing) });
      }
    }
    socket.on('data', onData);
    socket.once('end', onEnd);
    socket.once('error', onError);
    socket.once('close', onClose);
    socket.resume();
  });
}

function writeFrame(socket, value, maxFrameBytes, deadlineMs) {
  let encoded;
  try {
    encoded = Buffer.from(JSON.stringify(value), 'utf8');
  } catch {
    return Promise.reject(new Error('Unserializable redemption stamp'));
  }
  if (encoded.length === 0 || encoded.length > maxFrameBytes) {
    return Promise.reject(new Error('Redemption stamp exceeds frame bound'));
  }
  const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + encoded.length);
  frame.writeUInt32BE(encoded.length, 0);
  encoded.copy(frame, FRAME_HEADER_BYTES);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Response deadline exceeded'));
    }, deadlineMs);
    socket.end(frame, error => {
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    });
  });
}

async function handleConnection(socket, options) {
  socket.setNoDelay(true);
  const parsed = await parseFrame(socket, options.maxFrameBytes, options.deadlineMs);
  try {
    let decoded;
    try {
      decoded = JSON.parse(textDecoder.decode(parsed.body));
    } catch {
      throw new Error('Invalid JSON frame');
    }
    const request = validateRequest(decoded);
    const stamp = await options.backend.callOperation(
      'key_redeem',
      { request },
      { principal: { kind: 'anonymous' } },
    );
    if (socket.destroyed) throw new Error('Redemption connection closed');
    if (parsed.hasTrailing()) throw new Error('Trailing frame rejected');
    if (!isRecord(stamp)) throw new Error('Invalid redemption stamp');
    await writeFrame(socket, stamp, options.maxFrameBytes, options.deadlineMs);
  } finally {
    parsed.stopWatching();
  }
}

/**
 * Start the anonymous key-ticket redemption transport used behind a Tor
 * HiddenServicePort. It accepts one cmsg frame per TCP connection and exposes
 * no HTTP, cookie, API-key, origin, or peer-identity semantics.
 */
export async function createAnonymousTicketListener(rawOptions) {
  const options = validateOptions(rawOptions);
  const sockets = new Set();
  const pending = new Set();
  let closing = false;
  const server = net.createServer({ allowHalfOpen: false }, socket => {
    if (closing || sockets.size >= options.maxConnections) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    // A single total deadline also covers the native redemption call. Closing
    // a socket cannot cancel a consumed permit; an exact retry remains the
    // library's responsibility and never creates a second successful spend.
    const deadline = setTimeout(() => socket.destroy(), options.deadlineMs);
    const disconnected = new Promise((_, reject) => socket.once('close', () => {
      clearTimeout(deadline); sockets.delete(socket); reject(new Error('Connection closed'));
    }));
    const task = Promise.race([handleConnection(socket, options), disconnected])
      .catch(() => { socket.destroy(); })
      .finally(() => { pending.delete(task); });
    pending.add(task);
    socket.once('error', () => {});
  });
  await new Promise((resolve, reject) => {
    const onError = error => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host: options.host, port: options.port });
  });
  server.on('error', () => { closing = true; for (const socket of sockets) socket.destroy(); });

  let closePromise;
  return Object.freeze({
    address() {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Listener is closed');
      return { host: address.address, port: address.port };
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      for (const socket of sockets) socket.destroy();
      closePromise = new Promise(resolve => server.close(() => resolve()))
        .then(() => Promise.allSettled([...pending]));
      return closePromise;
    },
  });
}
