import { test, expect } from '@playwright/test';

// Arrival with a voucher, lobby gates, schema-driven profile with preview.
test('voucher arrival, lobby and profile publish', async ({ page }) => {
  // The app preloads the network first and shows a calm connecting screen.
  await page.goto('/?dev-connect-delay=2500#/arrival');
  await expect(page.getByRole('heading', { name: 'Connecting' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Good conversations start with the right people.' })).toBeVisible({
    timeout: 15000,
  });

  // Bad vouchers are refused with a plain message.
  await page.getByRole('button', { name: 'Sign in / register' }).click();
  await page.getByLabel('Invitation voucher').fill('not-a-voucher');
  await page.getByLabel(/Choose a handle/).fill('new-member');
  await page.getByRole('button', { name: 'Continue to join' }).click();
  await expect(page.getByRole('alert')).toContainText('not accepted');

  // A good voucher opens the lobby with the no-return warning.
  await page.getByLabel('Invitation voucher').fill('VOUCHER-TEST-123');
  await page.getByRole('button', { name: 'Continue to join' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  await expect(page.getByText('cannot return')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enter forum when admitted' })).toBeDisabled();

  // The profile editor is driven by the community schema with a live preview.
  await page.getByRole('link', { name: 'Profile' }).click();
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /public profile/ })).toBeVisible();
  await page.locator('#profile-age').fill('34');
  await page.locator('#profile-neighbourhood').selectOption('North');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile published and checked.')).toBeVisible();

  // Now the lobby admits the member into the forum.
  await page.getByRole('link', { name: 'Lobby' }).click();
  await expect(page.getByRole('button', { name: 'Enter forum when admitted' })).toBeEnabled();
});
