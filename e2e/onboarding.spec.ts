import { expect, test } from '@playwright/test';

test.describe('First-run onboarding', () => {
  test('opens on a fresh install with an empty Master Prompt', async ({ page }) => {
    await page.goto('');

    const dialog = page.getByRole('dialog', { name: 'Welcome.' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Your Master Prompt')).toHaveValue('');
    await expect(dialog.getByRole('button', { name: 'Neutral & Friendly' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Hotdog Skeleton' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Intergalactic Tyrant' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Pensive “Neow”' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Shadow Chessmaster' })).toBeVisible();
  });

  test('selecting a template fills the Master Prompt and persists it when entering', async ({ page }) => {
    await page.goto('');
    const dialog = page.getByRole('dialog', { name: 'Welcome.' });
    const prompt = dialog.getByLabel('Your Master Prompt');

    await dialog.getByRole('button', { name: 'Hotdog Skeleton' }).click();
    await expect(prompt).toHaveValue(/skeleton/i);
    await dialog.getByRole('button', { name: 'Enter' }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Welcome.' })).toHaveCount(0);
  });

  test('Start empty completes onboarding without creating a Master Prompt', async ({ page }) => {
    await page.goto('');
    const dialog = page.getByRole('dialog', { name: 'Welcome.' });
    await dialog.getByRole('button', { name: 'Start empty' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.master-prompt-warning')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Welcome.' })).toHaveCount(0);
    await expect(page.locator('.master-prompt-warning')).toBeVisible();
  });
});
