import { expect, test } from '@playwright/test';

async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
}

test('Google settings render independent Workspace authorization states', async ({ page }) => {
  await page.route('**/api/google/oauth/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        state: 'partially-authorized',
        grantedCapabilities: ['calendar.events.read', 'tasks.read', 'drive.files.read'],
        account: { email: 'test@example.com' },
      }),
    });
  });

  await page.goto('/');
  await openSettings(page);
  await page.getByRole('button', { name: 'Google' }).click();

  await expect(page.getByRole('heading', { name: 'Google' })).toBeVisible();
  await expect(page.getByText('Partially authorized · test@example.com')).toBeVisible();
  await expect(page.getByText('Google Calendar', { exact: true })).toBeVisible();
  await expect(page.getByText('Google Tasks', { exact: true })).toBeVisible();
  await expect(page.getByText('Gmail', { exact: true })).toBeVisible();
  await expect(page.getByText('Google Drive', { exact: true })).toBeVisible();
  await expect(page.getByText('Google Docs', { exact: true })).toBeVisible();
  await expect(page.getByText('Google Sheets', { exact: true })).toBeVisible();
  await expect(page.getByText('Read ready').first()).toBeVisible();
  await expect(page.locator('.google-oauth-service').filter({ hasText: 'Gmail' }).getByRole('button', { name: 'Connect' })).toHaveCount(1);
  await expect(page.locator('.google-oauth-service').filter({ hasText: 'Google Docs' }).getByRole('button', { name: 'Connect' })).toHaveCount(1);
  await expect(page.locator('.google-oauth-service').filter({ hasText: 'Google Sheets' }).getByRole('button', { name: 'Connect' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Enable writes' })).toHaveCount(3);
});

test('Google settings can disconnect and refresh normalized status', async ({ page }) => {
  let disconnected = false;
  await page.route('**/api/google/oauth/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(disconnected
        ? { state: 'disconnected', grantedCapabilities: [] }
        : { state: 'connected', grantedCapabilities: ['calendar.events.read'], account: { email: 'test@example.com' } }),
    });
  });
  await page.route('**/api/google/oauth/disconnect', async (route) => {
    disconnected = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disconnected: true }) });
  });

  await page.goto('/');
  await openSettings(page);
  await page.getByRole('button', { name: 'Google' }).click();
  await expect(page.getByText('Connected · test@example.com')).toBeVisible();

  await page.getByRole('button', { name: 'Disconnect Google' }).click();
  await expect(page.getByText('Not connected')).toBeVisible();
});
