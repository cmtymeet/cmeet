import { test, expect } from '@playwright/test';

async function join(page: import('@playwright/test').Page) {
  await page.goto('/#/arrival');
  await expect(page.getByRole('heading', { name: 'Good conversations start with the right people.' })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Sign in / register' }).click();
  await page.getByLabel('Invitation voucher').fill('VOUCHER-TEST-123');
  await page.getByLabel(/Choose a handle/).fill('fork-member');
  await page.getByRole('button', { name: 'Continue to join' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await page.locator('#profile-age').fill('34');
  await page.locator('#profile-neighbourhood').selectOption('North');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile published and checked.')).toBeVisible();
}

// Group conversation with consent forks: level, band, handle roster, consent, welcome, suggestion.
test('group detail proposes and consents forks without moving anyone', async ({ page }) => {
  await join(page);

  await page.evaluate(() => { window.location.hash = '#/groups/group-garden'; });
  await expect(page.getByRole('heading', { name: 'Community garden' })).toBeVisible();
  await expect(page.getByText('Circle', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/What changes next/)).toBeVisible();
  await expect(page.getByText(/90 messages per hour/)).toBeVisible();
  await expect(page.getByText(/Newcomers start fresh/)).toBeVisible();
  await expect(page.getByText(/garden-neighbours/)).toBeVisible();
  await expect(page.getByText('Seat budget')).not.toBeVisible();
  await expect(page.getByText(/send them a wave/)).toBeVisible();

  // No admin operations exist on groups.
  await expect(page.getByRole('button', { name: /kick|expel|make admin|vote out/i })).toHaveCount(0);

  // Group conversation goes through the group API.
  await page.getByPlaceholder('Write a message').fill('Hello neighbours!');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Hello neighbours!')).toBeVisible();

  // The roster is chosen from cmsg-supplied handles, never typed raw ids.
  await expect(page.getByLabel('Target group')).not.toBeVisible();
  await page.getByLabel('Fork kind').selectOption('merge');
  await expect(page.getByLabel('Target group')).toBeVisible();
  await expect(page.getByLabel('Target group')).toContainText('Evening choir');
  await page.getByLabel('Fork kind').selectOption('split');
  await expect(page.getByLabel('Target group')).not.toBeVisible();

  // The chosen roster is shown by handle before anyone consents.
  await page.getByLabel('Fork name').fill('Quiet half');
  await page.getByLabel('What this fork is about').fill('A smaller circle for slow weekends.');
  await page.getByLabel('ana-walks').check();
  await page.getByLabel('tom-cooks').check();
  await expect(page.getByText(/Chosen roster/)).toBeVisible();
  await expect(page.getByText(/ana-walks, tom-cooks/)).toBeVisible();
  await page.getByRole('button', { name: 'Propose fork' }).click();
  await expect(page.getByText(/Proposal recorded/)).toBeVisible();
  await expect(page.getByText(/Nobody has moved/)).toBeVisible();
  await expect(page.getByText('Quiet half')).toBeVisible();

  // Consent is explicit; nonmovers keep the original group.
  await page.getByRole('button', { name: 'Consent to this fork' }).click();
  await expect(page.getByText(/Consent recorded in/)).toBeVisible();
  await expect(page.getByText(/Nonmovers keep the original group/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Community garden' })).toBeVisible();

  // Suggestions dismiss cleanly on the opening room; the welcome prompt stays visible.
  await page.evaluate(() => { window.location.hash = '#/groups/group-opening'; });
  await expect(page.getByRole('heading', { name: 'Newcomers opening' })).toBeVisible();
  await expect(page.getByText(/Welcome! Say hello/)).toBeVisible();
  await expect(page.getByText(/Invite people who would enjoy/)).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss suggestion' }).click();
  await expect(page.getByText(/Invite people who would enjoy/)).not.toBeVisible();
});
