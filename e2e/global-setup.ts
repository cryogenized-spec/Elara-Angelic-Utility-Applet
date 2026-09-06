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
    await page.goto(baseURL);
    const welcome = page.getByRole('dialog', { name: 'Welcome.' });
    if (await welcome.isVisible()) {
      await welcome.getByRole('button', { name: 'Start empty' }).click();
      await welcome.waitFor({ state: 'detached' });
    }
    await context.storageState({ path: storageState, indexedDB: true });
  } finally {
    await browser.close();
  }
}
