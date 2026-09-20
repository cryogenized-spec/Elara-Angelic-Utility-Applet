import { expect, test, type Page } from '@playwright/test';

async function openMemoryTopics(page: Page): Promise<void> {
  await page.goto('');
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Memory' }).click();
  await expect(page.getByRole('heading', { name: 'Memory topics' })).toBeVisible();
}

/** Seed one canonical memory plus a derived semantic file grounded in it. */
async function seedGroundedFile(page: Page, title: string, body: string, summary: string): Promise<void> {
  await page.evaluate(async ({ title, body, summary }) => {
    const request = indexedDB.open('elara-angelic-utility-applet');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const now = Date.now();
        const transaction = database.transaction(['memories', 'semanticMemories'], 'readwrite');
        transaction.objectStore('memories').put({
          id: 'memory_seed_topics',
          kind: 'CONTEXTUAL',
          title,
          body,
          createdAt: now,
          updatedAt: now,
          observedAt: now,
          confidence: 0.8,
          importance: 0.6,
          lifecycle: 'active',
          source: { source: 'user', createdAt: now },
          tags: [],
          relatedMemoryIds: [],
          supportingMemoryIds: [],
          conflictingMemoryIds: [],
          supersedes: [],
          supersededBy: [],
          reinforcementCount: 0,
          folderId: null,
          expiresAt: null,
          lastRecalledAt: null,
          recallCount: 0,
          pinned: false,
          autonomyContext: false,
        });
        transaction.objectStore('semanticMemories').put({
          id: 'semantic_seed_topics',
          kind: 'person',
          title: 'Zuhayr',
          aliases: ['Z'],
          summary,
          recentObservations: [body],
          openConflicts: [],
          sourceMemoryIds: ['memory_seed_topics'],
          updatedAt: now,
          generatedAt: now,
          version: 1,
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, { title, body, summary });
}

test('memory topics shows a grounded summary with its underlying source', async ({ page }) => {
  await seedGroundedFile(page, 'Project owner', 'Zuhayr is the owner of the project.', 'The owner of the project.');
  await openMemoryTopics(page);

  const card = page.locator('.semantic-files__card', { hasText: 'Zuhayr' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Built from 1 memory');
  await expect(card).toContainText('also Z');

  await card.getByRole('button').first().click();
  await expect(card).toContainText('Underlying memories');
  await expect(card).toContainText('Project owner');
  await expect(card).toContainText('Memory Bank below');

  // The same record remains a first-class Memory Bank entry.
  await expect(page.locator('.memory-card', { hasText: 'Project owner' }).first()).toBeVisible();
});

test('removing a summary file preserves the underlying memory in the Memory Bank', async ({ page }) => {
  await seedGroundedFile(page, 'Project owner', 'Zuhayr is the owner of the project.', 'The owner of the project.');
  await openMemoryTopics(page);
  page.on('dialog', (dialog) => dialog.accept());

  const card = page.locator('.semantic-files__card', { hasText: 'Zuhayr' });
  await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'Remove file' }).click();

  await expect(page.getByText('Summary file removed.', { exact: false })).toBeVisible();
  await expect(page.locator('.semantic-files__card')).toHaveCount(0);
  await expect(page.locator('.memory-card', { hasText: 'Project owner' }).first()).toBeVisible();
});

test('memory topics explains itself when no summaries exist yet', async ({ page }) => {
  await openMemoryTopics(page);
  await expect(page.getByText('No summaries yet.', { exact: false })).toBeVisible();
  await expect(page.getByText('a map, not a second memory store', { exact: false })).toBeVisible();
});
