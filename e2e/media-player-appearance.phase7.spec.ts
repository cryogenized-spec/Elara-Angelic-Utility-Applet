import { expect, test } from '@playwright/test';

async function openAppearanceSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Appearance' }).click();
}

test('persists the global player shell preset through the existing chat appearance authority', async ({ page }) => {
  await page.goto('');

  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-elara-media-player-preset', 'glass');

  await openAppearanceSettings(page);
  const presets = page.getByRole('radiogroup', { name: 'Media player surface preset' });
  await expect(presets.getByRole('radio', { name: 'Glass' })).toHaveAttribute('aria-checked', 'true');

  await presets.getByRole('radio', { name: 'Cinema' }).click();
  await expect(root).toHaveAttribute('data-elara-media-player-preset', 'cinema');

  await page.reload();
  await expect(root).toHaveAttribute('data-elara-media-player-preset', 'cinema');

  await openAppearanceSettings(page);
  await expect(page.getByRole('radiogroup', { name: 'Media player surface preset' }).getByRole('radio', { name: 'Cinema' }))
    .toHaveAttribute('aria-checked', 'true');
});
