import { expect, test, type Page } from '@playwright/test';

// The app's persisted authorization record lives at this key
// (src/google/oauth/authority.ts STORAGE_KEY). Every record written in this
// spec is written by the app's own writer. The only seeded record is the
// explicit legacy-migration test below, reproducing the v2 shape the app
// itself wrote before the v3 writer existed.
const GOOGLE_STORAGE_KEY = 'elara.google.authorization.v2';
const CALENDAR_READ_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const TASKS_READ_SCOPE = 'https://www.googleapis.com/auth/tasks.readonly';
const TASKS_WRITE_SCOPE = 'https://www.googleapis.com/auth/tasks';
const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_LIBRARY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const STUB_EMAIL = 'signed.in@example.com';
const STUB_NAME = 'Signed In User';

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Google' }).click();
}

// Fabricates ONLY the external provider boundary: the Google Identity
// Services token client script and Google's userinfo endpoint. The app under
// test still runs its real authority, capability policy and storage writer.
async function stubGoogleProvider(page: Page): Promise<void> {
  await page.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: [
      'window.__e2eGoogleTokenRequests = 0;',
      'window.__e2eGoogleLastScope = "";',
      'window.google = { accounts: { oauth2: {',
      '  initTokenClient: (config) => ({ requestAccessToken: () => {',
      '    window.__e2eGoogleTokenRequests += 1;',
      '    window.__e2eGoogleLastScope = config.scope;',
      '    config.callback({ access_token: "e2e-access-token", expires_in: 3600, scope: config.scope });',
      '  } }),',
      '  revoke: (_accessToken, callback) => callback({})',
      '} } };',
    ].join('\n'),
  }));
  await page.route('https://www.googleapis.com/oauth2/v2/userinfo*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ email: STUB_EMAIL, name: STUB_NAME }),
  }));
}

async function readStoredAuthorization(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as Record<string, unknown> : null;
  }, GOOGLE_STORAGE_KEY);
}

async function connectGoogleWorkspace(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Connect Google Workspace' }).click();
}

async function providerRequest(page: Page): Promise<{ count: number; scopes: string[] }> {
  return page.evaluate(() => {
    const state = window as typeof window & { __e2eGoogleTokenRequests?: number; __e2eGoogleLastScope?: string };
    return {
      count: state.__e2eGoogleTokenRequests ?? 0,
      scopes: (state.__e2eGoogleLastScope ?? '').split(/\s+/).filter(Boolean),
    };
  });
}

test('Workspace connection requests the complete permission bundle in one GIS consent flow', async ({ page }) => {
  await stubGoogleProvider(page);
  await page.goto('/');
  await openSettings(page);

  await expect(page.getByRole('button', { name: 'Connect Google Workspace' })).toBeVisible();
  await expect(page.getByText('Workspace permissions unlock after account connection')).toBeVisible();
  await expect(page.locator('.google-oauth-service')).toHaveCount(0);

  await connectGoogleWorkspace(page);

  await expect(page.getByText('Google account connected')).toBeVisible();
  await expect(page.getByText(STUB_EMAIL, { exact: true })).toBeVisible();
  await expect(page.getByText('Session ready')).toBeVisible();
  await expect(page.locator('.google-oauth-service')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Enable read access' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enable writes' })).toHaveCount(0);

  const provider = await providerRequest(page);
  expect(provider.count).toBe(1);
  expect(provider.scopes).toEqual(expect.arrayContaining([
    CALENDAR_READ_SCOPE,
    TASKS_WRITE_SCOPE,
    GMAIL_READ_SCOPE,
    DRIVE_FILE_SCOPE,
    DRIVE_LIBRARY_SCOPE,
  ]));

  const calendar = page.locator('.google-oauth-service').filter({ hasText: 'Google Calendar' });
  await expect(calendar.getByLabel('Google Calendar read granted')).toBeVisible();
  await expect(calendar.getByLabel('Google Calendar write granted')).toBeVisible();
  const gmail = page.locator('.google-oauth-service').filter({ hasText: 'Gmail' });
  await expect(gmail.getByLabel('Gmail read granted')).toBeVisible();
  await expect(gmail.getByLabel('Gmail write granted')).toBeVisible();

  await expect.poll(() => readStoredAuthorization(page), { timeout: 10_000 }).toEqual(expect.objectContaining({
    version: 3,
    account: { email: STUB_EMAIL, displayName: STUB_NAME },
  }));
  const stored = await readStoredAuthorization(page);
  expect(stored?.enabledCapabilities).toEqual(expect.arrayContaining([
    'google.account',
    'calendar.events.read',
    'calendar.events.write',
    'tasks.read',
    'tasks.write',
    'gmail.read',
    'gmail.modify',
    'gmail.labels',
    'gmail.send',
    'drive.files.app.read',
    'drive.files.app.write',
    'drive.library.read',
    'docs.read',
    'docs.write',
    'sheets.read',
    'sheets.write',
  ]));
  expect(stored?.grantedProviderScopes).toEqual(expect.arrayContaining([
    CALENDAR_READ_SCOPE,
    GMAIL_READ_SCOPE,
    DRIVE_FILE_SCOPE,
    DRIVE_LIBRARY_SCOPE,
  ]));

  // Access tokens are memory-only. Reload keeps account/scope metadata but
  // requires a fresh user-driven GIS session.
  await page.reload();
  await openSettings(page);
  await expect(page.getByRole('button', { name: 'Refresh Google Workspace' })).toBeVisible();
  await expect(page.locator('.google-oauth-service')).toHaveCount(0);

  await page.getByRole('button', { name: 'Refresh Google Workspace' }).click();
  await expect(page.getByText('Session ready')).toBeVisible();
  await expect(page.locator('.google-oauth-service')).toHaveCount(6);
  await expect(page.locator('.google-oauth-service').filter({ hasText: 'Google Calendar' }).getByLabel('Google Calendar read granted')).toBeVisible();
});

test('disconnect removes the record the writer created', async ({ page }) => {
  await stubGoogleProvider(page);
  await page.goto('/');
  await openSettings(page);
  await connectGoogleWorkspace(page);
  await expect(page.getByText('Session ready')).toBeVisible();

  await page.getByRole('button', { name: 'Disconnect Google' }).click();
  await expect(page.getByRole('button', { name: 'Connect Google Workspace' })).toBeVisible();
  await expect.poll(() => readStoredAuthorization(page)).toBeNull();
  await expect(page.locator('.google-oauth-service')).toHaveCount(0);
});

test('a genuine v2 record migrates and session refresh preserves its existing least-privilege scope', async ({ page }) => {
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: GOOGLE_STORAGE_KEY,
    value: {
      version: 2,
      grantedCapabilities: ['calendar.events.read', 'tasks.read'],
      account: { email: 'legacy@example.com' },
      updatedAt: new Date().toISOString(),
    },
  });
  await stubGoogleProvider(page);

  await page.goto('/');
  await openSettings(page);
  await expect(page.getByText('legacy@example.com')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh Google Workspace' })).toBeVisible();
  await expect(page.locator('.google-oauth-service')).toHaveCount(0);

  await page.getByRole('button', { name: 'Refresh Google Workspace' }).click();
  await expect(page.getByText('Session ready')).toBeVisible();

  await expect.poll(() => readStoredAuthorization(page), { timeout: 10_000 }).toEqual(expect.objectContaining({
    version: 3,
    account: { email: STUB_EMAIL, displayName: STUB_NAME },
  }));
  const stored = await readStoredAuthorization(page);
  expect(stored?.enabledCapabilities).toHaveLength(3);
  expect(stored?.enabledCapabilities).toEqual(expect.arrayContaining([
    'google.account',
    'calendar.events.read',
    'tasks.read',
  ]));
  expect(stored?.grantedProviderScopes).toEqual(expect.arrayContaining([
    CALENDAR_READ_SCOPE,
    TASKS_READ_SCOPE,
  ]));
  expect(stored?.grantedProviderScopes).not.toContain(GMAIL_READ_SCOPE);
  expect(stored?.grantedProviderScopes).not.toContain(DRIVE_LIBRARY_SCOPE);
});
