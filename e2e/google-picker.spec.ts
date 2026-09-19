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
  return 'event: step.delta\ndata: ' + JSON.stringify({
    event_type: 'step.delta',
    index: 0,
    delta: { type: 'text', text },
  }) + '\n\n';
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

async function stubPicker(page: Page): Promise<void> {
  await page.route('https://apis.google.com/js/api.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: [
      'window.gapi = { load: (_name, options) => options.callback() };',
      'window.google = window.google || {};',
      'class DocsView { setMimeTypes(_value) {} }',
      'class PickerBuilder {',
      '  setDeveloperKey(_value) { return this; }',
      '  setAppId(_value) { return this; }',
      '  setOAuthToken(_value) { return this; }',
      '  setOrigin(_value) { return this; }',
      '  addView(_value) { return this; }',
      '  enableFeature(_value) { return this; }',
      '  setCallback(value) { this.callback = value; return this; }',
      '  build() { return { setVisible: (visible) => {',
      '    if (!visible) return;',
      '    this.callback({ action: "picked", documents: [{ id: "picked-file-1", name: "Picked plan", mimeType: "application/vnd.google-apps.document", url: "https://docs.google.com/document/d/picked-file-1/edit" }] });',
      '  }}; }',
      '}',
      'window.google.picker = {',
      '  Action: { PICKED: "picked", CANCEL: "cancel" },',
      '  Document: { ID: "id", NAME: "name", MIMETYPE: "mimeType", URL: "url" },',
      '  Feature: { MULTISELECT_ENABLED: "multi" },',
      '  Response: { ACTION: "action", DOCUMENTS: "documents" },',
      '  ViewId: { DOCS: "docs" },',
      '  PickerBuilder, DocsView',
      '};',
    ].join('\n'),
  }));
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

async function openGoogleSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Google' }).click();
}

test('Picker admits a Drive file and local removal blocks later tool access', async ({ page }) => {
  let driveProviderCalls = 0;
  await stubGoogleProvider(page);
  await stubPicker(page);
  await page.route('**/drive/v3/files/**', async (route) => {
    driveProviderCalls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'picked-file-1', name: 'Picked plan' }) });
  });

  await page.route('**/v1/interactions*', async (route) => {
    const payload = JSON.parse(route.request().postData() ?? '{}') as { input?: unknown };
    const hasResult = Array.isArray(payload.input)
      && (payload.input as Array<{ type?: string }>).some((entry) => entry?.type === 'function_result');
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: hasResult
        ? sseTurn('picker-done', [textStep('Elara kept that removed file blocked.')])
        : sseTurn('picker-read', [toolCallStep('call-picked-file', 'drive.getFile', { fileId: 'picked-file-1' })], 'requires_action'),
    });
  });

  await page.goto('');
  await unlockTestGemini(page);
  await openGoogleSettings(page);

  await page.getByRole('button', { name: 'Connect Google Workspace' }).click();
  await expect(page.getByText('Session ready')).toBeVisible();
  const driveRow = page.locator('.google-oauth-service').filter({ hasText: 'Google Drive' });
  await expect(driveRow.getByLabel('Read permission granted')).toBeVisible();

  await driveRow.getByRole('button', { name: 'Choose files with Google Picker' }).click();
  await expect(driveRow.getByText('Picked plan')).toBeVisible();
  await driveRow.getByRole('button', { name: 'Remove from Elara' }).click();
  await expect(driveRow.getByText('Picked plan')).toHaveCount(0);

  await page.getByRole('button', { name: 'Back to chat' }).click();
  await page.getByRole('textbox', { name: 'Message Elara' }).fill('Open the picked plan.');
  await page.getByRole('button', { name: 'Send message' }).click();

  await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('Elara kept that removed file blocked.', { timeout: 15_000 });
  expect(driveProviderCalls).toBe(0);
});
