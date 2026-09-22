import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end proof for the user-request → Gemini tool → Google Drive → artifact
 * card → confirmed rename path.
 *
 * The external boundaries are stubbed (Gemini's interaction stream, the Google
 * Identity Services token client and the Drive REST API). Everything between
 * them runs for real: the OAuth authority and capability policy, the tool loop,
 * argument validation, the confirmation broker, the artifact repository and the
 * rendered card. A test may stub what Google says; never what Elara stores.
 */

const DRIVE_API = '**/drive/v3/files**';
const DRIVE_METADATA = {
  id: 'file-1',
  name: 'Quarterly report.pdf',
  mimeType: 'application/pdf',
  modifiedTime: '2026-09-01T09:00:00Z',
  createdTime: '2026-08-20T09:00:00Z',
  webViewLink: 'https://drive.google.com/file/d/file-1/view',
  parents: ['root'],
  size: '11',
  starred: false,
  description: 'Board pack',
  trashed: false,
  etag: '"etag-1"',
  capabilities: { canDownload: true },
};

interface DriveCall {
  method: string;
  url: string;
  ifMatch: string | null;
  body: string | null;
}

function sseTurn(interactionId: string, body: readonly string[], terminal: 'requires_action' | 'completed' = 'completed'): string {
  const created = `event: interaction.created\ndata: ${JSON.stringify({
    event_type: 'interaction.created',
    interaction: { id: interactionId, status: 'in_progress', model: 'gemini-3.8-flash' },
  })}\n\n`;
  // This fixture tests Drive orchestration, not the provider's missing-usage
  // fallback. Supply small realistic usage so the real TPM governor sees the
  // same accounting shape it would normally receive from Gemini.
  const usage_metadata = {
    prompt_token_count: 4_000,
    candidates_token_count: 200,
    total_token_count: 4_200,
  };
  const end = terminal === 'completed'
    ? `event: interaction.completed\ndata: ${JSON.stringify({
      event_type: 'interaction.completed',
      interaction: { id: interactionId, status: 'completed', usage_metadata },
    })}\n\n`
    : `event: interaction.requires_action\ndata: ${JSON.stringify({
      event_type: 'interaction.requires_action',
      interaction: { id: interactionId, status: 'requires_action', usage_metadata },
    })}\n\n`;
  return created + body.join('') + end;
}

function toolCallStep(id: string, name: string, args: Record<string, unknown>): string {
  return [
    `event: step.start\ndata: ${JSON.stringify({
      event_type: 'step.start',
      index: 0,
      step: { index: 0, type: 'function_call', id, name, arguments: args },
    })}\n\n`,
    `event: step.stop\ndata: ${JSON.stringify({ event_type: 'step.stop', index: 0 })}\n\n`,
  ].join('');
}

function textStep(text: string): string {
  return `event: step.delta\ndata: ${JSON.stringify({
    event_type: 'step.delta',
    index: 0,
    delta: { type: 'text', text },
  })}\n\n`;
}

// Fabricates ONLY the external provider boundary: the Google Identity Services
// script and Google's userinfo endpoint (same shape the OAuth settings E2E
// uses). The app still runs its real authority, capability policy and storage.
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
    body: JSON.stringify({ email: 'signed.in@example.com', name: 'Signed In User' }),
  }));
}

async function stubDriveApi(page: Page, calls: DriveCall[]): Promise<void> {
  await page.route(DRIVE_API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push({
      method: request.method(),
      url: request.url(),
      ifMatch: await request.headerValue('if-match'),
      body: request.postData(),
    });

    if (request.method() === 'PATCH') {
      const body = request.postData() ? JSON.parse(request.postData() ?? '{}') as Record<string, unknown> : {};
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...DRIVE_METADATA, ...body, etag: '"etag-2"' }),
      });
      return;
    }

    // Media read: bytes go to the artifact store, never to the model.
    if (url.searchParams.get('alt') === 'media') {
      await route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4 e2e drive bytes' });
      return;
    }

    // `files/{id}` is one file's metadata; `files` is a search page.
    if (/\/files\/[^/]+$/.test(url.pathname)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DRIVE_METADATA) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: [DRIVE_METADATA] }) });
  });
}

async function unlockTestGemini(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill('e2e-test-api-key');
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('2846197531');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('2846197531');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

async function connectGoogleDrive(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Google' }).click();

  // One user gesture opens the bundled Google consent flow for the current
  // Workspace surface; Drive read/write status is then a projection of the
  // scopes Google actually returned.
  await page.getByRole('button', { name: 'Connect Google Workspace' }).click();
  await expect(page.getByText('Session ready')).toBeVisible();

  const driveRow = page.locator('.google-oauth-service').filter({ hasText: 'Google Drive' });
  await expect(driveRow.getByLabel('Google Drive read granted')).toBeVisible();
  await expect(driveRow.getByLabel('Google Drive write granted')).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message Elara' }).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

/**
 * Model turns derived from the tool results the app already returned, so the
 * script is robust to provider retries and request ordering.
 */
async function stubGeminiTurns(page: Page, renameWithApproval: boolean): Promise<void> {
  await page.route('**/v1/interactions*', async (route) => {
    const payload = JSON.parse(route.request().postData() ?? '{}') as { input?: unknown };
    const lastTool = Array.isArray(payload.input)
      ? (payload.input as Array<{ type?: string; name?: string }>).filter((entry) => entry?.type === 'function_result').at(-1)?.name
      : undefined;

    if (lastTool === 'drive.updateFile') {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseTurn('interaction-done', [textStep(renameWithApproval ? 'Renamed the report.' : 'Left the report alone.')]),
      });
      return;
    }

    if (lastTool === 'drive.downloadFile') {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseTurn('interaction-rename', [
          toolCallStep('call-rename', 'drive.updateFile', { fileId: 'file-1', etag: '"etag-1"', patch: { name: 'Renamed report.pdf' } }),
        ], 'requires_action'),
      });
      return;
    }

    if (lastTool === 'drive.searchFiles') {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseTurn('interaction-download', [
          toolCallStep('call-download', 'drive.downloadFile', { fileId: 'file-1' }),
        ], 'requires_action'),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseTurn('interaction-search', [
        toolCallStep('call-search', 'drive.searchFiles', { query: 'name contains "Quarterly report"' }),
      ], 'requires_action'),
    });
  });
}

test.describe('Google Drive tool flow', () => {
  test('searches Drive, turns a download into a card and renames the file only after approval', async ({ page }) => {
    const driveCalls: DriveCall[] = [];
    await stubGoogleProvider(page);
    await stubDriveApi(page, driveCalls);
    await stubGeminiTurns(page, true);

    await page.goto('');
    await unlockTestGemini(page);
    await connectGoogleDrive(page);

    await ask(page, 'Find the quarterly report and save it here.');
    const downloadCard = page.getByRole('article', { name: 'Document attachment Quarterly report.pdf' });
    await expect(downloadCard).toBeVisible({ timeout: 15_000 });
    await expect(downloadCard).toContainText('application/pdf');

    // The search respected the trashed default and asked for the shared projection.
    const search = driveCalls.find((call) => call.url.includes('/drive/v3/files?'));
    expect(search).toBeTruthy();
    const searchUrl = new URL(search?.url ?? 'https://invalid.example');
    expect(searchUrl.searchParams.get('q')).toContain('and trashed = false');
    expect(searchUrl.searchParams.get('fields')).toContain('etag');
    expect(searchUrl.searchParams.get('fields')).toContain('capabilities(canDownload)');

    // The media read never returns bytes to the model: they land in the artifact store.
    expect(driveCalls.some((call) => call.url.includes('alt=media'))).toBe(true);

    // A metadata mutation is proposed but not executed before the human approves.
    const dialog = page.getByRole('dialog', { name: 'Elara action confirmation' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Google Drive');
    await expect(dialog).toContainText('Update file');
    await expect(dialog).not.toContainText('drive.updateFile');
    await expect(dialog).toContainText('matches the ETag read for it');
    expect(driveCalls.filter((call) => call.method === 'PATCH')).toHaveLength(0);

    await expect(dialog.locator('[data-untrusted-context="true"]')).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'Approve Google Drive: Update file' }).check();
    await dialog.getByRole('button', { name: '✓ Approve selected' }).click();

    await expect.poll(() => driveCalls.filter((call) => call.method === 'PATCH').length).toBe(1);
    const rename = driveCalls.find((call) => call.method === 'PATCH');
    expect(rename?.url).toContain('/drive/v3/files/file-1');
    expect(rename?.ifMatch).toBe('"etag-1"');
    expect(JSON.parse(rename?.body ?? '{}')).toEqual({ name: 'Renamed report.pdf' });
    expect(driveCalls.some((call) => call.method === 'DELETE')).toBe(false);
    await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('Renamed the report.');
  });

  test('declining a Drive rename leaves the provider untouched', async ({ page }) => {
    const driveCalls: DriveCall[] = [];
    await stubGoogleProvider(page);
    await stubDriveApi(page, driveCalls);
    await stubGeminiTurns(page, false);

    await page.goto('');
    await unlockTestGemini(page);
    await connectGoogleDrive(page);

    await ask(page, 'Find the quarterly report and save it here.');
    await expect(page.getByRole('article', { name: 'Document attachment Quarterly report.pdf' })).toBeVisible({ timeout: 15_000 });

    const dialog = page.getByRole('dialog', { name: 'Elara action confirmation' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '✕ Decline' }).click();

    await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('Left the report alone.');
    expect(driveCalls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });
});
