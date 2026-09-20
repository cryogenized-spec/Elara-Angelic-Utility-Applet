import { expect, test, type Page } from '@playwright/test';

async function openMemorySettings(page: Page): Promise<void> {
  await page.goto('');
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Memory' }).click();
  await expect(page.getByRole('heading', { name: 'Memory & continuity' })).toBeVisible();
}

test('Memory continuity preferences persist through the real Settings flow', async ({ page }) => {
  await openMemorySettings(page);

  const master = page.getByRole('switch', { name: 'Use memory' });
  await expect(master).toBeChecked();

  await page.getByRole('radio', { name: /Attentive/ }).click();
  await page.getByRole('radio', { name: /Proactive/ }).click();

  const pets = page.getByLabel(/Pets/);
  const health = page.getByLabel(/Health & wellbeing/);
  await expect(pets).toBeChecked();
  await expect(health).not.toBeChecked();

  await pets.uncheck();
  await health.check();
  await expect(page.locator('.memory-continuity-settings').getByRole('status')).toContainText('Memory preferences saved.');

  await page.reload();
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Memory' }).click();

  await expect(page.getByRole('radio', { name: /Attentive/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /Proactive/ })).toBeChecked();
  await expect(page.getByLabel(/Pets/)).not.toBeChecked();
  await expect(page.getByLabel(/Health & wellbeing/)).toBeChecked();
});

test('Memory master switch disables automatic controls without deleting their choices', async ({ page }) => {
  await openMemorySettings(page);

  await page.getByRole('radio', { name: /Selective/ }).click();
  await page.getByLabel(/Likes & dislikes/).uncheck();

  const master = page.getByRole('switch', { name: 'Use memory' });
  await master.click();
  await expect(master).not.toBeChecked();
  await expect(page.getByText(/Automatic recall and organic learning are off/)).toBeVisible();
  await expect(page.getByRole('radio', { name: /Selective/ })).toBeDisabled();
  await expect(page.getByLabel(/Likes & dislikes/)).toBeDisabled();
  await expect(page.locator('.memory-continuity-settings').getByRole('status')).toContainText('Memory preferences saved.');

  await page.reload();
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Memory' }).click();

  await expect(page.getByRole('switch', { name: 'Use memory' })).not.toBeChecked();

  await page.getByRole('switch', { name: 'Use memory' }).click();
  await expect(page.getByRole('radio', { name: /Selective/ })).toBeChecked();
  await expect(page.getByLabel(/Likes & dislikes/)).not.toBeChecked();
  await expect(page.locator('.memory-continuity-settings').getByRole('status')).toContainText('Memory preferences saved.');
});

test('Sensitive automatic-memory categories start off and remain individually opt-in', async ({ page }) => {
  await openMemorySettings(page);

  const sensitiveLabels = [
    /Health & wellbeing/,
    /Money & finances/,
    /Intimacy & sexuality/,
    /Religion & spirituality/,
    /Politics & civic views/,
    /Race & ethnicity/,
    /Legal & criminal history/,
    /Precise home & location details/,
  ];

  for (const label of sensitiveLabels) {
    await expect(page.getByLabel(label)).not.toBeChecked();
  }

  await expect(page.getByText('Off by default', { exact: true })).toBeVisible();
  await expect(page.getByText(/passwords, API keys, authentication tokens/i)).toBeVisible();
});
