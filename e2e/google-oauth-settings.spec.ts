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

async function connectCalendarRead(page: Page): Promise<void> {
  await page.locator('.google-oauth-service').filter({ hasText: 'Google Calendar' }).getByRole('button', { name: 'Connect' }).click();
}

test('a real Connect flow produces the v3 record, including account identity', async ({ page }) => {
  await stubGoogleProvider(page);
  await page.goto('/');
  await openSettings(page);
  await expect(page.getByText('Not connected')).toBeVisible();

  await connectCalendarRead(page);

  // The status line shows the identity the writer persisted from the
  // (stubbed) userinfo response.
  await expect(page.getByText(`Partially authorized · ${STUB_EMAIL}`)).toBeVisible();
  // Calendar read is ready; its write capability is not, so the row offers
  // the write upgrade, not a reconnect.
  await expect(page.locator('.google-oauth-service').filter({ hasText: 'Google Calendar' }).getByRole('button', { name: 'Enable writes' })).toHaveCount(1);

  // The app's OWN stored record — written by the canonical writer, not by
  // this test — carries the v3 shape with the fetched identity.
  await expect.poll(() => readStoredAuthorization(page), { timeout: 10_000 }).toEqual(expect.objectContaining({
    version: 3,
    account: { email: STUB_EMAIL, displayName: STUB_NAME },
  }));
  const stored = await readStoredAuthorization(page);
  expect(stored?.enabledCapabilities).toContain('calendar.events.read');
  expect(stored?.grantedProviderScopes).toContain(CALENDAR_READ_SCOPE);

  // Reader roundtrip: the record the writer produced survives a reload and
  // renders the same signed-in state.
  await page.reload();
  await openSettings(page);
  await expect(page.getByText(`Partially authorized · ${STUB_EMAIL}`)).toBeVisible();
});

test('disconnect removes the record the writer created', async ({ page }) => {
  await stubGoogleProvider(page);
  await page.goto('/');
  await openSettings(page);
  await connectCalendarRead(page);
  await expect(page.getByText(`Partially authorized · ${STUB_EMAIL}`)).toBeVisible();

  await page.getByRole('button', { name: 'Disconnect Google' }).click();
  await expect(page.getByText('Not connected')).toBeVisible();
  await expect.poll(() => readStoredAuthorization(page)).toBeNull();
  await expect(page.locator('.google-oauth-service').filter({ hasText: 'Google Calendar' }).getByRole('button', { name: 'Connect' })).toHaveCount(1);
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
  // The migrated consent evidence is honored (no scope manifest, so no
  // sibling inference), and the migrated identity renders.
  await expect(page.getByText('Partially authorized · legacy@example.com')).toBeVisible();

  // A real acquisition replaces legacy evidence with current provider truth.
  await page.locator('.google-oauth-service').filter({ hasText: 'Gmail' }).getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText(`Partially authorized · ${STUB_EMAIL}`)).toBeVisible();

  await expect.poll(() => readStoredAuthorization(page), { timeout: 10_000 }).toEqual(expect.objectContaining({
    version: 3,
    account: { email: STUB_EMAIL, displayName: STUB_NAME },
  }));
  const stored = await readStoredAuthorization(page);
  // Enabled capabilities are the legacy union plus the newly granted one.
  expect(stored?.enabledCapabilities).toEqual(expect.arrayContaining(['calendar.events.read', 'tasks.read', 'gmail.read']));
  // Stored scopes describe the CURRENT token only: the fresh Gmail grant is
  // present and the legacy-era calendar scope is gone.
  expect(stored?.grantedProviderScopes).toContain(GMAIL_READ_SCOPE);
  expect(stored?.grantedProviderScopes).not.toContain(CALENDAR_READ_SCOPE);
});
