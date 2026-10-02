/* cmeet offline shell (static public copy).
 * Caches ONLY the fixed public files below, never API responses or member
 * data. The production build overwrites dist/sw.js with a generated worker
 * (see apps/web/build/pwa.ts) that adds the exact emitted immutable asset
 * filenames to the allowlist. No wildcard caching lives here or there.
 */
const PREFIX = 'cmeet-shell-';
const CACHE = PREFIX + 'static-v1';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];
const fileUrls = new Set(FILES.map((path) => new URL(path, self.registration.scope).href));
const shellDocument = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isCacheable(response) {
  return response.ok && response.type === 'basic' && !response.redirected &&
    !/no-store|private/i.test(response.headers.get('cache-control') || '');
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;
  if (url.search) return;
  if (event.request.mode === 'navigate') {
    // Network first; the cached shell is the offline fallback only and is
    // never presented as a working connection.
    event.respondWith(fetch(event.request).catch(async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(shellDocument);
      if (cached) return cached;
      throw new Error('offline');
    }));
    return;
  }
  if (!fileUrls.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (isCacheable(response)) await cache.put(event.request, response.clone());
    return response;
  })());
});
