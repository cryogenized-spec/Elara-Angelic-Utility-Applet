import { expect, test, type Page } from '@playwright/test';

type InteractionPayload = Record<string, unknown>;

const USER_EVIDENCE = 'I prefer compact dark editor layouts for this project.';
const ASSISTANT_RESPONSE = 'Memory closure answer.';
const CONVERSATION_DB = 'elara-angelic-utility-applet';

async function unlockTestGemini(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill(['e2e', 'memory', 'chat', 'key'].join('-'));
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('2468135790');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('2468135790');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message Elara' }).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

async function persistedAssistantResponseExists(page: Page, expectedText: string): Promise<boolean> {
  return page.evaluate(async ({ databaseName, text }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open the conversation database.'));
    });

    try {
      if (!database.objectStoreNames.contains('messages')) return false;
      const rows = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const transaction = database.transaction('messages', 'readonly');
        const request = transaction.objectStore('messages').getAll();
        request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>);
        request.onerror = () => reject(request.error ?? new Error('Could not read persisted chat messages.'));
      });
      return rows.some((row) => row.role === 'assistant' && row.text === text);
    } finally {
      database.close();
    }
  }, { databaseName: CONVERSATION_DB, text: expectedText });
}

function thoughtStep(index: number, text: string): string {
  return [
    `event: step.start\ndata: ${JSON.stringify({ event_type: 'step.start', index, step: { index, type: 'thought' } })}\n\n`,
    `event: step.delta\ndata: ${JSON.stringify({ event_type: 'step.delta', index, delta: { type: 'thought_summary', text } })}\n\n`,
    `event: step.stop\ndata: ${JSON.stringify({ event_type: 'step.stop', index })}\n\n`,
  ].join('');
}

function answerStep(index: number, text: string): string {
  return [
    `event: step.start\ndata: ${JSON.stringify({ event_type: 'step.start', index, step: { index, type: 'model_output' } })}\n\n`,
    `event: step.delta\ndata: ${JSON.stringify({ event_type: 'step.delta', index, delta: { type: 'text', text } })}\n\n`,
    `event: step.stop\ndata: ${JSON.stringify({ event_type: 'step.stop', index })}\n\n`,
  ].join('');
}

function completedTurn(interactionId: string, answer: string, thoughts: readonly string[] = []): string {
  const created = `event: interaction.created\ndata: ${JSON.stringify({
    event_type: 'interaction.created',
    interaction: { id: interactionId, status: 'in_progress', model: 'gemini-3.8-flash' },
  })}\n\n`;
  const thoughtEvents = thoughts.map((thought, index) => thoughtStep(index, thought)).join('');
  const outputIndex = thoughts.length;
  const completed = `event: interaction.completed\ndata: ${JSON.stringify({
    event_type: 'interaction.completed',
    interaction: { id: interactionId, status: 'completed', usage: { input_tokens: 20, output_tokens: 12 } },
  })}\n\n`;
  return created + thoughtEvents + answerStep(outputIndex, answer) + completed;
}

function declaredToolNames(payload: InteractionPayload): string[] {
  if (!Array.isArray(payload.tools)) return [];
  return payload.tools
    .map((tool) => typeof tool === 'object' && tool !== null && typeof (tool as { name?: unknown }).name === 'string'
      ? (tool as { name: string }).name
      : null)
    .filter((name): name is string => name !== null);
}

async function openMemoryBank(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Memory Bank' }).click();
  await expect(page.getByText('One human-facing view over the canonical durable-memory store.', { exact: false })).toBeVisible();
}

test('chat exposes memory tools and persists organic capture with the memory activity glyph', async ({ page }) => {
  test.setTimeout(25_000);
  const chatRequests: InteractionPayload[] = [];
  const observerRequests: InteractionPayload[] = [];
  let observerSawPersistedResponse: boolean | null = null;

  await page.route('**/v1/interactions*', async (route) => {
    const payload = JSON.parse(route.request().postData() ?? '{}') as InteractionPayload;
    const input = typeof payload.input === 'string' ? payload.input : '';

    if (input.startsWith('USER_MESSAGE:\n')) {
      observerSawPersistedResponse = await persistedAssistantResponseExists(page, ASSISTANT_RESPONSE);
      observerRequests.push(payload);
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: completedTurn('memory-observer', JSON.stringify({
          candidates: [{ domain: 'preference', evidence: USER_EVIDENCE }],
        })),
      });
      return;
    }

    chatRequests.push(payload);
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: completedTurn('memory-chat', ASSISTANT_RESPONSE, ['Considering durable user context.']),
    });
  });

  await page.goto('');
  await unlockTestGemini(page);
  await ask(page, USER_EVIDENCE);
  await expect(page.getByText(ASSISTANT_RESPONSE, { exact: true })).toBeVisible();

  await expect.poll(() => chatRequests.length).toBe(1);
  await expect.poll(() => observerRequests.length).toBe(1);
  expect(observerSawPersistedResponse).toBe(true);

  const memoryTools = declaredToolNames(chatRequests[0])
    .filter((name) => name.startsWith('memory.'))
    .sort();
  expect(memoryTools).toEqual(['memory.lookup', 'memory.reconcile', 'memory.save']);
  expect(declaredToolNames(observerRequests[0])).toEqual([]);

  const activity = page.getByRole('region', { name: 'Generation activity' });
  await expect(activity).toHaveCount(1);
  await activity.getByRole('button').click();

  const savedRow = activity.locator('.generation-activity__step').filter({ hasText: 'Saved to memory' });
  await expect(savedRow).toHaveCount(1);
  await expect(savedRow).toContainText('Recorded 1 durable observation.');
  await expect(savedRow.locator('[data-activity-glyph="memory"]')).toHaveCount(1);

  await openMemoryBank(page);
  const observed = page.locator('.memory-card').filter({ hasText: 'Observed preference' });
  await expect(observed).toHaveCount(1);
  await observed.getByRole('button').first().click();
  await expect(observed).toContainText(USER_EVIDENCE);
  await expect(observed).toContainText('Provenance: Observed from user message');

  await page.getByRole('button', { name: 'Back to chat' }).click();
  await page.reload();
  await expect(page.getByText(ASSISTANT_RESPONSE, { exact: true })).toBeVisible();

  const rehydrated = page.getByRole('region', { name: 'Generation activity' });
  await expect(rehydrated).toHaveCount(1);
  await rehydrated.getByRole('button').click();
  const rehydratedSavedRow = rehydrated.locator('.generation-activity__step').filter({ hasText: 'Saved to memory' });
  await expect(rehydratedSavedRow).toHaveCount(1);
  await expect(rehydratedSavedRow.locator('[data-activity-glyph="memory"]')).toHaveCount(1);
});
