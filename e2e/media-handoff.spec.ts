import { expect, test } from '@playwright/test';

/**
 * End-to-end proof for the user-request → Gemini tool → YouTube → cache → card
 * path. The provider endpoints are stubbed, but the application wiring, schema,
 * Lockbox, cache, stream, persistence projection and rendered handoff are real.
 */

const YOUTUBE_VIDEO = {
  id: { kind: 'youtube#video', videoId: 'lofiVid1' },
  snippet: {
    title: 'Lo-Fi Roadtrip — 1 Hour',
    channelTitle: 'Chill Wave Radio',
    publishedAt: '2024-05-01T00:00:00Z',
    thumbnails: {
      high: { url: 'https://i.ytimg.com/vi/lofiVid1/hqdefault.jpg', width: 480, height: 360 },
    },
  },
};

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

function toolCallStep(id: string, args: Record<string, unknown>): string {
  return [
    `event: step.start\ndata: ${JSON.stringify({
      event_type: 'step.start',
      index: 0,
      step: { index: 0, type: 'function_call', id, name: 'youtube.search', arguments: args },
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

async function unlockTestLockbox(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill('e2e-test-api-key');
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();

  await page.getByLabel('YouTube API key').fill('e2e-youtube-api-key');
  await page.getByLabel('Current Lockbox credential for the YouTube key').fill('284619');
  await page.getByRole('button', { name: 'Save YouTube Key' }).click();
  await expect(page.getByText(/YouTube Data API · configured · unlocked/)).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

async function ask(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message Elara' }).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

test.describe('YouTube media results', () => {
  test('one concise search serves listen and watch intents without a second billed search call', async ({ page }) => {
    const modelRequests: Array<Record<string, unknown>> = [];
    const providerRequests: Array<{ url: string; apiKeyHeader: string | null }> = [];

    await page.route('**/v1/interactions*', async (route) => {
      const payload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      modelRequests.push(payload);
      const wire = JSON.stringify(payload);
      const alreadySearched = wire.includes('lofiVid1');
      const asksListen = wire.includes('put on some lofi');
      const asksWatch = wire.includes('show me that lofi video');

      if (alreadySearched || (!asksListen && !asksWatch)) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: sseTurn('interaction-answer', [textStep('Here is what I found.')]),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseTurn('interaction-search', [
          toolCallStep('call-search', { queries: ['lofi beats'], intent: asksListen ? 'listen' : 'watch' }),
        ], 'requires_action'),
      });
    });

    await page.route('**/youtube/v3/search**', async (route) => {
      providerRequests.push({
        url: route.request().url(),
        apiKeyHeader: await route.request().headerValue('x-goog-api-key'),
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [YOUTUBE_VIDEO] }) });
    });

    await page.goto('');
    await unlockTestLockbox(page);

    await ask(page, 'put on some lofi');
    const firstCard = page.getByRole('link', { name: /Lo-Fi Roadtrip/ });
    await expect(firstCard).toBeVisible();
    expect(providerRequests).toHaveLength(1);

    // The model-facing declaration hard-bounds quota exposure and explicitly
    // teaches one-query-by-default behavior.
    const chatRequest = modelRequests.find((entry) => Array.isArray(entry.tools) && (entry.tools as unknown[]).length > 0);
    expect(chatRequest).toBeTruthy();
    const declarations = (chatRequest!.tools ?? []) as Array<Record<string, any>>;
    const youtube = declarations.find((entry) => entry.function?.name === 'youtube.search' || entry.name === 'youtube.search');
    expect(youtube).toBeTruthy();
    const functionShape = (youtube!.function ?? youtube) as Record<string, any>;
    expect(functionShape.description).toContain('one concise query by default');
    expect(functionShape.description).not.toContain('durations');
    expect(functionShape.parameters.properties.queries.maxItems).toBe(3);
    expect(functionShape.parameters.properties.queries.description).toContain('Use one query by default');
    expect(functionShape.parameters.properties.intent.enum).toEqual(['watch', 'listen']);

    // Key is header-only. The request is exactly one search.list page.
    expect(providerRequests[0]!.apiKeyHeader).toBeTruthy();
    const providerUrl = new URL(providerRequests[0]!.url);
    expect(providerUrl.searchParams.get('part')).toBe('snippet');
    expect(providerUrl.searchParams.get('type')).toBe('video');
    expect(providerUrl.searchParams.get('q')).toBe('lofi beats');
    expect(providerUrl.searchParams.get('maxResults')).toBe('5');
    expect(providerUrl.searchParams.get('safeSearch')).toBe('strict');
    expect(providerUrl.searchParams.has('key')).toBe(false);
    expect(providerUrl.searchParams.has('pageToken')).toBe(false);

    // A card is a YouTube-attributed link, never an in-app player. Listen changes
    // the action label but not the provider's canonical result destination.
    await expect(page.locator('.media-rail iframe, .media-rail video, .media-rail audio')).toHaveCount(0);
    await expect(firstCard).toHaveAttribute('href', 'https://www.youtube.com/watch?v=lofiVid1');
    await expect(firstCard).toContainText('Listen');
    await expect(firstCard).toContainText('YouTube');
    await expect(firstCard).toContainText('Chill Wave Radio');

    // Same normalized search, opposite presentation intent: cache must make this
    // free and intent must not be frozen into cached provider metadata.
    await ask(page, 'show me that lofi video');
    const secondCard = page.getByRole('link', { name: /Lo-Fi Roadtrip/ }).nth(1);
    await expect(secondCard).toBeVisible();
    expect(providerRequests).toHaveLength(1);
    await expect(secondCard).toHaveAttribute('href', 'https://www.youtube.com/watch?v=lofiVid1');
    await expect(secondCard).toContainText('Watch');

    const cacheIntents = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('elara-media-cache');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        return await new Promise<unknown[]>((resolve, reject) => {
          const request = database.transaction('entries', 'readonly').objectStore('entries').getAll();
          request.onsuccess = () => resolve((request.result as Array<{ items: Array<{ intent?: unknown }> }>)
            .flatMap((entry) => entry.items.map((item) => item.intent)));
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    });
    expect(cacheIntents).toEqual([undefined]);
  });

  test.describe('on Android', () => {
    test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' });

    test('listen uses the canonical YouTube URL and an unpinned Android chooser intent', async ({ page }) => {
      const providerCalls: string[] = [];
      await page.route('**/v1/interactions*', async (route) => {
        const payload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
        const hasToolResult = JSON.stringify(payload).includes('lofiVid1');
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: hasToolResult
            ? sseTurn('interaction-2', [textStep('Picked one for you.')])
            : sseTurn('interaction-1', [toolCallStep('call-1', { queries: ['lofi beats'], intent: 'listen' })], 'requires_action'),
        });
      });
      await page.route('**/youtube/v3/search**', async (route) => {
        providerCalls.push(route.request().url());
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [YOUTUBE_VIDEO] }) });
      });

      await page.goto('');
      await unlockTestLockbox(page);
      await ask(page, 'put on some lofi');

      const card = page.getByRole('link', { name: /Lo-Fi Roadtrip/ });
      await expect(card).toBeVisible();
      expect(providerCalls).toHaveLength(1);
      await expect(card).toHaveAttribute('href', 'https://www.youtube.com/watch?v=lofiVid1');
      await expect(card).toHaveAttribute('title', /on YouTube$/);

      const intentHref = await card.getAttribute('data-intent-href');
      expect(intentHref).toContain('intent://www.youtube.com/watch?v=lofiVid1#Intent;');
      expect(intentHref).toContain('scheme=https;');
      expect(intentHref).toContain('category=android.intent.category.BROWSABLE');
      expect(intentHref).toContain('action=android.intent.action.VIEW');
      expect(intentHref).not.toContain(';package=');
      expect(intentHref?.endsWith(';end')).toBe(true);
      const fallback = /S\.browser_fallback_url=([^;]*)/.exec(intentHref ?? '')?.[1];
      expect(fallback ? decodeURIComponent(fallback) : null).toBe('https://www.youtube.com/watch?v=lofiVid1');
      await expect(card.locator('iframe, video, audio')).toHaveCount(0);
    });
  });
});
