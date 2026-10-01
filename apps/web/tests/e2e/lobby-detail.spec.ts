import { test, expect } from '@playwright/test';

// Lobby detail: resumable active gates, separate profile entry, devices link,
// no-return warning and forum entry only once the backend admits the member.
test('lobby shows active steps and admits after the profile is published', async ({ page }) => {
  await page.goto('/#/arrival');
  await expect(page.getByRole('heading', { name: 'Good conversations start with the right people.' })).toBeVisible({
    timeout: 15000,
  });
  await page.getByLabel('Invitation voucher').fill('VOUCHER-TEST-123');
  await page.getByLabel(/Choose a handle/).fill('lobby-detail');
  await page.getByRole('button', { name: 'Continue to join' }).click();

  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Active requirements' })).toBeVisible();
  await expect(page.getByText('Complete the remaining requirements in any order.')).toBeVisible();
  await expect(page.getByText('Action needed')).toBeVisible();
  await expect(page.getByText('cannot return')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enter forum when admitted' })).toBeDisabled();

  // Profile entry stays separate from the gates; devices link out.
  await expect(page.getByRole('link', { name: 'Complete profile' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Manage devices' })).toBeVisible();
  await page.getByRole('link', { name: 'Complete profile' }).click();
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible();
  await page.locator('#profile-age').fill('34');
  await page.locator('#profile-neighbourhood').selectOption('North');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile published and checked.')).toBeVisible();

  // Resume the lobby: the backend admission alone enables forum entry.
  await page.getByRole('link', { name: 'Lobby' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enter forum when admitted' })).toBeEnabled();
  await page.getByRole('button', { name: 'Enter forum when admitted' }).click();
  await expect(page.getByRole('heading', { name: 'Discover' })).toBeVisible();
});
