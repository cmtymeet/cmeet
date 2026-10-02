import { expect, test, type Page } from '@playwright/test';

async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
}

test('member screens remain usable at 320px with keyboard navigation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/#/arrival');
  await expect(page.getByRole('button', { name: 'Sign in / register' })).toBeVisible();
  await fits(page);
  await page.getByRole('button', { name: 'Sign in / register' }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Invitation voucher').fill('VOUCHER-TEST-123');
  await page.getByLabel(/Choose a handle/).fill('mobile-member');
  await page.getByRole('button', { name: 'Continue to join' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  await fits(page);
  await page.getByRole('link', { name: 'Profile', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.locator('#profile-age').fill('34');
  await page.locator('#profile-neighbourhood').selectOption('North');
  await fits(page);
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile published and checked.')).toBeVisible();
  await page.getByRole('link', { name: 'Discover', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Discover' })).toBeVisible();
  await fits(page);
  await page.getByRole('link', { name: 'Groups', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible();
  await fits(page);
  await page.getByRole('article', { name: /Saturday market/ }).getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await fits(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
