import { test, expect } from '@playwright/test';

// Arrival detail: one combined action first, then passkey or voucher paths.
// Both successes hand to the lobby; no extra auth mechanism exists.
test('combined action opens passkey and voucher paths, voucher joins to lobby', async ({
  page,
}) => {
  await page.goto('/?dev-connect-delay=500#/arrival');
  await expect(
    page.getByRole('heading', { name: 'Good conversations start with the right people.' }),
  ).toBeVisible({ timeout: 15000 });

  // Only the combined action is shown at first.
  await expect(page.getByRole('button', { name: 'Sign in / register' })).toBeVisible();
  await expect(page.getByLabel('Invitation voucher')).toHaveCount(0);

  await page.getByRole('button', { name: 'Sign in / register' }).click();
  await expect(page.getByRole('button', { name: 'Sign in with passkey' })).toBeVisible();
  await expect(page.getByLabel('Invitation voucher')).toBeVisible();

  // Empty inputs are refused with a plain message, without joining.
  await page.getByRole('button', { name: 'Continue to join' }).click();
  await expect(page.getByRole('alert').last()).toContainText('voucher');

  // Bad vouchers are refused with a plain message.
  await page.getByLabel('Invitation voucher').fill('not-a-voucher');
  await page.getByLabel(/Choose a handle/).fill('new-member');
  await page.getByRole('button', { name: 'Continue to join' }).click();
  await expect(page.getByRole('alert')).toContainText('not accepted');

  // A good voucher hands to the lobby with the no-return warning.
  await page.getByLabel('Invitation voucher').fill('VOUCHER-TEST-123');
  await page.getByRole('button', { name: 'Continue to join' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  await expect(page.getByText('cannot return')).toBeVisible();
});

test('passkey sign-in without a member explains the voucher path', async ({ page }) => {
  await page.goto('/?dev-connect-delay=500#/arrival');
  await expect(
    page.getByRole('heading', { name: 'Good conversations start with the right people.' }),
  ).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Sign in / register' }).click();
  await page.getByRole('button', { name: 'Sign in with passkey' }).click();
  await expect(page.getByRole('alert')).toContainText('voucher');

  // No extra auth mechanism is offered.
  const buttons = await page.getByRole('button').allTextContents();
  expect(buttons.join(' ')).not.toMatch(/email|recovery|code/i);
});
