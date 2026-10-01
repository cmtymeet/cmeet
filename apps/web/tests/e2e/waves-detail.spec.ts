import { test, expect } from '@playwright/test';
import { enterCommunity } from './flows';
test('punishment requires confirmation and cancellation leaves the introduction waiting', async ({ page }) => {
  await enterCommunity(page);
  await page.getByRole('link', { name: /First contact/ }).click();
  await page.getByRole('button', { name: 'Punish', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Both participants spend');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Answer', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Punish', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm punishment' }).click();
  await expect(page.getByText('Status: punished')).toBeVisible();
  await page.getByRole('link', { name: 'Contacts' }).click();
  await expect(page.getByText(/blocked/).last()).toBeVisible();
});
