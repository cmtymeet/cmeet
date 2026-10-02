/* cmeet offline shell — single template for development and production.
 *
 * The CACHE and FILES constants below serve local development. The production
 * build (apps/web/build/pwa.ts) replaces only the marked spans with a
 * content-derived cache name and the exact allowlist (fixed public shell plus
 * emitted immutable assets). Both paths share this one implementation.
 *
 * Caches ONLY the exact files in FILES: never API responses or member data.
 * Precache validates every file (ok/basic/non-redirect, no private/no-store
 * headers) and rejects the install when anything is unsafe, so no partial
 * closure is ever installed. Navigation is network-first and only for the
 * allowlisted shell documents (root/index.html; hash routes never change the
 * path). Unknown, API or private paths and every query request are left
 * entirely untouched.
 */
const PREFIX = 'cmeet-shell-';
const CACHE = /*__PWA_CACHE_BEGIN__*/'cmeet-shell-static-v1'/*__PWA_CACHE_END__*/;
const FILES = /*__PWA_FILES_BEGIN__*/[
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
]/*__PWA_FILES_END__*/;
const fileUrls = new Set(FILES.map((path) => new URL(path, self.registration.scope).href));
const shellDocument = new URL('./index.html', self.registration.scope).href;
// Shell documents by path, so hash routes (same path) keep working while
// unknown, API or private paths are never answered with app HTML.
const shellPaths = new Set(
  ['./', './index.html'].map((path) => new URL(path, self.registration.scope).pathname),
);

function isCacheable(response) {
  return response.ok && response.type === 'basic' && !response.redirected &&
    !/no-store|private/i.test(response.headers.get('cache-control') || '');
}

async function precacheAll() {
  const cache = await caches.open(CACHE);
  await Promise.all(FILES.map(async (path) => {
    const url = new URL(path, self.registration.scope).href;
    // Precache carries no member credentials and never reuses HTTP cache.
    const response = await fetch(new Request(url, { credentials: 'omit', cache: 'no-store' }));
    if (!isCacheable(response)) throw new Error('Refusing to install unsafe shell file: ' + path);
    await cache.put(url, response);
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAll());
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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;
  if (url.search) return;
  if (event.request.mode === 'navigate') {
    if (!shellPaths.has(url.pathname)) return;
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
