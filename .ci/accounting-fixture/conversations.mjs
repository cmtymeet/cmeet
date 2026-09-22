// Production controller, real Workers and signed AccountService. Only the
// framed transport and trusted CI clock are scripted; no proof verdict is injected.
import { createConversations } from '../../src/lib/conversations.js';

const assert = (value, label) => { if (!value) throw new Error(`Production conversations: ${label}`); };
const marker = bytes => BigInt('0x' + bytes.map(value => value.toString(16).padStart(2, '0')).join('')).toString();
function serializedStore(storage) {
  let mutation = Promise.resolve();
  return Object.freeze({
    async read() { await mutation; return storage.read(); },
    update(transform) {
      const next = mutation.catch(() => {}).then(() => storage.update(transform));
      mutation = next.catch(() => {}); return next;
    },
  });
}
async function bounded(operation, milliseconds, label) {
  let timer;
  try { return await Promise.race([operation(), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Production conversations deadline: ${label}`)), milliseconds);
  })]); }
  finally { clearTimeout(timer); }
}

export async function runProductionConversations({ clients, config, request, createTransport, check, stage }) {
  assert(clients.length === 2, 'reuse exactly two existing accounts');
  const deadline = 600_000, endpoints = new Set(), accepting = new Set(), controllers = [];
  const views = clients.map(() => ({ conversations: [], messages: [] }));
  const stores = clients.map(value => serializedStore(value.store));
  const ids = clients.map(value => value.memberId);
  const settings = { ...config, messaging: { maxConversations: 1, maxPendingInvitations: 1,
    maxMessages: 8, maxMessageBytes: 256, liveSessionSeconds: 300,
    handshakeDeadlineMs: deadline, maxQueuedFrames: 16, keepaliveMs: 1000 },
    tor: { operationDeadlineMs: 30_000 } };
  const record = async index => (await stores[index].read()).conversations?.[ids[1 - index]];
  async function waitFor(label, predicate) {
    let polling = true;
    try {
      return await stage(label, () => bounded(async () => {
        while (polling) {
          const value = await predicate(); if (value) return value;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }, deadline, label));
    } catch (error) {
      for (const index of [0, 1]) {
        const value = await record(index);
        const phase = /^[a-zA-Z]{1,32}$/.test(value?.phase ?? '') ? value.phase : 'unknown';
        await window.fixtureStage(`controller ${index + 1}: ${phase}; online=${views[index].conversations[0]?.online === true}; settled=${value?.settled === true}`);
      }
      throw error;
    } finally { polling = false; }
  }
  function openStream(index, member) {
    assert(member === ids[1 - index], 'only the other authenticated member is routed');
    assert(endpoints.size === 0, 'this contract opens exactly one framed connection');
    const pair = createTransport(); pair.forEach(endpoint => endpoints.add(endpoint));
    const incoming = controllers[1 - index].acceptStream(pair[1]);
    accepting.add(incoming);
    incoming.finally(() => accepting.delete(incoming)).catch(() => {});
    return { stream: pair[0] };
  }
  try {
    await stage('retire raw fixture Workers before production ownership', async () => {
      for (const value of clients) await value.session.close();
    });
    await window.fixtureControl('beginConversations');
    for (const [index, value] of clients.entries()) {
      controllers.push(await createConversations({ api: { request }, store: stores[index],
        wallet: value.wallet, device: value.device, authority: value.authority, config: settings,
        openStream: member => openStream(index, member),
        onConversations: values => { views[index].conversations = structuredClone(values); },
        onMessages: values => { views[index].messages = structuredClone(values); },
      }));
    }
    const baseline = [];
    for (const [index, controller] of controllers.entries()) {
      const started = await stage(`restore production account ${index + 1}`, () => controller.start());
      assert(started.status === 'eligible' && started.acceptedVersion > 0, 'accepted account restored without genesis');
      const maintained = await stage(`refresh production account ${index + 1}`, () => controller.maintain());
      assert(maintained.status === 'eligible' && maintained.currentRootAccepted === true, 'real successor accepts current roster');
      baseline.push(maintained.acceptedVersion);
    }
    await check(true, 'production conversation controllers reuse both encrypted accepted accounts');
    await stage('production controller opens invitation', () => controllers[0].open(ids[1]));
    await waitFor('production invitation awaits recipient consent', async () => {
      const [a, b] = await Promise.all([record(0), record(1)]);
      return a?.phase === 'awaitingPeer' && b?.phase === 'awaitingAcceptance';
    });
    let rejected = false;
    try { await controllers[0].send('Must not be released before consent'); } catch { rejected = true; }
    await check(rejected && (await record(0)).messages.length === 0 && (await record(1)).messages.length === 0,
      'production consent gate releases no application message before acceptance');
    await controllers[1].open(ids[0]); // Select the existing pending recipient row.
    await stage('recipient consents through actual production reservations', () =>
      bounded(() => controllers[1].answer(), deadline, 'recipient consent'));
    await waitFor('production live sessions authenticate both peers', () => views.every(value =>
      value.conversations.length === 1 && value.conversations[0].online && !value.conversations[0].pendingContact));
    const introduction = 'Hello from the production conversation controller.';
    await stage('production initiator sends first encrypted message', () =>
      bounded(() => controllers[0].send(introduction), deadline, 'first message'));
    await waitFor('production recipient authenticates first message', async () => {
      const value = await record(1);
      return value?.introReceived && value.messages.length === 1
        && value.messages[0].direction === 'incoming' && value.messages[0].text === introduction;
    });
    await check(views[1].messages.length === 1 && views[1].messages[0].text === introduction,
      'production message callback exposes the authenticated first plaintext');
    const reply = 'This authenticated reply answers the first contact.';
    await stage('production recipient sends genuine Answer reply', () =>
      bounded(() => controllers[1].send(reply), deadline, 'Answer reply'));
    await waitFor('both real account proofs settle production Answer', async () => {
      const [a, b] = await Promise.all([record(0), record(1)]);
      return a?.settled === true && b?.settled === true && a.messages.length === 2 && b.messages.length === 2;
    });
    const saved = await Promise.all([record(0), record(1)]), final = [];
    await check(saved[0].messages[1].direction === 'incoming' && saved[0].messages[1].text === reply
      && saved[1].messages[1].direction === 'outgoing' && saved[1].messages[1].text === reply
      && saved[0].peerReceipt?.resolution?.kind === 'answered' && saved[1].ownReceipt?.resolution?.kind === 'answered'
      && saved[0].ownAcknowledgment && saved[1].peerAcknowledgment,
    'production reply exchanges genuine Answer receipt and initiator acknowledgment');
    for (const [index, controller] of controllers.entries()) {
      const account = await stage(`verify production Answer account ${index + 1}`, () => controller.maintain());
      await window.fixtureControl('verifyAcceptance', account.accepted);
      await check(account.acceptedVersion === baseline[index] + 3
        && marker(account.accepted.statement.settlementMarker) === saved[index].event
        && account.slots.some(slot => slot.event === saved[index].event && slot.phase === 3),
      `signed native acceptance confirms production account ${index + 1} reserved, activated and settled its Answer`);
      final.push(account.acceptedVersion);
    }
    await window.fixtureControl('verifyConversations');
    return { accountsReused: 2, newGenesis: 0, messages: 2, answerSettlements: 2,
      acceptedVersionsBefore: baseline, acceptedVersionsAfter: final,
      transport: 'bounded scripted frames; production createConversations, cmsg MLS and cfrm proofs',
      excluded: ['Tor', 'UI', 'voucher eligibility', 'reconnect'] };
  } finally {
    for (const endpoint of endpoints) endpoint.close();
    const closing = await bounded(() => Promise.allSettled(controllers.map(value => value.close())),
      config.accounting.workerDeadlineMs + 10_000, 'controller shutdown');
    await Promise.allSettled([...accepting]);
    assert(closing.every(value => value.status === 'fulfilled'), 'production controllers close cleanly');
  }
}
