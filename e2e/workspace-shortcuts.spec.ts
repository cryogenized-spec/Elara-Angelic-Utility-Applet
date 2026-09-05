import { expect, test } from '@playwright/test';

async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
}

test('opens a Workspace shortcut menu without creating a chat message', async ({ page }) => {
  await page.goto('');
  const conversation = page.getByRole('region', { name: 'Conversation' });
  const before = await conversation.locator('.message').count();

  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'calendar shortcuts' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Current schedule/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Next five hours/ })).toBeVisible();
  await expect(conversation.locator('.message')).toHaveCount(before);
});

test('executes a shortcut as an internal task rather than an injected user prompt', async ({ page }) => {
  await page.goto('');
  await page.route('**/api/gemini', (route) => route.abort('failed'));
  const conversation = page.getByRole('region', { name: 'Conversation' });
  const before = await conversation.locator('.message').count();

  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByRole('menuitem', { name: /Today/ }).click();

  await expect(conversation.locator('.message')).toHaveCount(before + 1);
  await expect(conversation.locator('.message').last()).not.toContainText('Execute the saved Workspace shortcut');
  await expect(page.getByRole('alert')).toContainText('[GEMINI_UNKNOWN]');
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
