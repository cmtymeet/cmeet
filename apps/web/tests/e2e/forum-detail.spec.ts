import { test, expect } from '@playwright/test';

async function joinAndPublish(page: import('@playwright/test').Page) {
  await page.goto('/#/arrival');
  await expect(page.getByRole('heading', { name: 'Good conversations start with the right people.' })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Sign in / register' }).click();
  await page.getByLabel('Invitation voucher').fill('VOUCHER-TEST-123');
  await page.getByLabel(/Choose a handle/).fill('e2e-member');
  await page.getByRole('button', { name: 'Continue to join' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await page.locator('#profile-age').fill('34');
  await page.locator('#profile-neighbourhood').selectOption('North');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile published and checked.')).toBeVisible();
}

function card(page: import('@playwright/test').Page, handle: string) {
  return page.getByRole('article', { name: `Public profile of ${handle}` });
}

// Forum detail: schema filters, key exchange preview, first wave.
// Discovery cards are scoped by article; the exchange history list is separate.
test('forum discovery filters, key exchange and first wave', async ({ page }) => {
  await joinAndPublish(page);

  await page.getByRole('link', { name: 'Discover' }).click();
  await expect(page.getByRole('heading', { name: 'Discover' })).toBeVisible();
  await expect(card(page, 'ana-walks')).toBeVisible();

  // Schema-defined choice, number and location distance controls exist.
  await expect(page.getByLabel('Which neighbourhood do you live in?')).toBeVisible();
  await expect(page.getByLabel('How old are you? (from)')).toBeVisible();
  await expect(page.getByLabel('How old are you? (to)')).toBeVisible();
  await expect(page.getByLabel('Where do you usually meet? (within km)')).toBeVisible();

  // Viewing cards alone raises no key notice.
  await expect(page.getByText(/Key accepted|Not a match/)).toHaveCount(0);

  // Two-way choice filter narrows the cards; clearing restores them.
  await page.getByLabel('Which neighbourhood do you live in?').selectOption('East');
  await expect(card(page, 'tom-cooks')).toBeVisible();
  await expect(card(page, 'ana-walks')).toHaveCount(0);
  await page.getByLabel('Which neighbourhood do you live in?').selectOption('');
  await expect(card(page, 'ana-walks')).toBeVisible();

  // Location distance narrows without the UI computing anything.
  await page.getByLabel('Where do you usually meet? (within km)').fill('5');
  await expect(card(page, 'ana-walks')).toBeVisible();
  await page.getByLabel('Where do you usually meet? (within km)').fill('');
  await expect(card(page, 'ana-walks')).toBeVisible();

  // Key release is automatic by rules; an accepted key shows the shared preview.
  await page.getByRole('button', { name: 'Want to know more' }).first().click();
  await expect(page.getByText(/Key accepted|Not a match/)).toBeVisible();
  await expect(page.getByText('Private profile exchanges')).toBeVisible();

  // The first wave composer sends through sendWave and reports the outcome once.
  await page.getByRole('button', { name: 'Write first wave' }).first().click();
  await page.getByLabel('First wave message').first().fill('Hello from the forum e2e!');
  await page.getByRole('button', { name: 'Send wave' }).click();
  await expect(page.getByText(/Wave sent\. Status:/)).toHaveCount(1);
});
