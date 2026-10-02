// Build-time service-worker emitter for the cmeet web shell.
//
// The plugin overwrites dist/sw.js after the public directory is copied, so
// the shipped worker carries an EXACT allowlist: the fixed public shell files
// plus the emitted immutable asset filenames (hashed js/css and fonts). No
// wildcard asset matching, no query strings, no API/member/runtime data, no
// cross-origin, no non-GET, no redirects, no private/no-store responses.
// Navigation stays network-first with the cached shell as the offline
// fallback only. The cache name derives from the emitted filenames plus the
// built index.html, so a new deploy never mixes old HTML with deleted chunks.
// Updates never skipWaiting over active sessions on their own; clients opt in
// with a SKIP_WAITING message.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

export const PWA_CACHE_PREFIX = 'cmeet-shell-';

export const PWA_SHELL_FIXED = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
] as const;

const EMITTED_ASSET_PATTERN = /^assets\/.+\.(js|css|woff2?|svg)$/;

export function pwaShellPlugin(): Plugin {
  return {
    name: 'cmeet-pwa-shell',
    apply: 'build',
    async writeBundle(options, bundle) {
      const outDir = options.dir;
      if (!outDir) throw new Error('pwa shell plugin requires an output directory');
      const emitted = Object.keys(bundle)
        .filter((name) => EMITTED_ASSET_PATTERN.test(name))
        .map((name) => './' + name)
        .sort();
      const hash = createHash('sha256');
      hash.update(JSON.stringify(emitted));
      try {
        hash.update(await readFile(join(outDir, 'index.html'), 'utf8'));
      } catch {
        // Filenames alone still version the cache when index.html is missing.
      }
      const version = hash.digest('hex').slice(0, 12);
      await writeFile(
        join(outDir, 'sw.js'),
        renderShellServiceWorker(PWA_CACHE_PREFIX + version, [...PWA_SHELL_FIXED, ...emitted]),
        'utf8',
      );
    },
  };
}

export function renderShellServiceWorker(cacheName: string, files: readonly string[]): string {
  const allowlist = files.map((file) => JSON.stringify(file)).join(', ');
  return '/* cmeet offline shell (generated at build time).\n' +
    ' * Caches ONLY the exact files listed in FILES below: the fixed public\n' +
    ' * shell plus the emitted immutable asset filenames. Never caches query\n' +
    ' * strings, API/member/runtime data, cross-origin, non-GET, redirects or\n' +
    ' * private/no-store responses. Navigation is network-first with the cached\n' +
    ' * shell as the offline fallback only.\n' +
    ' */\n' +
    "const PREFIX = '" + PWA_CACHE_PREFIX + "';\n" +
    "const CACHE = " + JSON.stringify(cacheName) + ";\n" +
    "const FILES = [" + allowlist + "];\n" +
    'const fileUrls = new Set(FILES.map((path) => new URL(path, self.registration.scope).href));\n' +
    "const shellDocument = new URL('./index.html', self.registration.scope).href;\n" +
    '\n' +
    "self.addEventListener('install', (event) => {\n" +
    '  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));\n' +
    '});\n' +
    '\n' +
    "self.addEventListener('message', (event) => {\n" +
    "  if (event.data === 'SKIP_WAITING') self.skipWaiting();\n" +
    '});\n' +
    '\n' +
    "self.addEventListener('activate', (event) => {\n" +
    '  event.waitUntil(\n' +
    '    caches.keys()\n' +
    "      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE)\n" +
    '        .map((key) => caches.delete(key))))\n' +
    '      .then(() => self.clients.claim()),\n' +
    '  );\n' +
    '});\n' +
    '\n' +
    'function isCacheable(response) {\n' +
    "  return response.ok && response.type === 'basic' && !response.redirected &&\n" +
    "    !/no-store|private/i.test(response.headers.get('cache-control') || '');\n" +
    '}\n' +
    '\n' +
    "self.addEventListener('fetch', (event) => {\n" +
    '  const url = new URL(event.request.url);\n' +
    '  if (url.origin !== self.location.origin) return;\n' +
    "  if (event.request.method !== 'GET') return;\n" +
    '  if (url.search) return;\n' +
    "  if (event.request.mode === 'navigate') {\n" +
    '    event.respondWith(fetch(event.request).catch(async () => {\n' +
    '      const cache = await caches.open(CACHE);\n' +
    '      const cached = await cache.match(shellDocument);\n' +
    '      if (cached) return cached;\n' +
    "      throw new Error('offline');\n" +
    '    }));\n' +
    '    return;\n' +
    '  }\n' +
    '  if (!fileUrls.has(url.href)) return;\n' +
    '  event.respondWith((async () => {\n' +
    '    const cache = await caches.open(CACHE);\n' +
    '    const cached = await cache.match(event.request);\n' +
    '    if (cached) return cached;\n' +
    '    const response = await fetch(event.request);\n' +
    '    if (isCacheable(response)) await cache.put(event.request, response.clone());\n' +
    '    return response;\n' +
    '  })());\n' +
    '});\n';
}
