import { test, expect } from '@playwright/test';
import { enterCommunity } from './flows';

test('punishment requires confirmation, restores focus on cancel and blocks after acceptance', async ({page}) => {
  await enterCommunity(page);
  await page.getByRole('link', {name: /First contact/}).click();
  const punish = page.getByRole('button', {name: 'Punish', exact: true});
  await punish.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('costs both');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(punish).toBeFocused();
  await punish.click();
  await dialog.getByRole('button', {name: 'Confirm punishment'}).click();
  await expect(page.getByText('Status: punished')).toBeVisible();
  await expect(dialog).not.toBeVisible();
});

test('public cards give relative context only after the supplied record is available', async ({page}) => {
  await enterCommunity(page);
  await page.getByRole('link', {name: 'Discover', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Introduction outcomes'}).first()).toBeVisible();
  await expect(page.getByText('Shares of introduction outcomes', {exact: false}).first()).toBeVisible();
});
