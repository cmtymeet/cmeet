import { expect, test } from '@playwright/test';

test('network failure stays calm and does not expose an arrival form', async ({ page }) => {
  await page.goto('/?dev-network=failed#/arrival');
  await expect(page.getByRole('heading', { name: 'Connecting' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Try again/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in / register' })).toHaveCount(0);
});

test('malformed route, keyboard skip link and 320px layout', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/#/chat/%E0%A4');
  await expect(page.getByRole('heading', { name: 'Good conversations start with the right people.' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#content')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('portal entry asks for its own passkey sign-in without a member voucher', async ({ page }) => {
  await page.goto('/#/admin');
  await expect(page.getByRole('button', { name: 'Sign in as admin' })).toBeVisible();
  await expect(page.getByLabel('Invitation voucher')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign in as admin' }).click();
  await expect(page.getByRole('heading', { name: 'Live preview' })).toBeVisible();
  await page.evaluate(() => { location.hash = '#/root'; });
  await page.getByRole('button', { name: 'Sign in as root' }).click();
  await expect(page.getByText('Evening choir')).toBeVisible();
});
