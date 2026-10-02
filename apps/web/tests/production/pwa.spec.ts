import { expect, test, type Page } from '@playwright/test';
import { readdir } from 'node:fs/promises';

async function cachedUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const keys = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
    return keys.flat().map((request) => request.url);
  });
}

async function swText(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')!.getAttribute('href')!;
    const base = new URL(href, window.location.href);
    const worker = new URL('sw.js', base).href;
    return (await fetch(worker)).text();
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
  await context.setOffline(false);
});

test('the worker caches an exact public allowlist and never query, api or private routes', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await page.reload();

  const worker = await swText(page);
  expect(worker).toContain('cmeet-shell-');
  expect(worker).toContain('SKIP_WAITING');
  expect(worker).not.toMatch(/addEventListener\(['"]install['"][\s\S]{0,400}skipWaiting\(\)/i);
  expect(worker).not.toMatch(/startsWith\(.*assets/i);
  expect(worker).not.toMatch(/\(\.\*|\\\.\*|\[.\^/);

  const origin = await page.evaluate(() => window.location.origin);
  const assets = await readdir('dist/assets');
  const expected = new Set([
    `${origin}/`,
    `${origin}/index.html`,
    `${origin}/manifest.webmanifest`,
    `${origin}/icon.svg`,
    `${origin}/icon-192.png`,
    `${origin}/icon-512.png`,
    `${origin}/apple-touch-icon.png`,
    ...assets.map((file) => `${origin}/assets/${file}`),
  ]);
  const cached = await cachedUrls(page);
  expect(cached.length).toBeGreaterThan(0);
  for (const url of cached) {
    expect(url.startsWith(origin), url).toBe(true);
    expect(new URL(url).search, url).toBe('');
    expect(expected.has(url), url).toBe(true);
  }

  await page.evaluate(async () => {
    await fetch('./index.html?probe=1').catch(() => {});
    await fetch('./not-an-app-file/?probe=1').catch(() => {});
    await fetch('/api/probe').catch(() => {});
  });
  const after = await cachedUrls(page);
  expect(after.some((url) => new URL(url).search !== '')).toBe(false);
  expect(after.join('\n')).not.toContain('/api/');
  expect(after.join('\n')).not.toContain('not-an-app-file');
});
