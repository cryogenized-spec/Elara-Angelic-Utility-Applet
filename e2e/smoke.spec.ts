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
