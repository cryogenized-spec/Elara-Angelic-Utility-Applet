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

test('shows local font choices and the 10–20px text size slider', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Typography' }).click();

  await expect(page.getByText('The quick brown fox jumps over the lazy dog.').first()).toBeVisible();
  const slider = page.getByRole('slider', { name: 'Text size' });
  const rangeSetting = slider.locator('xpath=..');
  await expect(slider).toHaveValue('15');
  await expect(rangeSetting.locator('output')).toHaveText('15px');

  await slider.dispatchEvent('pointerdown');
  await expect(slider).toHaveClass(/is-hot/);
  await slider.dispatchEvent('pointerup');
  await expect(slider).not.toHaveClass(/is-hot/);

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
  await expect(scaleSetting.locator('output')).toHaveText('2×');
  await scale.fill('3');
  await expect(scale).toHaveValue('3');
  await expect(scaleSetting.locator('output')).toHaveText('3×');

  await page.getByRole('radio', { name: /Blue Hour/ }).click();
  await page.getByRole('button', { name: 'Back to chat' }).click();
  await expect(banner).toHaveClass(/portrait-scale-3/);
  await expect(banner).toHaveClass(/portrait-background-blue-hour/);

  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await expect(banner).toHaveClass(/is-collapsed/);
  await page.getByRole('complementary', { name: 'Chat threads' }).getByRole('button', { name: 'Close sidebar' }).click();
  await expect(banner).toHaveClass(/portrait-scale-3/);
  await expect(banner).toHaveClass(/portrait-background-blue-hour/);
});

test('renders an assistant execution summary that expands into numbered safe steps', async ({ page }) => {
  await page.goto('');
  const composer = page.getByRole('textbox', { name: 'Message Elara' });
  await composer.fill('Show me a useful demo turn');
  await page.getByRole('button', { name: 'Send message' }).click();

  await expect(page.getByText('Demo response received: Show me a useful demo turn')).toBeVisible();
  const summary = page.getByRole('region', { name: 'Execution summary' });
  await expect(summary).toBeVisible();
  await expect(summary.getByText(/ms$/)).toBeVisible();

  const toggle = summary.getByRole('button', { name: 'Execution summary' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(summary.locator('ol')).toBeVisible();
  await expect(summary.locator('li')).toHaveCount(3);
  await expect(summary.locator('.execution-summary__step-index')).toHaveText(['1', '2', '3']);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(summary.locator('ol')).toBeHidden();
});

test('supports multiline drafts, bounded composer growth, and explicit cancellation', async ({ page }) => {
  await page.goto('');
  const composer = page.getByRole('textbox', { name: 'Message Elara' });

  await composer.fill('First line');
  await composer.press('Shift+Enter');
  await composer.type('Second line');
  await expect(composer).toHaveValue('First line\nSecond line');

  await composer.press('Enter');
  await expect(page.getByRole('button', { name: 'Cancel response' })).toBeVisible();
  await expect(composer).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel response' }).click();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(composer).toBeEnabled();

  await composer.fill(Array.from({ length: 60 }, (_, index) => `line ${index}`).join('\n'));
  await expect(composer).toHaveCSS('max-height', '132px');
});

test('creates, searches, selects, renames, and restores conversation threads', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  const sidebar = page.getByRole('complementary', { name: 'Chat threads' });

  await sidebar.getByRole('button', { name: 'New chat' }).click();
  const composer = page.getByRole('textbox', { name: 'Message Elara' });
  await composer.fill('Plan a weekend trip to the Drakensberg');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Demo response received: Plan a weekend trip to the Drakensberg')).toBeVisible();

  await page.getByRole('button', { name: 'Open sidebar' }).click();
  const generatedTitle = sidebar.getByRole('button', { name: /Plan Weekend Trip Drakensberg/i });
  await expect(generatedTitle).toBeVisible();

  const search = sidebar.getByRole('textbox', { name: 'Search chats' });
  await search.fill('drakensberg');
  await expect(generatedTitle).toBeVisible();

  await generatedTitle.locator('xpath=following-sibling::details').locator('summary').click();
  await sidebar.getByRole('button', { name: 'Rename' }).click();
  const renameInput = sidebar.getByRole('textbox', { name: 'Thread name' });
  await expect(renameInput).toBeVisible();
  await renameInput.fill('Mountain Escape');
  await renameInput.press('Enter');
  await expect(sidebar.getByRole('button', { name: /Mountain Escape/i })).toBeVisible();

  await sidebar.getByRole('button', { name: /Mountain Escape/i }).click();
  await expect(page.getByText('Demo response received: Plan a weekend trip to the Drakensberg')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Demo response received: Plan a weekend trip to the Drakensberg')).toBeVisible();
});
