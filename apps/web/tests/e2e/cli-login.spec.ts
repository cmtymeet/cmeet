import { test, expect } from '@playwright/test';

function launch(origin: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    session: 'session-e2e-0001', nonce: 'nonce-e2e-0001', origin,
    callback: 'http://127.0.0.1:43111/finish', expires: String(Date.now() + 120_000), ...extra,
  });
  return `/#/cli-login/${params.toString()}`;
}

test('the CLI login page confirms the exact origin, hands off locally and sends nothing to servers', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const requests: string[] = [];
  page.on('request', (request) => { if (request.method() !== 'GET') requests.push(`${request.method()} ${request.url()}`); });
  await page.goto(launch(origin));
  await expect(page.getByRole('heading', { name: 'Sign in from the command line' })).toBeVisible();
  await expect(page.getByText(origin, { exact: true })).toBeVisible();
  // The launch fragment never stays in the address bar.
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
  await page.getByRole('button', { name: 'Continue with my passkey' }).click();
  await expect(page.getByText('You can return to your terminal.', { exact: false })).toBeVisible();
  expect(requests).toEqual([]);
});

test('a link for another origin or a remote callback starts nothing', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.goto(launch('https://other.example'));
  await expect(page.getByText('different community address')).toBeVisible();
  await expect(page.locator('#app button')).toHaveCount(0);
  await page.goto('about:blank');
  await page.goto(launch(origin, { callback: 'https://evil.example/finish' }));
  await expect(page.getByText('not valid')).toBeVisible();
  await expect(page.locator('#app button')).toHaveCount(0);
});
