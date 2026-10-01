import { test, expect } from '@playwright/test';

async function join(page: import('@playwright/test').Page) {
  await page.goto('/#/arrival');
  await expect(page.getByRole('heading', { name: 'Good conversations start with the right people.' })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Sign in / register' }).click();
  await page.getByLabel('Invitation voucher').fill('VOUCHER-TEST-123');
  await page.getByLabel(/Choose a handle/).fill('group-member');
  await page.getByRole('button', { name: 'Continue to join' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
}

// Groups by size with consent, devices, admin schema editor with drag and drop, root.
test('groups, devices, admin schema and root', async ({ page }) => {
  await join(page);

  // Groups show their level and what changes next.
  await page.getByRole('link', { name: 'Groups' }).click();
  await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible();
  await expect(page.getByText('Circle', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/What changes next/).first()).toBeVisible();

  // Joining a public room asks for explicit consent in a dialog.
  await page.getByRole('article', { name: /Saturday market/ }).getByRole('button', { name: 'Join' }).click();
  await expect(page.getByRole('dialog')).toContainText('consenting');
  await expect(page.getByRole('button', { name: /Join Saturday market/ })).toBeDisabled();
  await page.getByText('I understand and consent to this visibility.').click();
  await page.getByRole('button', { name: /Join Saturday market/ }).click();
  await expect(page.getByRole('heading', { name: 'Saturday market' })).toBeVisible();
  await expect(page.getByText('Public room', { exact: true }).first()).toBeVisible();

  // Devices are added from a live device and listed by name.
  await page.getByRole('link', { name: 'Devices' }).click();
  await page.getByLabel('Device name').fill('Spare phone');
  await page.getByRole('button', { name: 'Add a device' }).click();
  await expect(page.getByText('Spare phone')).toBeVisible();

  // The admin schema editor reorders questions and previews the member view.
  await page.getByRole('link', { name: 'Schema' }).click();
  await expect(page.getByRole('heading', { name: 'Profile schema' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Live preview' })).toBeVisible();
  const firstQuestion = await page.locator('.schema-row').first().textContent();
  await page.locator('.schema-row').first().getByRole('button', { name: '↓' }).click();
  const movedQuestion = await page.locator('.schema-row').nth(1).textContent();
  expect(movedQuestion).toBe(firstQuestion);
  await page.getByRole('button', { name: 'Save schema' }).click();
  await expect(page.getByText(/Profiles needing changes/)).toBeVisible();

  // Root selects a community without touching members.
  await page.getByRole('link', { name: 'Root' }).click();
  await expect(page.getByRole('heading', { name: 'Communities' })).toBeVisible();
  await page.getByRole('button', { name: 'Select' }).first().click();
  await expect(page.getByRole('button', { name: 'Selected' })).toBeVisible();
});
