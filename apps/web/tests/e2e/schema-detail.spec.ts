import { test, expect } from '@playwright/test';

async function join(page: import('@playwright/test').Page) {
  await page.goto('/#/arrival');
  await expect(page.getByRole('heading', { name: 'Good conversations start with the right people.' })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Sign in / register' }).click();
  await page.getByLabel('Invitation voucher').fill('VOUCHER-TEST-123');
  await page.getByLabel(/Choose a handle/).fill('schema-member');
  await page.getByRole('button', { name: 'Continue to join' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
}

// Admin schema detail: labels, styles, choices/bounds, add/remove, reorder,
// labelled sample preview and API-reported impact. No image style is offered.
test('schema detail editing with live sample preview', async ({ page }) => {
  await join(page);
  await page.getByRole('link', { name: 'Schema' }).click();
  await expect(page.getByRole('heading', { name: 'Profile schema' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign in as admin' }).click();

  await expect(page.getByRole('heading', { name: 'Live preview' })).toBeVisible();
  await expect(page.locator('.schema-row').first()).toBeVisible();

  // Question labels are editable text.
  await page.locator('#question-age').fill('What age are you?');
  await expect(page.locator('.schema-row').first()).toContainText('What age are you?');

  // Answer styles offer typed options but no image style.
  await page.locator('#kind-about').selectOption('long-text');
  await expect(page.locator('#kind-about')).toHaveValue('long-text');

  // Choices and bounds are typed inputs.
  await page.locator('#choices-neighbourhood').fill('North, East, Harbour');
  await page.locator('#min-age').fill('21');
  await expect(page.locator('#min-age')).toHaveValue('21');

  // Required and filterable are plain checkboxes.
  await page.locator('#required-about').uncheck();
  await expect(page.locator('#required-about')).not.toBeChecked();

  // Labelled move buttons reorder; edges stay disabled.
  await expect(page.getByRole('button', { name: /Move up/ }).first()).toBeDisabled();
  const firstQuestion = await page.locator('.schema-row').first().textContent();
  await page.locator('.schema-row').first().getByRole('button', { name: /Move down/ }).click();
  await expect(page.locator('.schema-row').nth(1)).toContainText((firstQuestion ?? '').trim().slice(0, 12));

  // Sample answers are clearly labelled and start empty; typing updates the preview.
  await expect(page.getByText('Sample answers (not saved)')).toBeVisible();
  await page.locator('#sample-age').fill('27');
  await expect(page.getByText('27').first()).toBeVisible();

  // Adding then removing a draft question leaves the list unchanged.
  const rowsBefore = await page.locator('.schema-row').count();
  await page.getByRole('button', { name: 'Add question' }).click();
  await expect(page.locator('.schema-row')).toHaveCount(rowsBefore + 1);
  await page.getByRole('button', { name: 'Remove question' }).last().click();
  await expect(page.locator('.schema-row')).toHaveCount(rowsBefore);

  // Saving shows the API impact verbatim.
  await page.getByRole('button', { name: 'Save schema' }).click();
  await expect(page.getByText(/Profiles needing changes/)).toBeVisible();
});
