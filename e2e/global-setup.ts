import { mkdir } from 'node:fs/promises';
import { chromium, type FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const project = config.projects.find(({ name }) => name === 'chromium') ?? config.projects[0];
  const baseURL = project.use.baseURL as string;
  const storageState = 'e2e/.auth/legacy.json';

  await mkdir('e2e/.auth', { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  // Seed the flag before any page script runs. The previous version navigated
  // first and then called page.evaluate, which raced a post-domcontentloaded
  // navigation and intermittently failed with "Execution context was destroyed,
  // most likely because of a navigation".
  await context.addInitScript(() => {
    window.localStorage.setItem('elara.onboarding.completed', 'true');
  });
  const page = await context.newPage();

  try {
    await page.goto(baseURL, { waitUntil: 'load' });
    await page.getByRole('dialog', { name: 'Welcome.' }).waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
    if (await page.getByRole('dialog', { name: 'Welcome.' }).isVisible()) throw new Error('Could not establish completed onboarding state for legacy E2E tests.');

    // Legacy browser tests predate the explicit YouTube policy gate. Establish
    // their accepted baseline through the real Settings UI, then persist the
    // existing preferences IndexedDB in Playwright storage state. Dedicated
    // Phase-9 consent tests start from an empty storage state instead.
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('button', { name: 'Lockbox' }).click();
    const consent = page.getByLabel('Agree to Elara YouTube privacy and terms');
    if (await consent.isVisible()) {
      await consent.check();
      await page.getByRole('button', { name: 'Enable YouTube features' }).click();
      await page.getByText(/Accepted · policy version/).waitFor({ state: 'visible' });
    }

    await context.storageState({ path: storageState, indexedDB: true });
  } finally {
    await browser.close();
  }
}
