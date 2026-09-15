import { expect, test, type Page } from '@playwright/test';

const VIDEO_ID = 'phase1EfficiencyVid';
const TITLE = 'Phase 1 Efficiency Track';
const TEST_PIN = `284${619}`;
const TEST_GEMINI_KEY = ['phase1', 'e2e', 'gemini', 'key'].join('-');
const TEST_YOUTUBE_KEY = ['phase1', 'e2e', 'youtube', 'key'].join('-');

function sseTurn(interactionId: string, body: readonly string[], terminal: 'requires_action' | 'completed' = 'completed'): string {
  const created = `event: interaction.created\ndata: ${JSON.stringify({
    event_type: 'interaction.created',
    interaction: { id: interactionId, status: 'in_progress', model: 'gemini-3.8-flash' },
  })}\n\n`;
  const end = terminal === 'completed'
    ? `event: interaction.completed\ndata: ${JSON.stringify({ event_type: 'interaction.completed', interaction: { id: interactionId, status: 'completed' } })}\n\n`
    : `event: interaction.requires_action\ndata: ${JSON.stringify({ event_type: 'interaction.requires_action', interaction_id: interactionId, status: 'requires_action' })}\n\n`;
  return created + body.join('') + end;
}

function toolCallStep(): string {
  return [
    `event: step.start\ndata: ${JSON.stringify({
      event_type: 'step.start',
      index: 0,
      step: {
        index: 0,
        type: 'function_call',
        id: 'phase1-search-call',
        name: 'youtube.search',
        arguments: { queries: ['phase one efficiency track'], intent: 'listen' },
      },
    })}\n\n`,
    `event: step.stop\ndata: ${JSON.stringify({ event_type: 'step.stop', index: 0 })}\n\n`,
  ].join('');
}

function textStep(text: string): string {
  return `event: step.delta\ndata: ${JSON.stringify({
    event_type: 'step.delta',
    index: 0,
    delta: { type: 'text', text },
  })}\n\n`;
}

async function unlockTestLockbox(page: Page): Promise<void> {
  await page.route('**/youtube/v3/videos**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });

  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill(TEST_GEMINI_KEY);
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill(TEST_PIN);
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill(TEST_PIN);
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();

  await page.getByLabel('YouTube API key').fill(TEST_YOUTUBE_KEY);
  await page.getByLabel('Current Lockbox credential for the YouTube key').fill(TEST_PIN);
  await page.getByRole('button', { name: 'Save YouTube Key' }).click();
  await expect(page.getByText(/YouTube Data API · configured · unlocked/)).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message Elara' }).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

async function dailyBudgetRow(page: Page): Promise<{ quotaDay: string; spent: number } | null> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('elara-media-cache');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!database.objectStoreNames.contains('dailySearchBudget')) return null;
      return await new Promise<{ quotaDay: string; spent: number } | null>((resolve, reject) => {
        const request = database.transaction('dailySearchBudget', 'readonly').objectStore('dailySearchBudget').get('youtube-search');
        request.onsuccess = () => {
          const value = request.result as { quotaDay?: unknown; spent?: unknown } | undefined;
          resolve(value && typeof value.quotaDay === 'string' && typeof value.spent === 'number'
            ? { quotaDay: value.quotaDay, spent: value.spent }
            : null);
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

test.describe('Phase 1 media efficiency', () => {
  test('Gemini gets a lean result while the browser retains full card metadata', async ({ page }) => {
    const modelRequests: Array<Record<string, unknown>> = [];
    let providerCalls = 0;

    await page.route('**/v1/interactions*', async (route) => {
      const payload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      modelRequests.push(payload);
      const wire = JSON.stringify(payload);
      if (wire.includes(VIDEO_ID)) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: sseTurn('phase1-answer', [textStep('Found one efficient result.')]),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseTurn('phase1-search', [toolCallStep()], 'requires_action'),
      });
    });

    await page.route('**/youtube/v3/search**', async (route) => {
      providerCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            id: { kind: 'youtube#video', videoId: VIDEO_ID },
            snippet: {
              title: TITLE,
              channelTitle: 'Efficiency Channel',
              publishedAt: '2026-09-14T00:00:00Z',
              thumbnails: {
                high: { url: `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`, width: 480, height: 360 },
              },
            },
          }],
        }),
      });
    });

    await page.goto('');
    await unlockTestLockbox(page);
    await ask(page, 'find me the phase one efficiency track');

    const card = page.locator('.media-card').filter({ hasText: TITLE });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Source: YouTube');
    await expect(card.locator('img')).toHaveAttribute('src', `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`);
    expect(providerCalls).toBe(1);

    const continuation = modelRequests.find((payload) => JSON.stringify(payload).includes(VIDEO_ID));
    expect(continuation).toBeTruthy();
    const input = continuation?.input;
    expect(Array.isArray(input)).toBe(true);
    const functionResult = (input as Array<Record<string, unknown>>).find(
      (entry) => entry.type === 'function_result' && entry.name === 'youtube.search',
    );
    expect(functionResult).toBeTruthy();

    const resultParts = functionResult?.result;
    expect(Array.isArray(resultParts)).toBe(true);
    expect(resultParts).toHaveLength(1);
    const resultPart = (resultParts as Array<Record<string, unknown>>)[0];
    expect(resultPart?.type).toBe('text');
    expect(typeof resultPart?.text).toBe('string');
    const resultValue = JSON.parse(resultPart.text as string) as Record<string, unknown>;
    expect(resultValue).toEqual({
      ok: true,
      provider: 'youtube',
      intent: 'listen',
      results: [{
        query: 'phase one efficiency track',
        items: [{ id: VIDEO_ID, kind: 'video', title: TITLE, channel: 'Efficiency Channel' }],
      }],
      failures: [],
    });

    const resultWire = JSON.stringify(resultValue);
    expect(resultWire).not.toContain('thumbnail');
    expect(resultWire).not.toContain('webUrl');
    expect(resultWire).not.toContain('embedUrl');
    expect(resultWire).not.toContain('apiDataFetchedAt');
    expect(resultWire).not.toContain('i.ytimg.com');
    expect(resultWire).not.toContain('youtube.com/watch');
  });

  test('the device-day ledger survives reload and is shared by a sibling tab', async ({ page, context }) => {
    let providerCalls = 0;

    await page.route('**/v1/interactions*', async (route) => {
      const wire = route.request().postData() ?? '';
      if (wire.includes(VIDEO_ID)) {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseTurn('quota-answer', []) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseTurn('quota-search', [toolCallStep()], 'requires_action'),
      });
    });
    await page.route('**/youtube/v3/search**', async (route) => {
      providerCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            id: { kind: 'youtube#video', videoId: VIDEO_ID },
            snippet: {
              title: TITLE,
              channelTitle: 'Efficiency Channel',
              publishedAt: '2026-09-14T00:00:00Z',
              thumbnails: { high: { url: `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`, width: 480, height: 360 } },
            },
          }],
        }),
      });
    });

    await page.goto('');
    await unlockTestLockbox(page);
    await ask(page, 'find one quota persistence track');
    await expect(page.locator('.media-card').filter({ hasText: TITLE })).toBeVisible();
    expect(providerCalls).toBe(1);

    const initial = await dailyBudgetRow(page);
    expect(initial?.spent).toBe(1);
    expect(initial?.quotaDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await page.reload();
    await expect.poll(() => dailyBudgetRow(page)).toEqual(initial);

    const sibling = await context.newPage();
    await sibling.goto('');
    await expect.poll(() => dailyBudgetRow(sibling)).toEqual(initial);
    await sibling.close();
  });
});
