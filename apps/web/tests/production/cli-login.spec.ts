import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';

test('production CLI login stays unavailable and offers no action', async ({ page }) => {
  await page.goto('/#/cli-login/session=x');
  await expect(page.getByText('not available right now')).toBeVisible();
  await expect(page.locator('#app button')).toHaveCount(0);
});

test('the production bundle excludes the CLI login fixture', async () => {
  for (const file of await readdir('dist/assets')) {
    if (!/\.(js|map)$/.test(file)) continue;
    const content = await readFile(`dist/assets/${file}`, 'utf8');
    expect(content, file).not.toContain('createDevCliLogin');
    expect(content, file).not.toContain('dev-cli-login');
  }
});
