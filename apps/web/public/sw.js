/* Cache only public application files, never API responses or member data. */
const PREFIX = 'cmeet-shell-';
const CACHE = `${PREFIX}v2`;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg'];
const shellUrls = new Set(SHELL.map((path) => new URL(path, self.registration.scope).href));
const assetsUrl = new URL('./assets/', self.registration.scope);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
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
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || url.search) return;
  const isShell = shellUrls.has(url.href);
  const isAsset = url.href.startsWith(assetsUrl.href) && /\.(js|css|svg|woff2?)$/.test(url.pathname);
  if (!isShell && !isAsset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type === 'basic' &&
          !/no-store|private/i.test(response.headers.get('cache-control') ?? '')) {
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      throw error;
    }
  })());
});
