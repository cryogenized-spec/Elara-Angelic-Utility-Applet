import { expect, test, type Page } from '@playwright/test';

async function openMemoryBank(page: Page): Promise<void> {
  await page.goto('');
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Memory' }).click();
  await expect(page.getByText('One human-facing view over the canonical durable-memory store.', { exact: false })).toBeVisible();
}

async function readMemoryBehavior(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(async () => {
    const request = indexedDB.open('elara-preferences');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Record<string, unknown> | null>((resolve, reject) => {
        const transaction = database.transaction('preferences', 'readonly');
        const get = transaction.objectStore('preferences').get('memory-behavior');
        get.onsuccess = () => {
          const record = get.result as { value?: Record<string, unknown> } | undefined;
          resolve(record?.value ?? null);
        };
        get.onerror = () => reject(get.error);
      });
    } finally {
      database.close();
    }
  });
}

async function createMemory(page: Page, title: string, body: string): Promise<void> {
  await page.getByRole('button', { name: 'New memory' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel(/Memory body/).fill(body);
  await page.getByRole('button', { name: 'Create memory' }).click();
  await expect(page.locator('.memory-card').filter({ hasText: title }).first()).toBeVisible();
}

async function seedMalformedMemory(page: Page, id: string): Promise<void> {
  await page.evaluate(async (corruptId) => {
    const request = indexedDB.open('elara-angelic-utility-applet');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('memories', 'readwrite');
        transaction.objectStore('memories').put({
          id: corruptId,
          title: 'Malformed browser fixture',
          updatedAt: Date.now(),
          confidence: 5,
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, id);
}

test('Memory & continuity preferences persist without erasing subordinate choices', async ({ page }) => {
  await openMemoryBank(page);
  await expect(page.getByRole('heading', { name: 'Memory & continuity' })).toBeVisible();

  const master = page.getByRole('switch', { name: 'Use memory in conversation' });
  await expect(master).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: /Attentive/ }).click();

  const recallGroup = page.getByRole('radiogroup', { name: 'How Elara uses memories' });
  await recallGroup.getByRole('radio', { name: /Make connections/ }).click();

  const health = page.getByRole('switch', { name: 'Health & wellbeing' });
  await expect(health).toHaveAttribute('aria-checked', 'false');
  await health.click();
  await master.click();
  await expect(master).toHaveAttribute('aria-checked', 'false');

  await expect.poll(() => readMemoryBehavior(page)).toEqual(expect.objectContaining({
    enabled: false,
    rememberingStyle: 'attentive',
    recallStyle: 'proactive',
    categories: expect.objectContaining({ health_wellbeing: true }),
  }));

  await openMemoryBank(page);

  await expect(page.getByRole('switch', { name: 'Use memory in conversation' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('radio', { name: /Attentive/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radiogroup', { name: 'How Elara uses memories' }).getByRole('radio', { name: /Make connections/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('switch', { name: 'Health & wellbeing' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Existing memories stay in the Memory Bank', { exact: false })).toBeVisible();
});

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
  await expect(page.locator('.memory-panel__status')).toContainText('Reviewed 2 memories. No changes were made.');
  await expect(page.getByLabel('Memory maintenance summary')).toContainText('1 duplicate group');
  await expect(page.getByText('Exact duplicate review')).toBeVisible();

  await page.getByLabel('Filter').selectOption('provenance:explicit-user');
  await expect(page.locator('.memory-card')).toHaveCount(2);
});

test('Memory Bank quarantines a malformed row without hiding healthy memories and repairs it explicitly', async ({ page }) => {
  await openMemoryBank(page);
  await createMemory(page, 'Healthy browser memory', 'This valid record must remain usable beside corruption.');
  await seedMalformedMemory(page, 'memory_corrupt_browser');

  await openMemoryBank(page);
  await expect(page.locator('.memory-card').filter({ hasText: 'Healthy browser memory' })).toBeVisible();
  const integrity = page.locator('section.memory-maintenance').filter({ hasText: 'Store integrity needs attention' });
  await expect(integrity).toContainText('1 malformed record quarantined');
  await expect(integrity).toContainText('memory_corrupt_browser');

  page.once('dialog', (dialog) => dialog.accept());
  await integrity.getByRole('button', { name: 'Remove invalid record' }).click();

  await expect(page.locator('section.memory-maintenance').filter({ hasText: 'Store integrity needs attention' })).toHaveCount(0);
  await expect(page.locator('.memory-card').filter({ hasText: 'Healthy browser memory' })).toBeVisible();
  await expect(page.getByText(/1 valid · 1 stored · canonical store/)).toBeVisible();
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
  await expect(page.locator('.memory-panel__status')).toContainText('Exported 1 memories');

  await page.locator('input.memory-archive__file').setInputFiles(path!);
  await expect(page.getByText(/1 memories · 0 CORE records will restart as CONTEXTUAL/)).toBeVisible();
  await page.getByRole('button', { name: 'Import 1' }).click();
  await expect(page.locator('.memory-panel__status')).toContainText('Imported 1 memories');
  await expect(page.getByText(/2 valid · 2 stored · canonical store/)).toBeVisible();

  await page.getByLabel('Filter').selectOption('provenance:imported');
  await expect(page.locator('.memory-card')).toHaveCount(1);
  const imported = page.locator('.memory-card').first();
  await imported.getByRole('button').first().click();
  await expect(imported.getByText('Provenance: Imported archive', { exact: true })).toBeVisible();
});