import { test, expect } from '@playwright/test';

// Profile detail: separate number rule bounds, field errors with focus,
// honest published state and a picture-free public/private preview.
test('profile rules, errors and published preview', async ({ page }) => {
  await page.goto('/#/arrival');
  await expect(page.getByRole('heading', { name: 'Good conversations start with the right people.' })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Sign in / register' }).click();
  await page.getByLabel('Invitation voucher').fill('VOUCHER-TEST-123');
  await page.getByLabel(/Choose a handle/).fill('profile-member');
  await page.getByRole('button', { name: 'Continue to join' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();

  await page.getByRole('link', { name: 'Profile' }).click();
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible();
  await expect(page.getByText('Not yet published.')).toBeVisible();

  // A new profile starts empty: no 0 in the number box, no combined range.
  await expect(page.locator('#profile-age')).toHaveValue('');
  await expect(page.locator('#rule-age-min')).toBeVisible();
  await expect(page.locator('#rule-age-max')).toBeVisible();
  await expect(page.locator('#rule-age')).toHaveCount(0);

  // Saving empty keeps field errors on the fields and focuses the first one.
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.locator('#profile-age')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#profile-age')).toBeFocused();

  // Fill the schema, set separate rule bounds and publish honestly.
  await page.locator('#profile-age').fill('34');
  await page.locator('#profile-neighbourhood').selectOption('North');
  await page.locator('#rule-age-min').fill('25');
  await page.locator('#rule-age-max').fill('45');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile published and checked.')).toBeVisible();
  await expect(page.getByText(/Published, revision/)).toBeVisible();

  // The preview separates the public front from the private back.
  await expect(page.getByRole('tab', { name: /public profile/ })).toBeVisible();
  await expect(page.getByText('There are no profile pictures')).toBeVisible();
});
