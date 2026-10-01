import { expect, type Page } from '@playwright/test';
export async function enterCommunity(page: Page, query = '') {
  await page.goto(`/${query}#/arrival`);
  await page.getByRole('button', { name: 'Sign in / register' }).click();
  await page.getByLabel('Invitation voucher').fill('VOUCHER-TEST-123');
  await page.getByLabel(/Choose a handle/).fill('journey-member');
  await page.getByRole('button', { name: 'Continue to join' }).click();
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await page.locator('#profile-age').fill('34');
  await page.locator('#profile-neighbourhood').selectOption('North');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile published and checked.')).toBeVisible();
}
export async function answerIntroduction(page: Page) {
  await page.getByRole('link', { name: /First contact/ }).click();
  await page.getByLabel('Your reply').fill('Hello back');
  await page.getByRole('button', { name: 'Answer', exact: true }).click();
  await expect(page.getByText('Status: answered')).toBeVisible();
}
