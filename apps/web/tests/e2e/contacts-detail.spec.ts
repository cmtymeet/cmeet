import { test, expect } from '@playwright/test';
import { enterCommunity, answerIntroduction } from './flows';

// Contacts detail: established status, separate block/unblock, explicit reopen,
// and a block at once hides the member from forum discovery. Unblocking never
// navigates to chat by itself.
test('contacts block, unblock and explicit reopen without auto chat', async ({ page }) => {
  await enterCommunity(page);
  await answerIntroduction(page);

  await page.getByRole('link', { name: 'Contacts' }).click();
  await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
  await expect(page.getByText('tom-cooks')).toBeVisible();
  await expect(page.getByText(/Established/).first()).toBeVisible();

  // Block is a separate action; the relation becomes blocked.
  await page.getByRole('button', { name: 'Block', exact: true }).first().click();
  await expect(page.getByText(/Blocked/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unblock', exact: true }).first()).toBeVisible();

  // A block at once stops discovery: the blocked member leaves the forum.
  await page.getByRole('link', { name: 'Discover' }).click();
  await expect(page.getByRole('heading', { name: 'Discover' })).toBeVisible();
  await expect(page.getByText('tom-cooks')).toHaveCount(0);

  // Unblock returns a closed relation and never opens chat automatically.
  await page.getByRole('link', { name: 'Contacts' }).click();
  await expect(page.getByText('tom-cooks')).toBeVisible();
  await page.getByRole('button', { name: 'Unblock', exact: true }).first().click();
  await expect(page.getByText(/Closed/).first()).toBeVisible();
  await expect(page).toHaveURL(/#\/contacts/);

  // A closed relation needs an explicit reopen request; it stays pending.
  await page.getByRole('button', { name: 'Request reopening', exact: true }).first().click();
  await expect(page.getByText(/Pending/).first()).toBeVisible();
  await expect(page).toHaveURL(/#\/contacts/);
});
