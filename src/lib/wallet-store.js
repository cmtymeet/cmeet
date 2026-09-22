import { sealLocalState, openLocalState } from '@corbet-labs/cvld/client';

const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_STATE_BYTES = 4_194_304;

/** Private application records are one encrypted value. The transaction checks
 * the version observed before encryption; concurrent tabs cannot overwrite an
 * accepted successor. A failed CAS requires reloading, never a blind retry. */
export async function openWalletStore({ wallet, communityId, memberId }) {
  const scope = JSON.stringify(['cmeet.wallet.v1', communityId, memberId]);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(scope)));
  const id = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
  const context = `cmeet.wallet.v1/${id}`;
  const key = await wallet.storageKey('application-state');
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('cmeet-encrypted-application', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Private storage could not open'));
  });
  let closed = false, writing = false;
  const check = () => { if (closed) throw new Error('Private storage is closed'); };
  async function read() {
    check();
    const row = await new Promise((resolve, reject) => {
      const transaction = database.transaction('state', 'readonly');
      const request = transaction.objectStore('state').get(id);
      transaction.oncomplete = () => resolve(request.result ?? null);
      transaction.onabort = transaction.onerror = () => reject(new Error('Private storage read failed'));
    });
    check();
    if (!row) return { version: 0, value: {} };
    if (!Number.isSafeInteger(row.version) || row.version < 1) throw new Error('Private storage record rejected');
    if (JSON.stringify(row.envelope).length > MAX_STATE_BYTES * 2) throw new Error('Private storage record too large');
    const plaintext = await openLocalState({ envelope: row.envelope, key, context });
    try {
      if (plaintext.length > MAX_STATE_BYTES) throw new Error('Private storage record too large');
      const value = JSON.parse(decoder.decode(plaintext));
      if (value.version !== row.version || !value.state || typeof value.state !== 'object' || Array.isArray(value.state)) throw new Error('Private storage record rejected');
      check();
      return { version: row.version, value: value.state };
    } finally { plaintext.fill(0); }
  }
  return Object.freeze({
    async read() { return (await read()).value; },
    async update(transform) {
      check();
      if (writing || typeof transform !== 'function') throw new Error('Private storage is busy');
      writing = true;
      try {
        const previous = await read();
        const next = transform(structuredClone(previous.value));
        if (!next || typeof next !== 'object' || typeof next.then === 'function' || Array.isArray(next)) throw new Error('Private state update rejected');
        const version = previous.version + 1;
        if (!Number.isSafeInteger(version)) throw new Error('Private storage version exceeded');
        const plaintext = encoder.encode(JSON.stringify({ version, state: next }));
        let envelope;
        try {
          if (plaintext.length > MAX_STATE_BYTES) throw new Error('Private state too large');
          envelope = await sealLocalState({ data: plaintext, key, context });
        } finally { plaintext.fill(0); }
        check();
        await new Promise((resolve, reject) => {
          const transaction = database.transaction('state', 'readwrite', { durability: 'strict' });
          const store = transaction.objectStore('state');
          const request = store.get(id);
          request.onsuccess = () => {
            if ((request.result?.version ?? 0) !== previous.version) { transaction.abort(); return; }
            store.put({ version, envelope }, id);
          };
          transaction.oncomplete = resolve;
          transaction.onabort = transaction.onerror = () => reject(new Error('Private storage changed in another session; unlock again'));
        });
        return structuredClone(next);
      } finally { writing = false; }
    },
    close() { closed = true; key.fill(0); database.close(); },
  });
}
