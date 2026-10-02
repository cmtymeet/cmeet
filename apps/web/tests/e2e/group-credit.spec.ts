import { test, expect } from '@playwright/test';
import { enterCommunity } from './flows.js';

test('introducing two members shows a receipt and no early credit', async ({ page }) => {
  await enterCommunity(page);
  await page.evaluate(() => { location.hash = '#/groups/group-garden'; });
  await expect(page.getByRole('heading', { name: 'Introduce two members' })).toBeVisible();
  await expect(page.getByText('Credit pending')).toHaveCount(0);
  await page.getByLabel('First member').selectOption({ index: 1 });
  await page.getByLabel('Second member').selectOption({ index: 2 });
  await page.getByRole('button', { name: 'Introduce', exact: true }).click();
  await expect(page.getByText('Credit pending.')).toBeVisible();
});
