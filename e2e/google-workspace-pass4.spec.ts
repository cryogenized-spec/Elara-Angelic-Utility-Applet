import { expect, test, type Page } from '@playwright/test';

function sseTurn(interactionId: string, body: readonly string[], terminal: 'requires_action' | 'completed' = 'completed'): string {
  const created = 'event: interaction.created\ndata: ' + JSON.stringify({
    event_type: 'interaction.created',
    interaction: { id: interactionId, status: 'in_progress', model: 'gemini-3.8-flash' },
  }) + '\n\n';
  const end = terminal === 'completed'
    ? 'event: interaction.completed\ndata: ' + JSON.stringify({ event_type: 'interaction.completed', interaction: { id: interactionId, status: 'completed' } }) + '\n\n'
    : 'event: interaction.requires_action\ndata: ' + JSON.stringify({ event_type: 'interaction.requires_action', interaction_id: interactionId, status: 'requires_action' }) + '\n\n';
  return created + body.join('') + end;
}

function toolCallStep(id: string, name: string, args: Record<string, unknown>): string {
  return 'event: step.start\ndata: ' + JSON.stringify({
    event_type: 'step.start',
    index: 0,
    step: { index: 0, type: 'function_call', id, name, arguments: args },
  }) + '\n\n'
    + 'event: step.stop\ndata: ' + JSON.stringify({ event_type: 'step.stop', index: 0 }) + '\n\n';
}

function textStep(text: string): string {
  return 'event: step.delta\ndata: ' + JSON.stringify({ event_type: 'step.delta', index: 0, delta: { type: 'text', text } }) + '\n\n';
}

async function stubGoogleProvider(page: Page): Promise<void> {
  await page.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: [
      'window.google = window.google || {};',
      'window.google.accounts = { oauth2: {',
      '  initTokenClient: (config) => ({ requestAccessToken: () => config.callback({ access_token: "e2e-access-token", expires_in: 3600, scope: config.scope }) }),',
      '  revoke: (_accessToken, callback) => callback({})',
      '} };',
    ].join('\n'),
  }));
  await page.route('https://www.googleapis.com/oauth2/v2/userinfo*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ email: 'signed.in@example.com', name: 'Signed In User' }),
  }));
}

async function unlockTestGemini(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill('e2e-test-api-key');
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('2468135790');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('2468135790');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

async function connectWorkspaceService(page: Page, serviceName: string): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Google' }).click();
  const accountButton = page.getByRole('button', { name: 'Connect Google Workspace' });
  if (await accountButton.count()) {
    await accountButton.click();
    await expect(page.getByText('Session ready')).toBeVisible();
  }
  const row = page.locator('.google-oauth-service').filter({ hasText: serviceName });
  await expect(row.getByLabel('Read permission granted')).toBeVisible();
  await expect(row.getByLabel('Write permission granted')).toBeVisible();
  await expect(row.getByText('Ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message Elara' }).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

test('Docs mobile flow carries tab and revision from inspect into confirmed write', async ({ page }) => {
  await stubGoogleProvider(page);
  const docsCalls: Array<{ method: string; url: string; body: string | null }> = [];
  await page.route('https://docs.googleapis.com/v1/documents/**', async (route) => {
    const request = route.request();
    docsCalls.push({ method: request.method(), url: request.url(), body: request.postData() });
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          documentId: 'doc-1',
          title: 'Mobile plan',
          revisionId: 'rev-1',
          tabs: [{
            tabProperties: { tabId: 'tab-1', title: 'Overview', index: 0, nestingLevel: 0 },
            documentTab: { body: { content: [{ startIndex: 1, endIndex: 8, paragraph: { elements: [{ textRun: { content: 'Hello!\n' } }] } }] } },
          }],
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ writeControl: { requiredRevisionId: 'rev-1' } }) });
  });
  await page.route('**/v1/interactions*', async (route) => {
    const payload = JSON.parse(route.request().postData() ?? '{}') as { input?: unknown };
    const results = Array.isArray(payload.input)
      ? (payload.input as Array<{ type?: string; name?: string }>).filter((entry) => entry?.type === 'function_result')
      : [];
    const last = results.at(-1)?.name;
    if (last === 'docs.appendParagraph') {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseTurn('docs-done', [textStep('Updated the selected Doc tab safely.')]) });
    } else if (last === 'docs.inspectDocument') {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseTurn('docs-write', [toolCallStep('docs-write-1', 'docs.appendParagraph', {
          documentId: 'doc-1',
          tabId: 'tab-1',
          revisionId: 'rev-1',
          text: 'Mobile-safe update',
        })], 'requires_action'),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseTurn('docs-read', [toolCallStep('docs-read-1', 'docs.inspectDocument', { documentId: 'doc-1' })], 'requires_action'),
      });
    }
  });

  await page.goto('');
  await unlockTestGemini(page);
  await connectWorkspaceService(page, 'Google Docs');
  await ask(page, 'Append a mobile-safe update to the plan.');

  const dialog = page.getByRole('dialog', { name: 'Google action confirmation' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('tab-1');
  await expect(dialog).toContainText('rev-1');
  expect(docsCalls.filter((call) => call.method === 'POST')).toHaveLength(0);
  await expect(dialog.locator('[data-untrusted-context="true"]')).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Approve docs.appendParagraph' }).check();
  await dialog.getByRole('button', { name: '✓ Approve selected' }).click();

  await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('Updated the selected Doc tab safely.', { timeout: 15_000 });
  const write = docsCalls.find((call) => call.method === 'POST');
  expect(write).toBeTruthy();
  const body = JSON.parse(write?.body ?? '{}') as {
    writeControl?: { requiredRevisionId?: string };
    requests?: Array<{ insertText?: { location?: { tabId?: string } } }>;
  };
  expect(body.writeControl).toEqual({ requiredRevisionId: 'rev-1' });
  expect(body.requests?.[0]?.insertText?.location?.tabId).toBe('tab-1');
});

test('Sheets mobile flow writes formula-looking text literally unless parsing is explicit', async ({ page }) => {
  await stubGoogleProvider(page);
  const sheetCalls: Array<{ method: string; url: string; body: string | null }> = [];
  await page.route('https://sheets.googleapis.com/v4/spreadsheets/**', async (route) => {
    const request = route.request();
    sheetCalls.push({ method: request.method(), url: request.url(), body: request.postData() });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ updatedData: { range: 'Sheet1!A1', majorDimension: 'ROWS', values: [['=1+2']] } }),
    });
  });
  await page.route('**/v1/interactions*', async (route) => {
    const payload = JSON.parse(route.request().postData() ?? '{}') as { input?: unknown };
    const hasResult = Array.isArray(payload.input)
      && (payload.input as Array<{ type?: string; name?: string }>).some((entry) => entry?.type === 'function_result' && entry.name === 'sheets.updateCell');
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: hasResult
        ? sseTurn('sheets-done', [textStep('Stored the formula-looking text literally.')])
        : sseTurn('sheets-write', [toolCallStep('sheets-write-1', 'sheets.updateCell', {
          spreadsheetId: 'sheet-1',
          range: 'Sheet1!A1',
          value: '=1+2',
        })], 'requires_action'),
    });
  });

  await page.goto('');
  await unlockTestGemini(page);
  await connectWorkspaceService(page, 'Google Sheets');
  await ask(page, 'Put the literal text =1+2 into A1 without making it a formula.');

  const dialog = page.getByRole('dialog', { name: 'Google action confirmation' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('literal RAW input');
  await expect(dialog).toContainText('=1+2');
  expect(sheetCalls).toHaveLength(0);
  await dialog.getByRole('button', { name: '✓ Approve' }).click();

  await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('Stored the formula-looking text literally.', { timeout: 15_000 });
  expect(sheetCalls).toHaveLength(1);
  expect(sheetCalls[0]?.url).toContain('valueInputOption=RAW');
});
