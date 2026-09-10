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

test('executes a shortcut as an internal task rather than an injected user prompt', async ({ page }) => {
  await page.goto('');
  await unlockTestGemini(page);
  let requestInput = '';
  await page.route('**/v1/interactions*', async (route) => {
    const payload = JSON.parse(route.request().postData() ?? '{}') as { input?: unknown };
    requestInput = typeof payload.input === 'string' ? payload.input : '';
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Provider unavailable.' }) });
  });
  const conversation = page.getByRole('region', { name: 'Conversation' });
  const before = await conversation.locator('.message').count();

  await expect.poll(() => readStoredShortcutEnabled(page, 'calendar-today')).toBe(true);
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  const menu = page.getByRole('group', { name: 'Google Workspace services' });
  await menu.getByRole('button', { name: 'Calendar', exact: true }).click();
  await menu.getByRole('button', { name: /Today/ }).click();

  await expect.poll(() => requestInput).toContain('Execute the saved Workspace shortcut');
  await expect(conversation.locator('.message')).toHaveCount(before);
  expect(requestInput).toContain('Use only the registered tools supplied for this shortcut.');
});

test('runs a shortcut through the internal Workspace path without a visible user message', async ({ page }) => {
  await page.goto('');
  await unlockTestGemini(page);
  let requestInput = '';
  await page.route('**/v1/interactions*', async (route) => {
    const payload = JSON.parse(route.request().postData() ?? '{}') as { input?: unknown };
    requestInput = typeof payload.input === 'string' ? payload.input : '';
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Provider unavailable.' }) });
  });
  const conversation = page.getByRole('region', { name: 'Conversation' });
  const before = await conversation.locator('.message').count();

  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  const menu = page.getByRole('group', { name: 'Google Workspace services' });
  await menu.getByRole('button', { name: 'Tasks', exact: true }).click();
  await menu.getByRole('button', { name: /Due today/ }).click();

  await expect.poll(() => requestInput).toContain('Execute the saved Workspace shortcut');
  await expect(conversation.locator('.message')).toHaveCount(before);
  // The draft composer is untouched: no synthetic prompt was typed for the user.
  await expect(page.getByRole('textbox', { name: 'Message Elara' })).toHaveValue('');
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
