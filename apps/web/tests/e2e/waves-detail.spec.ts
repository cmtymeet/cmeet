import { test, expect } from '@playwright/test';
import { enterCommunity } from './flows';
test('introductions can be answered or closed without choosing punishment', async ({ page }) => {
  await enterCommunity(page);
  await page.getByRole('link', { name: /First contact/ }).click();
  await expect(page.getByRole('button', { name: 'Answer', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Punish', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Respectfully close', exact: true }).click();
  await expect(page.getByText('Status: closed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Answer', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
