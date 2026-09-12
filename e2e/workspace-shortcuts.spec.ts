import { expect, test } from '@playwright/test';

async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
}

async function unlockTestGemini(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    const lockbox = await import('/Elara-Angelic-Utility-Applet/src/persistence/gemini-api-key.ts');
    await lockbox.saveGeminiApiKey('e2e-test-api-key', 'e2e-test-password');
  });
}

test('opens a Workspace shortcut menu without creating a chat message', async ({ page }) => {
  await page.goto('');
  const conversation = page.getByRole('region', { name: 'Conversation' });
  const before = await conversation.locator('.message').count();

  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  const menu = page.getByRole('group', { name: 'Google Workspace services' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Calendar', exact: true })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Tasks', exact: true })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Gmail', exact: true })).toBeVisible();
  await menu.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(menu.getByRole('button', { name: /Current schedule/ })).toBeVisible();
  await expect(menu.getByRole('button', { name: /Next five hours/ })).toBeVisible();
  await expect(conversation.locator('.message')).toHaveCount(before);
});

// The shortcut's user-visible prompt text (from DEFAULT_WORKSPACE_SHORTCUTS in
// src/app/quick-actions/shortcuts.ts). Since 2026-09-12 a shortcut prefills the
// composer with this text and the user sends it — the transcript and the
// provider input must match it exactly, with no app-authored wrapper.
const CALENDAR_TODAY_INTENT = 'Summarize today’s calendar in chronological order. Highlight overlaps, back-to-back events, and anything starting soon.';
const TASKS_DUE_TODAY_INTENT = 'Show Google Tasks due today. Group by task list and identify anything that is already overdue or needs immediate attention.';

test('prefills the composer with the shortcut’s visible intent without starting a turn', async ({ page }) => {
  await page.goto('');
  await unlockTestGemini(page);
  let providerRequests = 0;
  await page.route('**/v1/interactions*', async (route) => {
    providerRequests += 1;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Provider unavailable.' }) });
  });
  const conversation = page.getByRole('region', { name: 'Conversation' });
  const before = await conversation.locator('.message').count();

  await expect.poll(() => readStoredShortcutEnabled(page, 'calendar-today')).toBe(true);
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  const menu = page.getByRole('group', { name: 'Google Workspace services' });
  await menu.getByRole('button', { name: 'Calendar', exact: true }).click();
  await menu.getByRole('button', { name: /Today/ }).click();

  // The intent lands in the composer as the user's own editable draft: no
  // provider call, no transcript change, nothing hidden.
  await expect(page.getByRole('textbox', { name: 'Message Elara' })).toHaveValue(CALENDAR_TODAY_INTENT);
  expect(providerRequests).toBe(0);
  await expect(conversation.locator('.message')).toHaveCount(before);
});

test('sends the prefilled shortcut as an ordinary turn: provider input equals the visible message text', async ({ page }) => {
  await page.goto('');
  await unlockTestGemini(page);
  const inputs: string[] = [];
  await page.route('**/v1/interactions*', async (route) => {
    const payload = JSON.parse(route.request().postData() ?? '{}') as { input?: unknown };
    if (typeof payload.input === 'string') inputs.push(payload.input);
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Provider unavailable.' }) });
  });
  const conversation = page.getByRole('region', { name: 'Conversation' });
  const beforeUser = await conversation.locator('.message-user').count();

  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  const menu = page.getByRole('group', { name: 'Google Workspace services' });
  await menu.getByRole('button', { name: 'Tasks', exact: true }).click();
  await menu.getByRole('button', { name: /Due today/ }).click();

  const composer = page.getByRole('textbox', { name: 'Message Elara' });
  await expect(composer).toHaveValue(TASKS_DUE_TODAY_INTENT);
  await page.getByRole('button', { name: 'Send message' }).click();

  // The single provider input is exactly the visible text: no synthesized
  // wrapper, no hidden task. Any extra app-authored characters fail here.
  await expect.poll(() => inputs.length).toBe(1);
  expect(inputs[0]).toBe(TASKS_DUE_TODAY_INTENT);
  // The transcript records the same text as a real user message.
  await expect(conversation.locator('.message-user')).toHaveCount(beforeUser + 1);
  await expect(conversation.locator('.message-user', { hasText: TASKS_DUE_TODAY_INTENT })).toHaveCount(1);
  await expect(composer).toHaveValue('');
});

async function readStoredShortcutEnabled(page: import('@playwright/test').Page, id: string): Promise<boolean | undefined> {
  return page.evaluate(async (shortcutId) => await new Promise<boolean | undefined>((resolve, reject) => {
    const request = indexedDB.open('elara-angelic-utility-applet');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('workspaceShortcuts')) {
        db.close();
        resolve(undefined);
        return;
      }
      const transaction = db.transaction('workspaceShortcuts', 'readonly');
      const getRequest = transaction.objectStore('workspaceShortcuts').get(shortcutId);
      getRequest.onerror = () => {
        db.close();
        reject(getRequest.error);
      };
      getRequest.onsuccess = () => {
        const value = getRequest.result as { enabled?: boolean } | undefined;
        db.close();
        resolve(value?.enabled);
      };
    };
  }), id);
}

test('persists Workspace shortcut enablement in Google settings', async ({ page }) => {
  await page.goto('');
  await openSettings(page);
  await page.getByRole('button', { name: 'Google' }).click();
  const toggle = page.getByRole('checkbox', { name: 'Current schedule enabled' });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await expect.poll(() => readStoredShortcutEnabled(page, 'calendar-current')).toBe(false);
  await page.reload();
  await openSettings(page);
  await page.getByRole('button', { name: 'Google' }).click();
  await expect(page.getByRole('checkbox', { name: 'Current schedule enabled' })).not.toBeChecked();
});
