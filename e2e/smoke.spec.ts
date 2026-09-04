import { expect, test } from '@playwright/test';

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const pngFile = (name: string) => ({ name, mimeType: 'image/png', buffer: tinyPng });

test('loads the Elara shell', async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('heading', { name: 'Elara' })).toBeVisible();
  await expect(page.getByPlaceholder('Message Elara…')).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest\.webmanifest$/);
  await expect(page.getByRole('img', { name: 'Elara portrait placeholder' })).toBeVisible();
});

test('composer keeps attachment left, VTT beside Send, and opens an expanded writing surface', async ({ page }) => {
  await page.goto('');
  const composer = page.locator('form.composer');
  await expect(composer.getByRole('button', { name: 'Attach image or document' })).toBeVisible();
  await expect(composer.getByRole('button', { name: 'Expand message editor' })).toBeVisible();
  await expect(composer.getByRole('button', { name: 'VTT reference' })).toBeVisible();
  await expect(composer.getByRole('button', { name: 'Send message' })).toBeVisible();

  const attachmentBox = await composer.getByRole('button', { name: 'Attach image or document' }).boundingBox();
  const inputBox = await composer.getByPlaceholder('Message Elara…').boundingBox();
  const vttBox = await composer.getByRole('button', { name: 'VTT reference' }).boundingBox();
  const sendBox = await composer.getByRole('button', { name: 'Send message' }).boundingBox();
  expect(attachmentBox && inputBox && vttBox && sendBox).toBeTruthy();
  expect(attachmentBox!.x).toBeLessThan(inputBox!.x);
  expect(vttBox!.x).toBeLessThan(sendBox!.x);
  expect(Math.abs(vttBox!.y - sendBox!.y)).toBeLessThan(2);
  expect(Math.abs(attachmentBox!.y - sendBox!.y)).toBeLessThan(2);

  await composer.getByRole('button', { name: 'Expand message editor' }).click();
  const expanded = page.getByRole('dialog', { name: 'Expanded message editor' });
  await expect(expanded).toBeVisible();
  await expect(expanded.getByRole('button', { name: 'Collapse message editor' })).toBeVisible();
  await expanded.getByRole('textbox', { name: 'Expanded message' }).fill('A longer essay draft');
  await expanded.getByRole('button', { name: 'Collapse message editor' }).click();
  await expect(expanded).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Elara' })).toHaveValue('A longer essay draft');
});

test('collapses the Elara character banner when the sidebar opens', async ({ page }) => {
  await page.goto('');
  const banner = page.getByRole('region', { name: 'Elara character banner' });
  const sidebar = page.getByRole('complementary', { name: 'Chat threads' });
  await expect(banner).toHaveClass(/elara-banner/);
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await expect(banner).toHaveClass(/is-collapsed/);
  await expect(sidebar).toHaveClass(/is-open/);
  await sidebar.getByRole('button', { name: 'Close sidebar' }).click();
  await expect(banner).not.toHaveClass(/is-collapsed/);
});

test('shows typography controls and applies the 10–20px text size range', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Typography' }).click();
  await expect(page.getByText('The quick brown fox jumps over the lazy dog.').first()).toBeVisible();
  const slider = page.getByRole('slider', { name: 'Text size' });
  await expect(slider).toHaveValue('15');
  await expect(slider.locator('xpath=..').locator('output')).toHaveText('15px');
  await slider.fill('20');
  await expect(slider).toHaveValue('20');
  await expect(slider.locator('xpath=..').locator('output')).toHaveText('20px');
});

test('controls character presentation scale and banner background from Appearance settings', async ({ page }) => {
  await page.goto('');
  const banner = page.getByRole('region', { name: 'Elara character banner' });
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Appearance' }).click();
  const scale = page.getByRole('slider', { name: 'Character presentation scale' });
  await expect(scale).toHaveValue('2');
  await scale.fill('3');
  await expect(scale.locator('xpath=..').locator('output')).toHaveText('3×');
  await page.getByRole('radio', { name: /Blue Hour/ }).click();
  await page.getByRole('button', { name: 'Back to chat' }).click();
  await expect(banner).toHaveClass(/portrait-scale-3/);
  await expect(banner).toHaveClass(/portrait-background-blue-hour/);
});

test('character identity and master prompt persist independently of tool settings', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Character' }).click();
  await page.getByLabel('AI character name').fill('Elara Prime');
  await page.getByLabel('Master system prompt').fill('Be concise, perceptive, and warmly creative.');
  await page.reload();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Character' }).click();
  await expect(page.getByLabel('AI character name')).toHaveValue('Elara Prime');
  await expect(page.getByLabel('Master system prompt')).toHaveValue('Be concise, perceptive, and warmly creative.');
  await expect(page.getByText(/Tool schemas, exposed capabilities, tool-use rules, authorization, confirmation, provider transport, and security/)).toBeVisible();
});

test('switches between one active portrait or landscape artwork mode and persists focus', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Character' }).click();
  const portrait = page.getByRole('radio', { name: /Portrait · 4:5/ });
  const landscape = page.getByRole('radio', { name: /Landscape · 16:6/ });
  await expect(portrait).toHaveAttribute('aria-checked', 'true');
  await expect(landscape).toHaveAttribute('aria-checked', 'false');
  await page.locator('input[type="file"]').setInputFiles(pngFile('elara.png'));
  await expect(page.getByRole('img', { name: 'Current character artwork' })).toBeVisible();
  await landscape.click();
  await expect(landscape).toHaveAttribute('aria-checked', 'true');
  await expect(portrait).toHaveAttribute('aria-checked', 'false');
  const horizontal = page.getByRole('slider', { name: 'Horizontal focus' });
  const vertical = page.getByRole('slider', { name: 'Vertical focus' });
  await horizontal.fill('80');
  await vertical.fill('25');
  await page.reload();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Character' }).click();
  await expect(page.getByRole('radio', { name: /Landscape · 16:6/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('slider', { name: 'Horizontal focus' })).toHaveValue('80');
  await expect(page.getByRole('slider', { name: 'Vertical focus' })).toHaveValue('25');
});

test('chat background, speaker colours, and user surface style persist', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Appearance' }).click();
  const chatBackground = page.getByRole('radiogroup', { name: 'Chat background mode' });
  await chatBackground.getByRole('radio', { name: 'Gradient' }).click();
  await page.getByRole('button', { name: 'Violet', exact: true }).click();
  await page.getByLabel('Background opacity').fill('0.72');
  await page.getByLabel('Readability overlay').fill('0.64');
  await page.getByLabel('Background blur').fill('4');
  await page.getByLabel('Elara text colour hex').fill('#FF00AA');
  await page.getByLabel('Elara text colour hex').blur();
  await page.getByLabel('User text colour hex').fill('#00FFB0');
  await page.getByLabel('User text colour hex').blur();
  await page.getByRole('radiogroup', { name: 'User message surface style' }).getByRole('radio', { name: 'Gradient' }).click();
  await page.getByLabel('Surface opacity').fill('0.66');
  await page.reload();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Appearance' }).click();
  await expect(chatBackground.getByRole('radio', { name: 'Gradient' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Elara text colour hex')).toHaveValue('#FF00AA');
  await expect(page.getByLabel('User text colour hex')).toHaveValue('#00FFB0');
  await expect(page.getByRole('radiogroup', { name: 'User message surface style' }).getByRole('radio', { name: 'Gradient' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Surface opacity')).toHaveValue('0.66');
});

test('chat image background accepts the supported local image formats', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('radiogroup', { name: 'Chat background mode' }).getByRole('radio', { name: 'Image' }).click();
  await page.locator('input[type="file"]').setInputFiles(pngFile('background.png'));
  await page.reload();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Appearance' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Chat background mode' }).getByRole('radio', { name: 'Image' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Choose background image' })).toBeVisible();
});

test('roleplay stays opt-in and reveals environment controls only when enabled', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Roleplay' }).click();
  const toggle = page.getByRole('switch');
  const environment = page.locator('.roleplay-detail select');
  await expect(toggle).toHaveCount(1);
  if (await toggle.getAttribute('aria-checked') === 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(environment).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(environment).toBeVisible();
  await environment.selectOption('poolside');
  await page.getByLabel('Environment name').fill('Sunset villa');
  await page.getByLabel('Environment description').fill('Open terrace beside a quiet pool.');
  await page.getByLabel('Time of day').fill('Late afternoon');
  await page.getByLabel('Weather').fill('Warm and clear');
  await page.getByLabel('Atmosphere / mood').fill('Quiet and cinematic');
  await page.reload();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Roleplay' }).click();
  const persistedToggle = page.getByRole('switch');
  const persistedEnvironment = page.locator('.roleplay-detail select');
  await expect(persistedToggle).toHaveCount(1);
  await expect(persistedToggle).toHaveAttribute('aria-checked', 'true');
  await expect(persistedEnvironment).toHaveValue('poolside');
  await expect(page.getByLabel('Environment name')).toHaveValue('Sunset villa');
  await expect(page.getByLabel('Environment description')).toHaveValue('Open terrace beside a quiet pool.');
  await persistedToggle.click();
  await expect(persistedEnvironment).toHaveCount(0);
});

test('Markdown reference exposes exactly the supported composer syntax', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'VTT reference' }).click();
  const dialog = page.getByRole('dialog', { name: 'Markdown' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Italic', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Bold italic', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Roleplay action', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Raw HTML, scripts, embeds, arbitrary CSS/)).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Full Markdown format documentation/ })).toHaveAttribute('href', /MARKDOWN_FORMAT\.md$/);
  await dialog.getByRole('button', { name: 'Close Markdown reference' }).click();
  await expect(dialog).not.toBeVisible();
});

test('normalizes a simulated Worker network failure without fabricating a response', async ({ page }) => {
  await page.goto('');
  await page.route('**/api/gemini', (route) => route.abort('failed'));
  const composer = page.getByRole('textbox', { name: 'Message Elara' });
  await composer.fill('Verify the live runtime boundary');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('[GEMINI_UNKNOWN]');
  await expect(page.getByText('Verify the live runtime boundary')).toBeVisible();
});

test('exposes Gemini model controls and the protected transport boundary', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Gemini' }).click();
  await expect(page.getByLabel('Model')).toBeVisible();
  await expect(page.getByText(/Temperature, top-p and top-k are intentionally not offered/)).toBeVisible();
  await expect(page.getByText(/Settings save automatically/)).toBeVisible();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByText(/Protected Worker boundary/)).toBeVisible();
});

test('keeps multiline drafts bounded without requiring a live model call', async ({ page }) => {
  await page.goto('');
  const composer = page.getByRole('textbox', { name: 'Message Elara' });
  await composer.fill('First line');
  await composer.press('Shift+Enter');
  await composer.type('Second line');
  await expect(composer).toHaveValue('First line\nSecond line');
  await composer.fill(Array.from({ length: 60 }, (_, index) => `line ${index}`).join('\n'));
  await expect(composer).toHaveCSS('max-height', '132px');
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
  await calendarSurface.getByRole('button', { name: 'Close Calendar action surface' }).click();
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Tasks action surface' })).toBeVisible();
  await page.getByRole('button', { name: 'Gmail', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Gmail action surface' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Gmail', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
