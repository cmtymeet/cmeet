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
  await page.getByRole('link', { name: 'Profile' }).click();
  await page.locator('#profile-age').fill('34');
  await page.locator('#profile-neighbourhood').selectOption('North');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile published and checked.')).toBeVisible();
}

// Forum discovery with two-way filters, key request, wave answer, chat.
test('forum, waves and one-to-one chat', async ({ page }) => {
  await joinAndPublish(page);

  await page.getByRole('link', { name: 'Discover' }).click();
  await expect(page.getByRole('heading', { name: 'Discover' })).toBeVisible();
  await expect(page.getByText('ana-walks')).toBeVisible();

  // Two-way filters on real values narrow the list.
  await page.getByLabel('Which neighbourhood do you live in?').selectOption('East');
  await expect(page.getByText('tom-cooks')).toBeVisible();
  await expect(page.getByText('ana-walks')).not.toBeVisible();
  await page.getByLabel('Which neighbourhood do you live in?').selectOption('');

  // Key release is automatic by rules; look-back is explained.
  await page.getByRole('button', { name: 'Want to know more' }).first().click();
  await expect(page.getByText(/Key accepted|Not a match/)).toBeVisible();

  // An incoming wave can be answered, which opens the conversation.
  await page.getByRole('link', { name: /First contact/ }).click();
  await expect(page.getByRole('heading', { name: 'First contact', exact: true })).toBeVisible();
  await page.getByLabel('Your reply').fill('Hello! A walk sounds good.');
  await page.getByRole('button', { name: 'Answer', exact: true }).click();
  await expect(page.getByText('Status: answered')).toBeVisible();

  // Contacts show the established relation; chat carries the thread.
  await page.getByRole('link', { name: 'Contacts' }).click();
  await expect(page.getByText('tom-cooks')).toBeVisible();
  await page.getByRole('button', { name: 'Open chat' }).first().click();
  await expect(page.getByLabel('Write a message')).toBeVisible();
  await page.getByLabel('Write a message').fill('See you on Saturday?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('See you on Saturday?')).toBeVisible();
});
