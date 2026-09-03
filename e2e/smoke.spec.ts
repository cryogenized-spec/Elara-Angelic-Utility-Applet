import { expect, test } from '@playwright/test';

test('loads the Elara shell', async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('heading', { name: 'Elara' })).toBeVisible();
  await expect(page.getByPlaceholder('Message Elara…')).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest\.webmanifest$/);
});
