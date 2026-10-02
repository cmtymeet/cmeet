// Build-time service-worker finalizer for the cmeet web shell.
//
// public/sw.js is the single worker template: this plugin only replaces the
// marked CACHE and FILES spans in the built copy (dist/sw.js) and never forks
// the implementation. The shipped worker keeps the exact allowlist: the fixed
// public shell files plus the emitted immutable asset filenames (hashed
// js/css/fonts, including lazy chunks and CSS).
//
// The cache name hashes every fixed public file's bytes (icons and the
// manifest included) plus the emitted asset names, which embed content
// hashes, plus the built index.html. A missing fixed file, index.html or
// template fails the build instead of silently weakening the cache identity,
// so old HTML never mixes with deleted chunks. Updates never skipWaiting over
// active sessions on their own; clients opt in with a SKIP_WAITING message.

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

const CACHE_SPAN_PATTERN = /\/\*__PWA_CACHE_BEGIN__\*\/[\s\S]*?\/\*__PWA_CACHE_END__\*\//;
const FILES_SPAN_PATTERN = /\/\*__PWA_FILES_BEGIN__\*\/[\s\S]*?\/\*__PWA_FILES_END__\*\//;

export interface ShellContent {
  path: string;
  bytes: Uint8Array;
}

export function computeShellVersion(contents: ShellContent[]): string {
  const ordered = [...contents].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash('sha256');
  for (const entry of ordered) {
    hash.update(entry.path);
    hash.update(entry.bytes);
  }
  return hash.digest('hex').slice(0, 12);
}

export function renderShellWorker(
  template: string,
  cacheName: string,
  files: readonly string[],
): string {
  if (!CACHE_SPAN_PATTERN.test(template)) {
    throw new Error('pwa shell template lost its CACHE markers');
  }
  if (!FILES_SPAN_PATTERN.test(template)) {
    throw new Error('pwa shell template lost its FILES markers');
  }
  return template
    .replace(CACHE_SPAN_PATTERN, () => JSON.stringify(cacheName))
    .replace(FILES_SPAN_PATTERN, () => JSON.stringify([...files], null, 2));
}

function fixedEntryToFile(entry: string): string {
  return entry === './' ? 'index.html' : entry.replace(/^\.\//, '');
}

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
      const contents: ShellContent[] = [];
      for (const entry of PWA_SHELL_FIXED) {
        let bytes: Uint8Array;
        try {
          bytes = await readFile(join(outDir, fixedEntryToFile(entry)));
        } catch {
          throw new Error(`pwa shell build is missing fixed public file: ${entry}`);
        }
        contents.push({ path: entry, bytes });
      }
      for (const name of emitted) {
        contents.push({ path: name, bytes: new TextEncoder().encode(name) });
      }
      let indexHtml: string;
      try {
        indexHtml = await readFile(join(outDir, 'index.html'), 'utf8');
      } catch {
        throw new Error('pwa shell build is missing index.html');
      }
      contents.push({ path: 'index.html', bytes: new TextEncoder().encode(indexHtml) });
      const version = computeShellVersion(contents);
      let template: string;
      try {
        template = await readFile(join(outDir, 'sw.js'), 'utf8');
      } catch {
        throw new Error('pwa shell build is missing the sw.js template');
      }
      await writeFile(
        join(outDir, 'sw.js'),
        renderShellWorker(template, PWA_CACHE_PREFIX + version, [...PWA_SHELL_FIXED, ...emitted]),
        'utf8',
      );
    },
  };
}
