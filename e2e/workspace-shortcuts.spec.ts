import { expect, test } from '@playwright/test';

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

test('persists Workspace shortcut enablement in Google settings', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Google' }).click();
  const toggle = page.getByRole('checkbox', { name: 'Current schedule enabled' });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.reload();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Google' }).click();
  await expect(page.getByRole('checkbox', { name: 'Current schedule enabled' })).not.toBeChecked();
});
