import { test, expect } from '@playwright/test';

async function join(page: import('@playwright/test').Page) {
  await page.goto('/#/arrival');
  await expect(page.getByRole('heading', { name: 'Good conversations start with the right people.' })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Sign in / register' }).click();
  await page.getByLabel('Invitation voucher').fill('VOUCHER-TEST-123');
  await page.getByLabel(/Choose a handle/).fill('groups-detail-member');
  await page.getByRole('button', { name: 'Continue to join' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
}

// Groups list renders supplied levels, bands, opening progress and
// invitations; room joins need explicit consent and open the detail view.
test('groups list shows bands and opening, joins rooms only with consent', async ({ page }) => {
  await join(page);

  await page.getByRole('link', { name: 'Groups' }).click();
  await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible();

  // Every supplied level is named; the size is shown, never computed here.
  await expect(page.getByText('Circle', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Ingroup', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Public room', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Opening room', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/What changes next/).first()).toBeVisible();
  await expect(page.getByText('67 members').first()).toBeVisible();

  // Band pace, joining and newcomer history come from cmsg.
  await expect(page.getByText('Posting pace').first()).toBeVisible();
  await expect(page.getByText('Mentions only').first()).toBeVisible();
  await expect(page.getByText('Newcomer history').first()).toBeVisible();
  await expect(page.getByText(/last 12 hours/).first()).toBeVisible();

  // Opening progress and deadline come from the API.
  await expect(page.getByText(/28 of 43 members/).first()).toBeVisible();
  await expect(page.getByText(/21 days/).first()).toBeVisible();

  // Suggestions read as invitations; the seat economy stays hidden while disabled.
  await expect(page.getByText('Invitation').first()).toBeVisible();
  await expect(page.getByText(/Invite people/).first()).toBeVisible();
  await expect(page.getByText('Seat budget')).toHaveCount(0);

  // Joining never costs a wave.
  await expect(page.getByText(/never costs a wave/i).first()).toBeVisible();

  // Circles the member already joined show their state.
  await expect(
    page.getByRole('article', { name: /Community garden/ }).getByText('Joined', { exact: true }),
  ).toBeVisible();

  // Rooms and openings join only with an explicit checkbox.
  await page.getByRole('article', { name: /Saturday market/ }).getByRole('button', { name: 'Join' }).click();
  await expect(page.getByRole('dialog')).toContainText('consenting');
  await expect(page.getByRole('dialog')).toContainText('67 members');
  await expect(page.getByRole('button', { name: /Join Saturday market/ })).toBeDisabled();
  await page.getByText('I understand and consent to this visibility.').click();
  await expect(page.getByRole('button', { name: /Join Saturday market/ })).toBeEnabled();
  await page.getByRole('button', { name: /Join Saturday market/ }).click();
  await expect(page.getByRole('heading', { name: 'Saturday market' })).toBeVisible();
  await expect(page.getByText('Public room', { exact: true }).first()).toBeVisible();
});
