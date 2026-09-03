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
