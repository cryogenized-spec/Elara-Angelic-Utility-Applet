import { expect, test } from '@playwright/test';

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const pngFile = (name: string) => ({ name, mimeType: 'image/png', buffer: tinyPng });

async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
}

test('renders exactly one character artwork presentation mode', async ({ page }) => {
  await page.goto('');
  await openSettings(page);
  await page.getByRole('button', { name: 'Character' }).click();
  await page.locator('input[type="file"]').setInputFiles(pngFile('elara.png'));

  await page.getByRole('radio', { name: /Landscape · 16:6/ }).click();
  await page.getByRole('button', { name: 'Back to chat' }).click();
  await expect(page.locator('.elara-banner__landscape')).toBeVisible();
  await expect(page.locator('.elara-banner__portrait')).toHaveCount(0);

  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Character' }).click();
  await page.getByRole('radio', { name: /Portrait · 4:5/ }).click();
  await page.getByRole('button', { name: 'Back to chat' }).click();
  await expect(page.locator('.elara-banner__portrait')).toBeVisible();
  await expect(page.locator('.elara-banner__landscape')).toHaveCount(0);
});

test('applies and persists a selected chat background image', async ({ page }) => {
  await page.goto('');
  await openSettings(page);
  await page.getByRole('button', { name: 'Appearance' }).click();
  const modes = page.getByRole('radiogroup', { name: 'Chat background mode' });
  await modes.getByRole('radio', { name: 'Image' }).click();
  await page.getByRole('button', { name: 'Choose background image' }).click();
  await page.locator('input[type="file"]').setInputFiles(pngFile('background.png'));

  await page.getByRole('button', { name: 'Back to chat' }).click();
  await expect(page.locator('.app-shell__background')).toBeVisible();
  await expect.poll(async () => page.locator('.app-shell__background').evaluate((element) => getComputedStyle(element).backgroundImage)).toContain('data:image/png;base64');

  await page.reload();
  await expect.poll(async () => page.locator('.app-shell__background').evaluate((element) => getComputedStyle(element).backgroundImage)).toContain('data:image/png;base64');
});
