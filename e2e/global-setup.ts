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
    await page.evaluate(() => {
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
