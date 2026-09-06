import { expect, test } from '@playwright/test';

async function openRoleplay(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('');
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Roleplay' }).click();
}

test('Roleplay uses a persistent world canvas instead of environment forms', async ({ page }) => {
  await openRoleplay(page);
  const toggle = page.getByRole('switch', { name: 'Roleplay mode off' });
  await toggle.click();
  await expect(page.getByText('WORLD CANVAS', { exact: true })).toBeVisible();
  await expect(page.getByText('The canvas is empty. Describe the setting naturally in chat and Elara can propose the first location.')).toBeVisible();
  await expect(page.getByText('Runtime context')).toBeVisible();
  await expect(page.getByText('Natural language is enough.')).toBeVisible();
  await expect(page.getByText('Environment name')).toHaveCount(0);
  await expect(page.getByText('Time of day')).toHaveCount(0);
  await expect(page.getByText('Weather')).toHaveCount(0);
});
