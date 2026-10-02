import { test, expect } from '@playwright/test';

test('a member changes the handle during the settling-in period', async ({ page }) => {
  await page.goto('/#/arrival');
  await page.getByRole('button', { name: 'Sign in / register' }).click();
  await page.getByLabel('Invitation voucher').fill('VOUCHER-TEST-123');
  await page.getByLabel(/Choose a handle/).fill('settling-member');
  await page.getByRole('button', { name: 'Continue to join' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.getByText('You can change your handle freely during your first 7 days.')).toBeVisible();
  await page.getByLabel('New handle').fill('settled-member');
  await page.getByRole('button', { name: 'Change handle' }).click();
  await expect(page.getByText('Your handle was changed.')).toBeVisible();
});
