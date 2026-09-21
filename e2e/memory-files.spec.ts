import { expect, test, type Page } from '@playwright/test';

async function gotoMemorySettings(page: Page): Promise<void> {
  await page.goto('');
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Memory' }).click();
}

async function openMemoryTopics(page: Page): Promise<void> {
  await gotoMemorySettings(page);
  await expect(page.getByText('Memory topics', { exact: true })).toBeVisible();
}

/**
 * Seed one canonical memory plus a derived semantic file grounded in it.
 * The page must already be on the Memory settings screen: that guarantees
 * the app opened its database on this origin before we write the fixture.
 */
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
  await gotoMemorySettings(page);
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
  await gotoMemorySettings(page);
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

test('creates the first topic from a user-saved memory without seeding a derived row', async ({ page }) => {
  await gotoMemorySettings(page);
  await page.getByRole('button', { name: 'Lockbox', exact: true }).click();
  await page.getByLabel('Gemini API key').fill(['e2e', 'memory', 'topics', 'key'].join('-'));
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('2468135790');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('2468135790');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();
  await page.getByRole('button', { name: 'Memory', exact: true }).click();
  await page.getByRole('button', { name: 'New memory', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Project owner');
  await page.getByLabel(/Memory body/).fill('Zuhayr owns the project.');
  await page.getByRole('button', { name: 'Create memory', exact: true }).click();
  await expect(page.locator('.memory-card', { hasText: 'Project owner' })).toBeVisible();
  await expect(page.locator('.semantic-files__card')).toHaveCount(0);
  let requests = 0;
  await page.route('**/v1/interactions*', async (route) => {
    requests += 1;
    const text = JSON.stringify({ summary: 'Zuhayr owns the project.', recentObservations: ['Zuhayr owns the project.'], openConflicts: [], aliases: [] });
    const events = [
      ['interaction.created', { interaction: { id: 'topic-create', status: 'in_progress', model: 'gemini-3.8-flash' } }],
      ['step.start', { index: 0, step: { index: 0, type: 'model_output' } }],
      ['step.delta', { index: 0, delta: { type: 'text', text } }],
      ['step.stop', { index: 0 }],
      ['interaction.completed', { interaction: { id: 'topic-create', status: 'completed' } }],
    ] as const;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify({ event_type: event, ...data })}\n\n`).join('') });
  });
  await page.getByRole('button', { name: 'Create topic from memories' }).click();
  await page.getByLabel('Topic kind', { exact: true }).selectOption('person');
  await page.getByLabel('Topic name', { exact: true }).fill('Zuhayr');
  await page.getByRole('button', { name: 'Create summary', exact: true }).click();
  await expect(page.getByText('Topic ready.', { exact: false })).toBeVisible();
  await expect(page.locator('.semantic-files__card')).toContainText('Built from 1 memory');
  await expect(page.locator('.memory-card', { hasText: 'Project owner' })).toBeVisible();
  expect(requests).toBe(1);
});
