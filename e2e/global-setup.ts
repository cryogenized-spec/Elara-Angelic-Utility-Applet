import { mkdir } from 'node:fs/promises';
import { chromium, type FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const project = config.projects.find(({ name }) => name === 'chromium') ?? config.projects[0];
  const baseURL = project.use.baseURL as string;
  const storageState = 'e2e/.auth/legacy.json';

  await mkdir('e2e/.auth', { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.readyState === 'interactive' || document.readyState === 'complete');

    await page.evaluate(async () => {
      const request = indexedDB.open('elara-preferences');
      await new Promise<void>((resolve, reject) => {
        request.onerror = () => reject(request.error ?? new Error('Could not open preferences database.'));
        request.onsuccess = () => resolve();
      });
      const database = request.result;
      try {
        if (!database.objectStoreNames.contains('preferences')) throw new Error('Preferences store is unavailable.');
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction('preferences', 'readwrite');
          transaction.objectStore('preferences').put({ id: 'onboarding', value: { completed: true }, updatedAt: Date.now() });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error ?? new Error('Could not seed onboarding state.'));
          transaction.onabort = () => reject(transaction.error ?? new Error('Onboarding state transaction aborted.'));
        });
      } finally {
        database.close();
      }
      window.localStorage.setItem('elara.onboarding.completed', 'true');
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('dialog', { name: 'Welcome.' }).waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
    if (await page.getByRole('dialog', { name: 'Welcome.' }).isVisible()) throw new Error('Could not establish completed onboarding state for legacy E2E tests.');

    await context.storageState({ path: storageState, indexedDB: true });
  } finally {
    await browser.close();
  }
}
