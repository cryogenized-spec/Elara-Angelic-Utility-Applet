import { expect, test } from '@playwright/test';

test('loads the Elara shell', async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('heading', { name: 'Elara' })).toBeVisible();
  await expect(page.getByPlaceholder('Message Elara…')).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest\.webmanifest$/);
  await expect(page.getByRole('img', { name: 'Elara portrait placeholder' })).toBeVisible();
});

test('collapses the Elara portrait when the sidebar opens', async ({ page }) => {
  await page.goto('');
  const banner = page.getByRole('region', { name: 'Elara portrait banner' });
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
  const rangeSetting = slider.locator('xpath=..');
  await expect(slider).toHaveValue('15');
  await expect(rangeSetting.locator('output')).toHaveText('15px');
  await slider.fill('20');
  await expect(slider).toHaveValue('20');
  await expect(rangeSetting.locator('output')).toHaveText('20px');
});

test('controls portrait scale and background from Appearance settings', async ({ page }) => {
  await page.goto('');
  const banner = page.getByRole('region', { name: 'Elara portrait banner' });
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Appearance' }).click();

  const scale = page.getByRole('slider', { name: 'Portrait scale' });
  const scaleSetting = scale.locator('xpath=..');
  await expect(scale).toHaveValue('2');
  await scale.fill('3');
  await expect(scaleSetting.locator('output')).toHaveText('3×');
  await page.getByRole('radio', { name: /Blue Hour/ }).click();
  await page.getByRole('button', { name: 'Back to chat' }).click();
  await expect(banner).toHaveClass(/portrait-scale-3/);
  await expect(banner).toHaveClass(/portrait-background-blue-hour/);
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

test('exposes Gemini model controls and states the protected transport boundary', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Open settings' }).click();

  await page.getByRole('button', { name: 'Gemini' }).click();
  await expect(page.getByLabel('Model')).toBeVisible();
  await expect(page.getByText(/Supported levels only/)).toBeVisible();
  await expect(page.getByText(/Settings save automatically/)).toBeVisible();

  await page.getByRole('button', { name: 'Chat' }).click();
  await expect(page.getByText(/Protected Worker boundary/)).toBeVisible();
});

test('shows an explicit Worker configuration failure instead of fabricating a response', async ({ page }) => {
  await page.goto('');
  const composer = page.getByRole('textbox', { name: 'Message Elara' });
  await composer.fill('Verify the live runtime boundary');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('Gemini Worker endpoint is not configured');
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
  await calendarSurface.getByRole('button', { name: 'Close Calendar action surface' }).click();

  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Tasks action surface' })).toBeVisible();
  await page.getByRole('button', { name: 'Gmail', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Gmail action surface' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Gmail', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
