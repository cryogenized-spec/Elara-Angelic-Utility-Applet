import { mkdir } from 'node:fs/promises';
import { chromium, type FullConfig, type Page } from '@playwright/test';

async function openLockbox(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
}

async function waitForYouTubePolicyReady(page: Page): Promise<'accepted' | 'required'> {
  const policy = page.locator('[aria-label="YouTube privacy and terms"]');
  const accepted = policy.getByRole('status').filter({ hasText: /Accepted · policy version/ });
  const consent = policy.getByLabel('Agree to Elara YouTube privacy and terms');

  await policy.waitFor({ state: 'visible', timeout: 10_000 });
  await Promise.race([
    accepted.waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'accepted' as const),
    consent.waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'required' as const),
  ]);
  return await accepted.isVisible() ? 'accepted' : 'required';
}

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
    // consent tests start from an empty storage state instead.
    //
    // IMPORTANT: the policy component resolves IndexedDB asynchronously. A
    // bare locator.isVisible() is an immediate snapshot and can race that load,
    // silently producing an unaccepted shared fixture. Wait until the component
    // reaches either durable-accepted or explicit-required state instead.
    await openLockbox(page);
    const policyState = await waitForYouTubePolicyReady(page);
    if (policyState === 'required') {
      await page.getByLabel('Agree to Elara YouTube privacy and terms').check();
      await page.getByRole('button', { name: 'Enable YouTube features' }).click();
      await page.getByText(/Accepted · policy version/).waitFor({ state: 'visible', timeout: 10_000 });
    }

    // Prove the acceptance is durable before snapshotting IndexedDB. This keeps
    // a timing regression in global setup from cascading into every media E2E as
    // a misleading YouTube/tool failure.
    await page.reload({ waitUntil: 'load' });
    await page.getByRole('dialog', { name: 'Welcome.' }).waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
    await openLockbox(page);
    const persistedPolicyState = await waitForYouTubePolicyReady(page);
    if (persistedPolicyState !== 'accepted') throw new Error('YouTube policy acceptance did not persist before E2E storage-state capture.');

    await context.storageState({ path: storageState, indexedDB: true });
  } finally {
    await browser.close();
  }
}
