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

// Direct chat detail: API-owned states, close/reopen, confirmed punish, peer change.
test('chat detail states, close, reopen, punish and peer change', async ({ page }) => {
  await joinAndPublish(page);

  // Answer the incoming wave so the direct thread is established.
  await page.getByRole('link', { name: /First contact/ }).click();
  await expect(page.getByRole('heading', { name: 'First contact', exact: true })).toBeVisible();
  await page.getByLabel('Your reply').fill('Hello! A walk sounds good.');
  await page.getByRole('button', { name: 'Answer', exact: true }).click();
  await expect(page.getByText('Status: answered')).toBeVisible();

  // Open the established conversation and send a message with a real delivery state.
  await page.getByRole('link', { name: 'Contacts' }).click();
  await page.getByRole('button', { name: 'Open chat' }).first().click();
  await expect(page.getByLabel('Write a message')).toBeVisible();
  await expect(page.getByText('Status: Active')).toBeVisible();
  await page.getByLabel('Write a message').fill('See you on Saturday?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const bubble = page.locator('.bubble', { hasText: 'See you on Saturday?' });
  await expect(bubble).toBeVisible();
  await expect(bubble.getByText(/Stored for delivery|Queued on your device/)).toBeVisible();

  // Respectfully close disables the composer; the API owns the closed state.
  await page.getByRole('button', { name: 'Respectfully close' }).click();
  await expect(page.getByText('Status: Closed')).toBeVisible();
  await expect(page.getByLabel('Write a message')).toBeDisabled();

  // An explicit reopen request leaves the conversation pending, not open.
  await page.getByRole('button', { name: 'Request reopen' }).click();
  await expect(page.getByText('Status: Reopen requested')).toBeVisible();
  await expect(page.getByLabel('Write a message')).toBeDisabled();

  // Punish needs an explicit cost confirmation before anything happens.
  await page.getByRole('button', { name: 'Punish', exact: true }).click();
  await expect(page.getByText(/costs both participants/)).toBeVisible();
  await expect(page.getByText('Status: Blocked')).not.toBeVisible();
  await page.getByRole('button', { name: 'Confirm punish' }).click();
  await expect(page.getByText('Status: Blocked')).toBeVisible();
  await expect(page.getByLabel('Write a message')).toBeDisabled();

  // A different peer loads its own conversation, not the old messages.
  await page.evaluate(() => {
    window.location.hash = '#/chat/member-ana';
  });
  await expect(page.getByRole('heading', { name: 'ana-walks' })).toBeVisible();
  await expect(page.getByText('See you on Saturday?')).toHaveCount(0);
});
