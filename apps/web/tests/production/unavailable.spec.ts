import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';

test('production cannot enter the development community', async ({ page }) => {
  for (const route of ['/', '/?dev-connect-delay=1#/forum', '/#/root']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: 'cmeet is not available yet' })).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByRole('button')).toHaveCount(0);
  }
});

test('the production bundle excludes development adapter code and sources', async () => {
  const files = await readdir('dist/assets');
  for (const file of files) {
    if (!/\.(js|map)$/.test(file)) continue;
    const content = await readFile(`dist/assets/${file}`, 'utf8');
    expect(content, file).not.toContain('dev-adapter');
    expect(content, file).not.toContain('createDevCmsg');
  }
});

test('the offline shell cache excludes other routes', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'cmeet is not available yet' })).toBeVisible();
  await page.evaluate(async () => { await fetch('/not-an-app-file/'); });
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const requests = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
    return requests.flat().map((request) => new URL(request.url).pathname);
  });
  expect(cached).not.toContain('/not-an-app-file/');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'cmeet is not available yet' })).toBeVisible();
});
