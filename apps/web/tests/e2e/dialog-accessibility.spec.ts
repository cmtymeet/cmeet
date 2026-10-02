import { test, expect } from '@playwright/test';

// Fixture UI tests for the Groups consent dialog keyboard accessibility.
// They drive the existing development Groups room dialog only and do not
// claim real group admission.

async function joinAs(page: import('@playwright/test').Page, handle: string) {
  await page.goto('/#/arrival');
  await expect(page.getByRole('heading', { name: 'Good conversations start with the right people.' })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Sign in / register' }).click();
  await page.getByLabel('Invitation voucher').fill('VOUCHER-TEST-123');
  await page.getByLabel(/Choose a handle/).fill(handle);
  await page.getByRole('button', { name: 'Continue to join' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await page.locator('#profile-age').fill('34');
  await page.locator('#profile-neighbourhood').selectOption('North');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile published and checked.')).toBeVisible();
  await page.getByRole('link', { name: 'Groups' }).click();
  await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible();
}

function joinRoomButton(page: import('@playwright/test').Page) {
  return page.getByRole('article', { name: /Saturday market/ }).getByRole('button', { name: 'Join' });
}

async function activeElementInsideDialog(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const dialog = document.querySelector('dialog');
    if (!dialog || !dialog.open) return false;
    return !!document.activeElement && dialog.contains(document.activeElement);
  });
}

test('initial focus enters the modal and keyboard navigation skips background controls', async ({ page }, testInfo) => {
  await joinAs(page, 'dialog-focus-trap');
  await joinRoomButton(page).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('consenting');

  await expect.poll(() => activeElementInsideDialog(page)).toBe(true);
  await testInfo.attach('dialog-open', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  expect(await dialog.evaluate((node) => node.matches(':modal'))).toBe(true);
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press(key);
      // Native dialogs may cycle through browser chrome, represented by body
      // as activeElement. The next key must return to the modal; background
      // controls must never receive focus. See HTML sequential focus navigation:
      // https://html.spec.whatwg.org/multipage/interaction.html#sequential-focus-navigation
      if (await page.evaluate(() => document.activeElement === document.body)) {
        await page.keyboard.press(key);
      }
      expect(await activeElementInsideDialog(page)).toBe(true);
    }
  }
});

test('Escape closes, restores the opener, and repeated open works', async ({ page }) => {
  await joinAs(page, 'dialog-escape-restore');
  const opener = joinRoomButton(page);
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => activeElementInsideDialog(page)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  await opener.click();
  await expect(dialog).toBeVisible();
  await expect.poll(() => activeElementInsideDialog(page)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('backdrop closes without consent but internal padding does not dismiss', async ({ page }) => {
  await joinAs(page, 'dialog-backdrop-padding');
  const opener = joinRoomButton(page);
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: /Join Saturday market/ })).toBeDisabled();

  const box = await dialog.evaluate((node) => {
    const rect = (node as HTMLDialogElement).getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.mouse.click(box.x + 8, box.y + 8);
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: /Join Saturday market/ })).toBeDisabled();

  await page.mouse.click(20, 20);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Saturday market', level: 1 })).toHaveCount(0);
  await expect(opener).toBeVisible();
});

test('Cancel closes, restores the opener, and the dialog can reopen', async ({ page }) => {
  await joinAs(page, 'dialog-cancel-restore');
  const opener = joinRoomButton(page);
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => activeElementInsideDialog(page)).toBe(true);

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  await opener.click();
  await expect(dialog).toBeVisible();
  await expect.poll(() => activeElementInsideDialog(page)).toBe(true);
});
