import { test, expect } from '@playwright/test';

// Opt-in multi-origin harness: UI top-level at anna.localhost, vault frame at
// vault.anna.localhost, sign-in pop-up top-level at the vault origin.
const UI = 'http://anna.localhost:4173';
const VAULT = 'http://vault.anna.localhost:4173';

async function openArrival(page: import('@playwright/test').Page) {
  await page.goto(`${UI}/?dev-vault=1#/arrival`);
  await expect(page.getByRole('heading', { name: 'Good conversations start with the right people.' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Sign in / register' }).click();
  await page.getByLabel('Invitation voucher').fill('VOUCHER-TEST-123');
  await page.getByLabel(/Choose a handle/).fill('vault-member');
  await page.getByRole('button', { name: 'Continue to join' }).click();
}

test('the UI stays top-level and the vault frame holds the client', async ({ page }) => {
  await page.goto(`${UI}/?dev-vault=1#/arrival`);
  await expect(page.getByRole('heading', { name: 'Good conversations start with the right people.' })).toBeVisible({ timeout: 20000 });
  const frames = page.frames();
  expect(frames.some((frame) => frame.url().startsWith(VAULT))).toBe(true);
  expect(page.url().startsWith(UI)).toBe(true);
  const frameElement = await page.locator('iframe.vault-frame').getAttribute('src');
  expect(frameElement).toBe(`${VAULT}/`);
  // Origin isolation: the UI cannot read the vault frame's document.
  expect(await page.evaluate(() => document.querySelector('iframe')!.contentDocument === null)).toBe(true);
});

test('sign-in runs only in a top-level pop-up at the vault origin and hands back a status', async ({ page }) => {
  await openArrival(page);
  const frame = page.frameLocator('iframe.vault-frame');
  await expect(frame.getByText('Press Continue to open the passkey window.')).toBeVisible();
  await expect(page.getByText('Use the Continue button in the secure vault panel')).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  await frame.getByRole('button', { name: 'Continue' }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url().startsWith(`${VAULT}/#/ceremony/`)).toBe(true);
  await expect(popup.getByText('approves nothing real')).toBeVisible();
  await expect(page.getByText('Your passkey window is open')).toBeVisible();
  await popup.getByRole('button', { name: 'Approve (fixture)' }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 20000 });
});

test('closing the pop-up early reports cancelled and Try again works', async ({ page }) => {
  await openArrival(page);
  const frame = page.frameLocator('iframe.vault-frame');
  const first = page.waitForEvent('popup');
  await frame.getByRole('button', { name: 'Continue' }).click();
  await (await first).close();
  await expect(frame.getByText('closed before the sign-in finished')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('The passkey window was closed.')).toBeVisible();
  const second = page.waitForEvent('popup');
  await frame.getByRole('button', { name: 'Try again' }).click();
  const popup = await second;
  await popup.getByRole('button', { name: 'Approve (fixture)' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 20000 });
});

test('the vault origin never shows the member app', async ({ page }) => {
  await page.goto(`${VAULT}/`);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.goto('about:blank');
  await page.goto(`${VAULT}/#/ceremony/`);
  await expect(page.getByText('without a sign-in request')).toBeVisible();
});
