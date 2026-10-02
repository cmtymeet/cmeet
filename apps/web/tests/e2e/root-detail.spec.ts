import { test, expect } from '@playwright/test';

// Root detail: passkey sign-in, community selection, setting modes and admin edits.
// Every change carries the selected community ID; the backend answers are rendered.
test('root sign-in, community settings and admins', async ({ page }) => {
  await page.goto('/#/root');
  await expect(page.getByRole('heading', { name: 'Communities' })).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Sign in as root' }).click();
  await expect(page.getByText('Garden neighbours').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Settings/ })).toBeVisible();
  await expect(page.getByText('Posting pace').first()).toBeVisible();
  await expect(page.getByText('Managed by the platform').first()).toBeVisible();

  // Explicit empty stops inheritance; the backend answer is rendered.
  await page.getByLabel(/Explicit empty/).first().check();
  await page.getByRole('button', { name: 'Save Posting pace' }).click();
  await expect(page.getByText('stops inheritance').first()).toBeVisible();

  // A typed value round-trips through the selected community.
  await page.getByLabel(/Value/).first().check();
  await page.getByLabel(/Value · Posting pace/).fill('daily');
  await page.getByRole('button', { name: 'Save Posting pace' }).click();
  await expect(page.getByText('daily').first()).toBeVisible();

  // Inherit restores the platform value.
  await page.getByLabel(/Inherit/).first().check();
  await page.getByRole('button', { name: 'Save Posting pace' }).click();
  await expect(page.getByText('slow').first()).toBeVisible();

  // Admins are managed by opaque ID only; no member data is shown.
  await expect(page.getByRole('heading', { name: /Admins/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add admin' }).click();
  await expect(page.getByRole('alert')).toContainText('admin ID');
  await page.getByLabel('Admin ID').fill('fixture-admin');
  await page.getByRole('button', { name: 'Add admin' }).click();
  await expect(page.getByText('fixture-admin').first()).toBeVisible();
  await page.getByRole('button', { name: 'Remove fixture-admin' }).click();
  await expect(page.getByText('fixture-admin')).toHaveCount(0);

  // Switching communities loads the other community without member info.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.getByText('weekly').first()).toBeVisible();
  await expect(page.getByText('member-ana')).toHaveCount(0);
});
