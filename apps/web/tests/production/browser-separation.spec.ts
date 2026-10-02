import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';

test('the production bundle excludes the multi-origin development harness', async () => {
  for (const file of await readdir('dist/assets')) {
    if (!/\.(js|map)$/.test(file)) continue;
    const content = await readFile(`dist/assets/${file}`, 'utf8');
    for (const forbidden of ['cmeet-dev-harness', 'createHarnessSession', 'BroadcastChannel']) {
      expect(content, `${file} contains ${forbidden}`).not.toContain(forbidden);
    }
  }
});

test('the member page allows no frame without a configured vault origin', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  expect(html).toContain("frame-src 'none'");
  expect(html).not.toMatch(/localhost/);
});

test('the production vault origin and pop-up are honestly unavailable', async ({ page }) => {
  for (const route of ['http://vault.anna.localhost:4174/', 'http://vault.anna.localhost:4174/#/ceremony/abc']) {
    await page.goto('about:blank');
    await page.goto(route);
    await expect(page.getByText('not available yet')).toBeVisible();
    await expect(page.locator('#app button')).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
  }
});
