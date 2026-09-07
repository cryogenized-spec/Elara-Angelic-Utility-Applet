import { expect, test } from '@playwright/test';

const GOOGLE_STORAGE_KEY = 'elara.google.authorization.v2';

async function seedGoogleAuthorization(page: import('@playwright/test').Page, capabilities: string[], email = 'test@example.com'): Promise<void> {
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: GOOGLE_STORAGE_KEY,
    value: { version: 2, grantedCapabilities: capabilities, account: { email }, updatedAt: new Date().toISOString() },
  });
}

async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
}

test('Google settings render independent Workspace authorization states', async ({ page }) => {
  await seedGoogleAuthorization(page, ['calendar.events.read', 'tasks.read', 'drive.files.read']);

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
  await seedGoogleAuthorization(page, ['calendar.events.read']);

  await page.goto('/');
  await openSettings(page);
  await page.getByRole('button', { name: 'Google' }).click();
  await expect(page.getByText('Partially authorized · test@example.com')).toBeVisible();

  await page.getByRole('button', { name: 'Disconnect Google' }).click();
  await expect(page.getByText('Not connected')).toBeVisible();
});
