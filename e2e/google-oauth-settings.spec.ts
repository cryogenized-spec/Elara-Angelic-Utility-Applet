import { expect, test, type Page } from '@playwright/test';

// The app's persisted authorization record lives at this key
// (src/google/oauth/authority.ts STORAGE_KEY). Every record written in this
// spec is written by the app's own writer (acquireToken → saveStored). The
// only seeded record is the explicit legacy-migration test below, which
// reproduces the v2 shape the app itself wrote before the v3 writer existed.
const GOOGLE_STORAGE_KEY = 'elara.google.authorization.v2';
const CALENDAR_READ_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const STUB_EMAIL = 'signed.in@example.com';
const STUB_NAME = 'Signed In User';

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Google' }).click();
}

// Fabricates ONLY the external provider boundary: the Google Identity
// Services token client script and Google's userinfo endpoint. The app under
// test still runs its real authority, capability policy, reducer, and storage
// writer — a test may stub what Google says, never what the app stored.
async function stubGoogleProvider(page: Page): Promise<void> {
  await page.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: [
      'window.google = { accounts: { oauth2: {',
      '  initTokenClient: (config) => ({ requestAccessToken: () => config.callback({ access_token: "e2e-access-token", expires_in: 3600, scope: config.scope }) }),',
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

async function connectGoogleAccount(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Connect Google account' }).click();
}

async function connectCalendarRead(page: Page): Promise<void> {
  await page.locator('.google-oauth-service').filter({ hasText: 'Google Calendar' }).getByRole('button', { name: 'Enable read access' }).click();
}

test('account connection is prominent, establishes a live session, and then unlocks Workspace permissions', async ({ page }) => {
  await stubGoogleProvider(page);
  await page.goto('/');
  await openSettings(page);

  await expect(page.getByRole('button', { name: 'Connect Google account' })).toBeVisible();
  await expect(page.getByText('Workspace permissions unlock after account connection')).toBeVisible();
  await expect(page.locator('.google-oauth-service')).toHaveCount(0);

  await connectGoogleAccount(page);

  await expect(page.getByText('Google account connected')).toBeVisible();
  await expect(page.getByText(STUB_EMAIL)).toBeVisible();
  await expect(page.getByText('Session ready')).toBeVisible();
  await expect(page.locator('.google-oauth-service')).toHaveCount(6);

  await connectCalendarRead(page);
  await expect(page.locator('.google-oauth-service').filter({ hasText: 'Google Calendar' }).getByRole('button', { name: 'Enable writes' })).toHaveCount(1);

  await expect.poll(() => readStoredAuthorization(page), { timeout: 10_000 }).toEqual(expect.objectContaining({
    version: 3,
    account: { email: STUB_EMAIL, displayName: STUB_NAME },
  }));
  const stored = await readStoredAuthorization(page);
  expect(stored?.enabledCapabilities).toEqual(expect.arrayContaining(['google.account', 'calendar.events.read']));
  expect(stored?.grantedProviderScopes).toContain(CALENDAR_READ_SCOPE);

  // Access tokens are memory-only. Reload keeps account/scope metadata but
  // makes the primary account CTA responsible for acquiring a fresh token.
  await page.reload();
  await openSettings(page);
  await expect(page.getByRole('button', { name: 'Refresh Google session' })).toBeVisible();
  await expect(page.locator('.google-oauth-service')).toHaveCount(0);

  await page.getByRole('button', { name: 'Refresh Google session' }).click();
  await expect(page.getByText('Session ready')).toBeVisible();
  await expect(page.locator('.google-oauth-service')).toHaveCount(6);
  await expect(page.locator('.google-oauth-service').filter({ hasText: 'Google Calendar' }).getByText('Read ready')).toBeVisible();
});

test('disconnect removes the record the writer created', async ({ page }) => {
  await stubGoogleProvider(page);
  await page.goto('/');
  await openSettings(page);
  await connectGoogleAccount(page);
  await expect(page.getByText('Session ready')).toBeVisible();

  await page.getByRole('button', { name: 'Disconnect Google' }).click();
  await expect(page.getByRole('button', { name: 'Connect Google account' })).toBeVisible();
  await expect.poll(() => readStoredAuthorization(page)).toBeNull();
  await expect(page.locator('.google-oauth-service')).toHaveCount(0);
});

test('a genuine v2 record migrates, then a real acquisition supersedes it with scope truth', async ({ page }) => {
  // Explicit legacy-migration seeding: this is the v2 shape the app itself
  // wrote before the v3 scope-bearing writer existed (version: 2 +
  // grantedCapabilities, no provider-scope manifest).
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
  // Legacy consent/account metadata remains visible, but there is no live
  // memory token after startup, so the account screen requires refresh first.
  await expect(page.getByText('legacy@example.com')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh Google session' })).toBeVisible();
  await expect(page.locator('.google-oauth-service')).toHaveCount(0);

  await page.getByRole('button', { name: 'Refresh Google session' }).click();
  await expect(page.getByText('Session ready')).toBeVisible();

  // A real Gmail acquisition supersedes legacy provider evidence with current
  // token truth while preserving locally enabled user intent.
  await page.locator('.google-oauth-service').filter({ hasText: 'Gmail' }).getByRole('button', { name: 'Enable read access' }).click();

  await expect.poll(() => readStoredAuthorization(page), { timeout: 10_000 }).toEqual(expect.objectContaining({
    version: 3,
    account: { email: STUB_EMAIL, displayName: STUB_NAME },
  }));
  const stored = await readStoredAuthorization(page);
  expect(stored?.enabledCapabilities).toEqual(expect.arrayContaining(['google.account', 'calendar.events.read', 'tasks.read', 'gmail.read']));
  expect(stored?.grantedProviderScopes).toContain(GMAIL_READ_SCOPE);
});
