import { test, expect } from '@playwright/test';

test('pairing review, rename and removal are separate actions', async ({ page }) => {
  await page.goto('/#/arrival');
  await page.getByRole('button', { name: 'Sign in / register' }).click();
  await page.getByLabel('Invitation voucher').fill('VOUCHER-TEST-123');
  await page.getByLabel(/Choose a handle/).fill('device-member');
  await page.getByRole('button', { name: 'Continue to join' }).click();
  await page.getByRole('link', { name: 'Devices', exact: true }).click();
  await page.getByLabel('Device name', { exact: true }).fill('Tablet');
  await page.getByRole('button', { name: 'Add a device' }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'Tablet' });
  await expect(row).toContainText('Waiting for approval');
  await row.getByRole('button', { name: 'Review pairing' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toContainText('Waiting for approval');
  await row.getByRole('button', { name: 'Review pairing' }).click();
  await page.getByRole('button', { name: 'Approve device', exact: true }).click();
  await expect(row).toContainText('Active');
  await row.getByRole('button', { name: 'Rename', exact: true }).click();
  await row.getByLabel('Device name').fill('Spare tablet');
  await row.getByRole('button', { name: 'Save name' }).click();
  const renamed = page.getByRole('listitem').filter({ hasText: 'Spare tablet' });
  await renamed.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove device', exact: true }).click();
  await expect(renamed).toHaveCount(0);
});
