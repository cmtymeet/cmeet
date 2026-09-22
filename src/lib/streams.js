import { LiveInboxStream, BrowserOnionEndpoint } from '@corbet-labs/cmsg';
import { createTorJsOnionNode } from '@corbet-labs/cmsg/tor-streams';
import { BrowserMeetingBoard } from 'cfrm-browser';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_WIRE_BYTES = 1024 * 1024;

function failure() { return new Error('cmsg:Transport'); }

function bounded(value, maximum) {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length
      || fields.some(field => !Object.hasOwn(value, field))) throw new Error(`${label} is invalid`);
}

function endpoint(value, label = 'Onion endpoint') {
  exact(value, ['host', 'port'], label);
  const checked = new BrowserOnionEndpoint(value.host, value.port);
  const result = { host: checked.host, port: checked.port };
  checked.free?.();
  return result;
}

function base64UrlBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw failure();
  let bytes;
  try {
    bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='), char => char.charCodeAt(0));
  } catch { throw failure(); }
  if (bytes.length !== 32) throw failure();
  return bytes;
}

function boundedJson(bytes, maximum) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > maximum) throw failure();
  try { return JSON.parse(decoder.decode(bytes)); } catch { throw failure(); }
}

function jsonFrame(value, maximum) {
  const bytes = encoder.encode(JSON.stringify(value));
  if (bytes.length > maximum) throw failure();
  return bytes;
}

function transportMode(config, injected) {
  const mode = config.transportMode ?? 'production';
  if (mode !== 'production' && mode !== 'test') throw new TypeError('Stream transport mode is invalid');
  if (injected && mode !== 'test') throw new TypeError('Injected stream transport is test-only');
  if (mode === 'test' && !injected) throw new TypeError('Explicit test stream transport is required');
  return mode;
}

function streamConfig(config) {
  const tor = config.tor;
  if (!tor || typeof tor !== 'object') throw new TypeError('Tor stream configuration is required');
  const gateway = typeof tor.gateway === 'string' ? [tor.gateway] : tor.gateway;
  if (!Array.isArray(gateway) || gateway.length === 0 || gateway.some(value => typeof value !== 'string' || value.length === 0)) throw new TypeError('Tor gateway configuration is required');
  for (const [value, name, maximum] of [
    [tor.bootstrapDeadlineMs, 'Tor bootstrap deadline', 300_000],
    [tor.operationDeadlineMs, 'Tor operation deadline', 60_000],
    [tor.listenPort, 'Tor listen port', 65_535],
    [tor.maximumStreams, 'Tor stream capacity', 32],
    [tor.acceptDeadlineMs, 'Tor accept deadline', 600_000],
    [tor.maxHelloBytes, 'Stream hello bound', 65_536],
    [tor.maxProfileFrames, 'Profile frame count', 64]
  ]) if (!bounded(value, maximum)) throw new TypeError(`${name} is invalid`);
  return Object.freeze({ ...tor, gateway });
}

function validateBoardPresence(config, targetMemberId, presence) {
  if (!presence) return null;
  exact(presence, ['memberId', 'devices'], 'Signed presence');
  if (presence.memberId !== targetMemberId || !Array.isArray(presence.devices) || presence.devices.length === 0) throw failure();
  exact(config.boardTrust, ['communityId', 'policyDigest', 'issuerPublicKey'], 'Board trust');
  exact(config.boardLimits, ['maxMembers', 'maxDevicesPerMember', 'maxLeaseSeconds', 'maxReplayEntries'], 'Board limits');
  const board = new BrowserMeetingBoard(JSON.stringify(config.boardTrust), JSON.stringify(config.boardLimits));
  try {
    for (const device of presence.devices) {
      exact(device, ['admission', 'authorization', 'update'], 'Signed presence device');
      board.apply(JSON.stringify(device.admission), JSON.stringify(device.authorization), JSON.stringify(device.update));
    }
    const rows = JSON.parse(board.snapshot());
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].memberId !== targetMemberId) throw failure();
    const devices = rows[0].devices.filter(value => value?.update?.endpoint);
    if (devices.length === 0) return null;
    const selected = devices[0];
    return {
      endpoint: endpoint(selected.update.endpoint),
      peerDevice: base64UrlBytes(selected.update.chatPublicKey)
    };
  } finally { board.free?.(); }
}

function ownerOf(raw, active) {
  const stream = {
    send: bytes => raw.send(bytes), receive: () => raw.receive(),
    close: () => { active.delete(stream); return raw.close(); },
  };
  active.add(stream);
  return stream;
}

/**
 * Real Tor/cmsg stream composition. Routing is selected by a bounded hello;
 * cryptographic peer identity comes only from cmsg's authenticated frames.
 */
export function createMemberStreams({ config, lookupPresence, onMessageStream, onStatus } = {}) {
  if (!config || typeof config !== 'object') throw new TypeError('Stream configuration is required');
  if (typeof onMessageStream !== 'function') throw new TypeError('Message stream callback is required');
  const tor = streamConfig(config), injected = config.testTransport;
  transportMode(config, injected);
  let node;
  let listener;
  let started = false;
  let closed = false;
  let presenceLookup = lookupPresence;
  let profileService = null;
  const active = new Set();

  const status = value => { try { onStatus?.(value); } catch { /* status hooks cannot affect transport */ } };
  const requireStarted = () => { if (!started || closed || !node) throw failure(); };

  async function openEndpoint(targetMemberId) {
    if (typeof presenceLookup !== 'function') throw new Error('Signed presence lookup is not connected');
    const result = await presenceLookup(targetMemberId);
    const validated = validateBoardPresence(config, targetMemberId, result?.presence ?? result);
    if (!validated) throw failure();
    return validated;
  }

  async function protocolHello(stream, type) {
    await stream.send(jsonFrame({ version: 1, type }, tor.maxHelloBytes));
  }

  async function handleProfile(stream) {
    if (!profileService || typeof profileService.handle !== 'function') throw failure();
    for (let count = 0; count < tor.maxProfileFrames; count++) {
      const request = await stream.receive();
      const response = await profileService.handle(request);
      if (!(response instanceof Uint8Array) || response.length === 0 || response.length > MAX_WIRE_BYTES) throw failure();
      await stream.send(response);
    }
    throw failure();
  }

  async function handleIncoming(stream) {
    stream = ownerOf(stream, active);
    let handedOff = false;
    try {
      const hello = boundedJson(await stream.receive(), tor.maxHelloBytes);
      exact(hello, ['version', 'type'], 'Stream hello');
      if (hello.version !== 1 || (hello.type !== 'profile' && hello.type !== 'conversation')) throw failure();
      if (hello.type === 'profile') await handleProfile(stream);
      else {
        handedOff = true;
        try { await onMessageStream(stream, { type: 'conversation' }); }
        catch (error) { stream.close(); active.delete(stream); throw error; }
      }
    } catch {
      if (!handedOff) stream.close();
    } finally {
      if (!handedOff) active.delete(stream);
    }
  }

  async function acceptLoop() {
    while (!closed) {
      try {
        const stream = await listener.accept();
        void handleIncoming(stream);
      } catch {
        if (!closed) status({ status: 'degraded' });
        break;
      }
    }
  }

  async function start() {
    if (started) return { host: listener.host, port: listener.port };
    if (closed) throw failure();
    status({ status: 'starting' });
    try {
      node = injected ?? await createTorJsOnionNode({ gateway: tor.gateway, storage: tor.storage,
        bootstrapDeadlineMs: tor.bootstrapDeadlineMs, operationDeadlineMs: tor.operationDeadlineMs });
      listener = await node.listen({ port: tor.listenPort, maximumStreams: tor.maximumStreams, deadlineMs: tor.acceptDeadlineMs });
      started = true;
      status({ status: 'online', host: listener.host, port: listener.port });
      void acceptLoop();
      return { host: listener.host, port: listener.port };
    } catch (error) {
      status({ status: 'offline' });
      try { node?.close?.(); } catch {}
      node = null;
      throw error instanceof Error && error.message === 'cmsg:Transport' ? error : failure();
    }
  }

  async function openProfile({ memberId }) {
    requireStarted();
    const target = await openEndpoint(memberId);
    const stream = ownerOf(await node.connect(target.endpoint.host, target.endpoint.port), active);
    let open = true;
    try {
      await protocolHello(stream, 'profile');
      return {
        async exchange(bytes) {
          if (!open) throw failure();
          if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_WIRE_BYTES) throw failure();
          await stream.send(bytes);
          return stream.receive();
        },
        async close() {
          if (!open) return;
          open = false;
          active.delete(stream);
          stream.close();
        }
      };
    } catch (error) {
      open = false; active.delete(stream); stream.close(); throw error;
    }
  }

  async function openConversation({ memberId }) {
    requireStarted();
    const target = await openEndpoint(memberId);
    const stream = ownerOf(await node.connect(target.endpoint.host, target.endpoint.port), active);
    try {
      await protocolHello(stream, 'conversation');
      return { stream, peerDevice: target.peerDevice, endpoint: target.endpoint };
    } catch (error) { active.delete(stream); stream.close(); throw error; }
  }

  async function openLiveConversation({ memberId, inbox, until, key, context, persist }) {
    if (!inbox || typeof inbox.beginLiveSession !== 'function') throw new TypeError('Bound cmsg inbox is required');
    if (!bounded(until, Number.MAX_SAFE_INTEGER) || !(key instanceof Uint8Array) || key.length !== 32
        || !(context instanceof Uint8Array) || context.length === 0 || typeof persist !== 'function') throw new TypeError('Live conversation storage is invalid');
    const opened = await openConversation({ memberId });
    try {
      return await LiveInboxStream.open(opened.stream, inbox, { peerDevice: opened.peerDevice, until, key, context, persist });
    } catch (error) {
      opened.stream.close();
      throw error;
    }
  }

  async function keyAccessRedeem(request) {
    requireStarted();
    if (!config.keyAccessRedeemEndpoint) throw new Error('Anonymous ticket redeemer is not configured');
    exact(request, ['permit', 'challengeDigest', 'expiresAt', 'claim'], 'Anonymous redemption request');
    const target = endpoint(config.keyAccessRedeemEndpoint, 'Ticket redeemer endpoint');
    const stream = ownerOf(await node.connect(target.host, target.port), active);
    try {
      await stream.send(jsonFrame({ request }, tor.maxHelloBytes));
      return boundedJson(await stream.receive(), tor.maxHelloBytes);
    } finally { active.delete(stream); stream.close(); }
  }

  return Object.freeze({
    start,
    memberTransport: Object.freeze({ open: openProfile }),
    openConversation,
    openLiveConversation,
    keyAccessRedeem,
    setProfileService(service) {
      if (!service || typeof service.handle !== 'function') throw new TypeError('Profile key service is invalid');
      profileService = service;
    },
    setLookupPresence(lookup) {
      if (typeof lookup !== 'function') throw new TypeError('Signed presence lookup is invalid');
      presenceLookup = lookup;
    },
    close() {
      if (closed) return;
      closed = true;
      listener?.close?.();
      for (const stream of active) stream.close();
      active.clear();
      try { node?.close?.(); } catch {}
      status({ status: 'offline' });
    }
  });
}

export { LiveInboxStream };
