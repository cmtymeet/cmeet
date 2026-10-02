import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const FIXED_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

function fixedFile(entry: string): string {
  return entry === './' ? 'index.html' : entry.replace(/^\.\//, '');
}

interface ShellContent {
  path: string;
  bytes: Buffer;
}

function shellVersion(contents: ShellContent[]): string {
  // Mirrors apps/web/build/pwa.ts so CI independently verifies that the
  // shipped cache name derives from the fixed file contents, the emitted
  // asset names and the built index.html.
  const ordered = [...contents].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash('sha256');
  for (const entry of ordered) {
    hash.update(entry.path);
    hash.update(entry.bytes);
  }
  return hash.digest('hex').slice(0, 12);
}

async function builtShell(): Promise<{ cache: string; files: string[] }> {
  const source = await readFile('dist/sw.js', 'utf8');
  const cache = source.match(/const CACHE = "([^"]+)"/)?.[1];
  const files: unknown = JSON.parse(source.match(/const FILES = (\[[\s\S]*?\]);/)?.[1] ?? 'null');
  expect(cache, 'built worker cache name').toBeTruthy();
  expect(Array.isArray(files), 'built worker file allowlist').toBe(true);
  return { cache: cache as string, files: files as string[] };
}

async function cachedUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const keys = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
    return keys.flat().map((request) => request.url);
  });
}

test('installability metadata, icon sizes and home-screen help', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#install')).toHaveCount(1);

  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  expect(manifestHref).toContain('manifest.webmanifest');
  const appleHref = await page.getAttribute('link[rel="apple-touch-icon"]', 'href');
  expect(appleHref).toContain('apple-touch-icon.png');

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')!.getAttribute('href')!;
    return (await fetch(href)).json();
  });
  expect(manifest.id).toBeTruthy();
  expect(manifest.start_url).toBe('./');
  expect(manifest.scope).toBe('./');
  expect(manifest.display).toBe('standalone');
  const icons = new Map<string, { src: string; type: string }>(
    manifest.icons.map((icon: { sizes: string; src: string; type: string }) => [icon.sizes, icon]),
  );
  expect(icons.get('192x192')?.src).toContain('icon-192.png');
  expect(icons.get('512x512')?.src).toContain('icon-512.png');
  expect(icons.get('180x180')?.src).toContain('apple-touch-icon.png');
  for (const icon of icons.values()) {
    expect(icon.type).toBe('image/png');
  }

  for (const [src, size] of [
    ['./icon-192.png', 192],
    ['./icon-512.png', 512],
    ['./apple-touch-icon.png', 180],
  ] as const) {
    const width = await page.evaluate(async (iconSrc) => {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('icon did not load'));
        image.src = iconSrc;
      });
      return image.naturalWidth;
    }, src);
    expect(width, src).toBe(size);
  }

  await expect(page.locator('#install details')).toHaveCount(1);
  await expect(page.locator('#install')).toContainText(/Add to Home Screen/);
  await expect(page.locator('#install')).toContainText(/Share/);
  await expect(page.locator('#install')).toContainText(/browser menu/i);
});

test('a real install event offers a single native action consumed on click', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#install details')).toBeVisible();
  // Synthetic browser install event only: everything after it (real UI
  // reveal, real click, real consumption) runs through the actual component.
  await page.evaluate(() => {
    const pending = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt?: () => Promise<void>;
    };
    (window as unknown as { __pwaPromptCalls?: number }).__pwaPromptCalls = 0;
    pending.prompt = async () => {
      (window as unknown as { __pwaPromptCalls?: number }).__pwaPromptCalls! += 1;
    };
    window.dispatchEvent(pending);
  });
  const action = page.locator('#install button');
  await expect(action).toHaveCount(1);
  await action.click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { __pwaPromptCalls?: number }).__pwaPromptCalls,
        ),
    )
    .toBe(1);
  await expect(action).toHaveCount(0);
});

test('the service worker controls the page and the offline shell stays honest', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'cmeet is not available yet' })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'cmeet is not available yet' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  // Unknown paths never receive offline app HTML.
  await expect(page.goto('/not-an-app-file/')).rejects.toThrow();
  await context.setOffline(false);
});

test('the worker precaches the entire emitted shell and caches nothing else', async ({
  page,
}) => {
  const { cache, files } = await builtShell();
  expect(cache.startsWith('cmeet-shell-')).toBe(true);
  const version = cache.slice('cmeet-shell-'.length);

  const assets = await readdir('dist/assets');
  const contents: ShellContent[] = [];
  for (const entry of FIXED_SHELL) {
    contents.push({ path: entry, bytes: await readFile(`dist/${fixedFile(entry)}`) });
  }
  for (const name of [...assets].sort()) {
    contents.push({ path: `./assets/${name}`, bytes: Buffer.from(`./assets/${name}`) });
  }
  contents.push({ path: 'index.html', bytes: await readFile('dist/index.html') });

  // The shipped version derives from the fixed file contents, the emitted
  // asset names and the built index.html; a changed manifest must move it.
  expect(shellVersion(contents)).toBe(version);
  const tampered = contents.map((entry) =>
    entry.path === './manifest.webmanifest' ? { ...entry, bytes: Buffer.from('{}') } : entry,
  );
  expect(shellVersion(tampered)).not.toBe(version);

  // The allowlist preserves every fixed shell file and every emitted asset.
  expect(files).toEqual([...FIXED_SHELL, ...[...assets].sort().map((name) => `./assets/${name}`)]);

  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await page.reload();

  const origin = await page.evaluate(() => window.location.origin);
  const expected = new Set(files.map((file) => new URL(file, `${origin}/`).href));
  expect(new Set(await cachedUrls(page))).toEqual(expected);

  // Query strings, unknown paths, API routes and non-GET stay uncached.
  await page.evaluate(async () => {
    await fetch('./index.html?probe=1').catch(() => {});
    await fetch('./not-an-app-file/?probe=1').catch(() => {});
    await fetch('/api/probe').catch(() => {});
    await fetch('./index.html', { method: 'POST' }).catch(() => {});
  });
  expect(new Set(await cachedUrls(page))).toEqual(expected);
});
