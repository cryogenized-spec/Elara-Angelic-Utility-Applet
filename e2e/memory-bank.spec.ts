import { expect, test, type Page } from '@playwright/test';

async function openMemoryBank(page: Page): Promise<void> {
  await page.goto('');
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Memory Bank' }).click();
  await expect(page.getByText('One human-facing view over the canonical durable-memory store.', { exact: false })).toBeVisible();
}

async function createMemory(page: Page, title: string, body: string): Promise<void> {
  await page.getByRole('button', { name: 'New memory' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel(/Memory body/).fill(body);
  await page.getByRole('button', { name: 'Create memory' }).click();
  await expect(page.locator('.memory-card').filter({ hasText: title }).first()).toBeVisible();
}

test('Memory Bank landmarks and audit stay on the canonical store', async ({ page }) => {
  await openMemoryBank(page);
  await createMemory(page, 'Pass 5 duplicate', 'A deliberately duplicated durable fact.');
  await createMemory(page, 'Pass 5 duplicate', 'A deliberately duplicated durable fact.');

  const cards = page.locator('.memory-card').filter({ hasText: 'Pass 5 duplicate' });
  await expect(cards).toHaveCount(2);
  await cards.first().getByRole('button').first().click();
  await cards.first().getByRole('button', { name: 'Pin landmark' }).click();
  await expect(cards.first().getByText('Landmark', { exact: true })).toBeVisible();

  await page.getByLabel('Filter').selectOption('pinned');
  await expect(page.locator('.memory-card')).toHaveCount(1);
  await page.getByLabel('Filter').selectOption('all');

  await page.getByRole('button', { name: 'Audit Memory Bank' }).click();
  await expect(page.getByRole('status')).toContainText('Reviewed 2 memories. No changes were made.');
  await expect(page.getByLabel('Memory maintenance summary')).toContainText('1 duplicate group');
  await expect(page.getByText('Exact duplicate review')).toBeVisible();

  await page.getByLabel('Filter').selectOption('provenance:explicit-user');
  await expect(page.locator('.memory-card')).toHaveCount(2);
});

test('Memory Bank exports locally and imports through the guarded archive boundary', async ({ page }) => {
  test.setTimeout(25_000);
  await openMemoryBank(page);
  await createMemory(page, 'Archive round trip', 'This record should return with a fresh imported identity.');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  await expect(page.getByRole('status')).toContainText('Exported 1 memories');

  await page.locator('input.memory-archive__file').setInputFiles(path!);
  await expect(page.getByText(/1 memories · 0 CORE records will restart as CONTEXTUAL/)).toBeVisible();
  await page.getByRole('button', { name: 'Import 1' }).click();
  await expect(page.getByRole('status')).toContainText('Imported 1 memories');
  await expect(page.getByText(/2 stored · canonical store/)).toBeVisible();

  await page.getByLabel('Filter').selectOption('provenance:imported');
  await expect(page.locator('.memory-card')).toHaveCount(1);
  const imported = page.locator('.memory-card').first();
  await imported.getByRole('button').first().click();
  await expect(imported.getByText('Provenance: Imported archive', { exact: true })).toBeVisible();
});