import { expect, test } from '@playwright/test';

async function openSettings(page: Parameters<typeof test>[0]['page']) {
  await page.getByRole('button', { name: 'Settings' }).click();
}

test.describe('Android portrait reliability', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('');
    await expect(page.locator('.app-shell')).toBeVisible();
  });

  test('keeps the composer visible when the sidebar opens and closes', async ({ page }) => {
    const composer = page.locator('[data-testid="composer"]');
    await expect(composer).toBeVisible();
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    await expect(sidebar).toHaveClass(/is-open/);
    await expect(composer).toBeVisible();
    await sidebar.getByRole('button', { name: 'Close sidebar' }).click();
    await expect(sidebar).not.toHaveClass(/is-open/);
    await expect(composer).toBeVisible();
  });

  test('persists presentation and chat typography settings across reload', async ({ page }) => {
    await page.goto('');
    await openSettings(page);

    await page.getByRole('button', { name: 'Typography' }).click();
    const chatTextSize = page.getByRole('slider', { name: 'Chat text size' });
    await expect(chatTextSize).toBeVisible();
    await chatTextSize.fill('21');

    await page.getByRole('radio', { name: 'Manrope', exact: true }).click();
    await page.getByRole('button', { name: 'Appearance' }).click();
    const portraitScale = page.getByRole('slider', { name: 'Character presentation scale' });
    await portraitScale.fill('3');
    await page.getByRole('radio', { name: 'Rose', exact: true }).click();

    await page.getByRole('button', { name: 'Back to chat' }).click();
    await expect(page.locator('.app-shell')).toHaveCSS('font-family', /Manrope/);

    await page.reload();
    await expect(page.locator('.app-shell')).toHaveCSS('font-family', /Manrope/);
    await openSettings(page);
    await page.getByRole('button', { name: 'Typography' }).click();
    await expect(page.getByRole('slider', { name: 'Chat text size' })).toHaveValue('21');
    await page.getByRole('button', { name: 'Appearance' }).click();
    await expect(page.getByRole('slider', { name: 'Character presentation scale' })).toHaveValue('3');
  });

  test('preserves the settings layout on narrow portrait viewports', async ({ page }) => {
    await openSettings(page);
    await expect(page.locator('.settings-screen')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Appearance' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Google' })).toBeVisible();
  });
});
