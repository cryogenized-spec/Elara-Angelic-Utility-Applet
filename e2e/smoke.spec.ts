import { expect, test } from '@playwright/test';

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const pngFile = (name: string) => ({ name, mimeType: 'image/png', buffer: tinyPng });

async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
}

async function unlockTestGemini(page: import('@playwright/test').Page): Promise<void> {
  await openSettings(page);
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill('e2e-test-api-key');
  await page.getByRole('textbox', { name: 'Lockbox password', exact: true }).fill('e2e-test-password');
  await page.getByLabel('Confirm Lockbox password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

test('loads the Elara shell', async ({ page }) => {
  await page.goto('');
  await expect(page.locator('.elara-banner')).toBeVisible();
  await expect(page.getByPlaceholder('Message Elara…')).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest\.webmanifest$/);
  await expect(page.locator('.elara-banner__portrait')).toBeVisible();
});

test('composer keeps attachment, Markdown, and Send controls aligned', async ({ page }) => {
  await page.goto('');
  const composer = page.locator('form.composer');
  await expect(composer.getByRole('button', { name: 'Attach image or document' })).toBeVisible();
  await expect(composer.getByRole('button', { name: 'Expand message editor' })).toBeVisible();
  await expect(composer.getByRole('button', { name: 'Markdown reference' })).toBeVisible();
  await expect(composer.getByRole('button', { name: 'Send message' })).toBeVisible();

  const attachmentBox = await composer.getByRole('button', { name: 'Attach image or document' }).boundingBox();
  const inputBox = await composer.getByPlaceholder('Message Elara…').boundingBox();
  const markdownBox = await composer.getByRole('button', { name: 'Markdown reference' }).boundingBox();
  const sendBox = await composer.getByRole('button', { name: 'Send message' }).boundingBox();
  expect(attachmentBox && inputBox && markdownBox && sendBox).toBeTruthy();
  expect(attachmentBox!.x).toBeLessThan(inputBox!.x);
  expect(markdownBox!.x).toBeLessThan(sendBox!.x);
  expect(Math.abs(markdownBox!.y - sendBox!.y)).toBeLessThan(2);
  expect(Math.abs(attachmentBox!.y - sendBox!.y)).toBeLessThan(2);
});

test('collapses the character banner when the sidebar opens', async ({ page }) => {
  await page.goto('');
  const banner = page.locator('.elara-banner');
  const sidebar = page.getByRole('complementary', { name: 'Chat threads' });
  await expect(banner).not.toHaveClass(/is-collapsed/);
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await expect(banner).toHaveClass(/is-collapsed/);
  await expect(sidebar).toHaveClass(/is-open/);
  await sidebar.getByRole('button', { name: 'Close sidebar' }).click();
  await expect(banner).not.toHaveClass(/is-collapsed/);
});

test('persists character presentation settings and disables impossible horizontal focus', async ({ page }) => {
  await page.goto('');
  await openSettings(page);
  await page.getByRole('button', { name: 'Character' }).click();
  const landscape = page.getByRole('radio', { name: /Landscape · 16:6/ });
  await page.locator('input[type="file"]').setInputFiles(pngFile('elara.png'));
  await landscape.click();

  const horizontal = page.getByRole('slider', { name: 'Horizontal focus' });
  const vertical = page.getByRole('slider', { name: 'Vertical focus' });
  await expect(horizontal).toBeDisabled();
  await expect(horizontal).toHaveValue('50');
  await vertical.fill('25');

  await page.reload();
  await openSettings(page);
  await page.getByRole('button', { name: 'Character' }).click();
  await expect(page.getByRole('radio', { name: /Landscape · 16:6/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('slider', { name: 'Horizontal focus' })).toHaveValue('50');
  await expect(page.getByRole('slider', { name: 'Horizontal focus' })).toBeDisabled();
  await expect(page.getByRole('slider', { name: 'Vertical focus' })).toHaveValue('25');
});

test('persists chat appearance settings', async ({ page }) => {
  await page.goto('');
  await openSettings(page);
  await page.getByRole('button', { name: 'Appearance' }).click();
  const chatBackground = page.getByRole('radiogroup', { name: 'Chat background mode' });
  await chatBackground.getByRole('radio', { name: 'Gradient' }).click();
  await page.getByRole('button', { name: 'Violet', exact: true }).click();
  await page.getByLabel('Elara text colour hex').fill('#FF00AA');
  await page.getByLabel('Elara text colour hex').blur();
  await page.reload();
  await openSettings(page);
  await page.getByRole('button', { name: 'Appearance' }).click();
  await expect(chatBackground.getByRole('radio', { name: 'Gradient' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Elara text colour hex')).toHaveValue('#FF00AA');
});

test('keeps roleplay opt-in and persists its environment settings', async ({ page }) => {
  await page.goto('');
  await openSettings(page);
  await page.getByRole('button', { name: 'Roleplay' }).click();
  const toggle = page.getByRole('switch');
  const environment = page.locator('.roleplay-detail select');
  if (await toggle.getAttribute('aria-checked') === 'true') await toggle.click();
  await expect(environment).toHaveCount(0);
  await toggle.click();
  await environment.selectOption('poolside');
  await page.getByLabel('Environment name').fill('Sunset villa');
  await page.reload();
  await openSettings(page);
  await page.getByRole('button', { name: 'Roleplay' }).click();
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.roleplay-detail select')).toHaveValue('poolside');
  await expect(page.getByLabel('Environment name')).toHaveValue('Sunset villa');
});

test('exposes the local API Lockbox rather than the retired Worker boundary', async ({ page }) => {
  await page.goto('');
  await openSettings(page);
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await expect(page.getByRole('heading', { name: 'Gemini API' })).toBeVisible();
  await expect(page.getByText(/The API key is encrypted locally in Dexie/)).toBeVisible();
});

test('normalizes a direct Gemini network failure without fabricating a response', async ({ page }) => {
  await page.goto('');
  await unlockTestGemini(page);
  await page.route('**/v1beta/interactions*', (route) => route.abort('failed'));
  const composer = page.getByRole('textbox', { name: 'Message Elara' });
  await composer.fill('Verify the live runtime boundary');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('[GEMINI_UNKNOWN]');
  await expect(page.getByText('Verify the live runtime boundary')).toBeVisible();
});

test('opens Workspace quick-action surfaces without injecting a chat prompt', async ({ page }) => {
  await page.goto('');
  const conversation = page.getByRole('region', { name: 'Conversation' });
  const before = await conversation.locator('.message').count();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  const calendarSurface = page.getByRole('region', { name: 'Calendar action surface' });
  await expect(calendarSurface).toBeVisible();
  await expect(calendarSurface.getByText('Capability · calendar.events.read')).toBeVisible();
  await expect(conversation.locator('.message')).toHaveCount(before);
});

test('renders the supported Markdown reference', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Markdown reference' }).click();
  const dialog = page.getByRole('dialog', { name: 'Markdown' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Italic', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Bold italic', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Roleplay action', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close Markdown reference' }).click();
  await expect(dialog).not.toBeVisible();
});
