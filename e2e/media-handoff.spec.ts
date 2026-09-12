import { expect, test } from '@playwright/test';

/**
 * YouTube search, end to end.
 *
 * This exercises the whole hand-off chain in a real browser, because every layer
 * of it has already been observed to pass its own unit tests while the wiring
 * between two of them was broken:
 *
 *   model sees the tool declaration → asks for a search with an intent →
 *   app validates the arguments → executes the tool → one billed provider call →
 *   result cached → stream event → persisted on the message → lazily rendered
 *   card → href the platform can resolve.
 *
 * Both intents are exercised against one search, which is the design's central
 * promise: `listen` and `watch` are the same question to YouTube, so the second
 * one must be free.
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

function sse(interactionId: string, body: readonly string[]): string {
  const created = `event: interaction.created\ndata: ${JSON.stringify({
    event_type: 'interaction.created',
    interaction: { id: interactionId, status: 'in_progress', model: 'gemini-3.8-flash' },
  })}\n\n`;
  const completed = `event: interaction.completed\ndata: ${JSON.stringify({
    event_type: 'interaction.completed',
    interaction: { id: interactionId, status: 'completed' },
  })}\n\n`;
  return created + body.join('') + completed;
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
  await page.getByLabel('Gemini API key').fill(['e2e', 'test', 'api', 'key'].join('-'));
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();

  // The YouTube key is a separate secret and is what the search call is billed
  // to, so a run without it would only prove the failure path.
  await page.getByLabel('YouTube API key').fill('e2e-youtube-api-key');
  await page.getByLabel('Current Lockbox credential for the YouTube key').fill('284619');
  await page.getByRole('button', { name: 'Save YouTube Key' }).click();
  await expect(page.getByText('YouTube Data API · configured · unlocked')).toBeVisible();

  await page.getByRole('button', { name: 'Back to chat' }).click();
}

async function ask(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message Elara' }).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

test.describe('YouTube media results', () => {
  test('a searched result becomes a card, and only one billed call is made for both intents', async ({ page }) => {
    const modelRequests: Array<Record<string, unknown>> = [];
    const providerRequests: Array<{ url: string; apiKeyHeader: string | undefined }> = [];

    // Driven off the request content rather than a counter. The app is free to
    // make more model calls per turn than "one call, one continuation", and a
    // counter would quietly retarget which reply belongs to which turn.
    await page.route('**/v1/interactions*', async (route) => {
      const payload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      modelRequests.push(payload);
      const wire = JSON.stringify(payload);
      const alreadySearched = wire.includes('lofiVid1');
      const asks = {
        listen: wire.includes('put on some lofi'),
        watch: wire.includes('show me that lofi video'),
      };

      // Every non-search turn answers with the same text. Numbering the replies
      // would make the assertions depend on how many model calls a turn happens
      // to make, which is the app's business and not this feature's.
      if (alreadySearched || (!asks.listen && !asks.watch)) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: sse('interaction-answer', [textStep('Here is what I found.')]),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sse('interaction-search', [
          toolCallStep('call-search', { queries: ['lofi beats'], intent: asks.listen ? 'listen' : 'watch' }),
        ]),
      });
    });

    await page.route('**/youtube/v3/search**', async (route) => {
      providerRequests.push({
        url: route.request().url(),
        apiKeyHeader: route.request().header('x-goog-api-key'),
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [YOUTUBE_VIDEO] }) });
    });

    await page.goto('');
    await unlockTestLockbox(page);

    await ask(page, 'put on some lofi');
    const card = page.getByRole('link', { name: /Lo-Fi Roadtrip/ });
    await expect(card).toBeVisible();
    // One completed assistant turn, whichever call count produced it.
    await expect(page.locator('.message-assistant')).toHaveCount(1);

    // The tool was actually offered to the model, with the intent argument
    // declared — without this the model could never ask for a hand-off.
    // The first request that carries tools, not merely the first request: a turn
    // can start with a model call that declares none.
    const chatRequest = modelRequests.find((entry) => Array.isArray(entry.tools) && (entry.tools as unknown[]).length > 0);
    expect(chatRequest).toBeTruthy();
    const declarations = (chatRequest!.tools ?? []) as Array<Record<string, any>>;
    const youtube = declarations.find((entry) => entry.function?.name === 'youtube.search' || entry.name === 'youtube.search');
    expect(youtube).toBeTruthy();
    const parameters = (youtube.function ?? youtube).parameters as Record<string, any>;
    expect(Object.keys(parameters.properties)).toContain('intent');
    expect(parameters.properties.intent.enum).toEqual(['watch', 'listen']);
    expect(parameters.required).toEqual(['queries']);

    // The key travels as a header only. A URL-borne key lands in history and logs.
    expect(providerRequests).toHaveLength(1);
    expect(providerRequests[0].apiKeyHeader).toBeTruthy();
    expect(providerRequests[0].url).not.toMatch(/[?&]key=/);

    // A link, never a player. Scoped to the rail: the app has other surfaces, and
    // an assertion about the whole document would fail for reasons this feature
    // does not control.
    await expect(page.locator('.media-rail iframe')).toHaveCount(0);
    await expect(page.locator('.media-rail video, .media-rail audio')).toHaveCount(0);
    await expect(card).toHaveAttribute('target', '_blank');
    // `listen` routes music to the music surface, keeping the id intact.
    await expect(card).toHaveAttribute('href', 'https://music.youtube.com/watch?v=lofiVid1');
    await expect(card).toContainText('Listen');
    await expect(card).toContainText('Chill Wave Radio');

    // Same query, opposite intent: the cached answer must serve it, so no second
    // call is made and the card changes behaviour instead.
    await ask(page, 'show me that lofi video');
    const secondCard = page.getByRole('link', { name: /Lo-Fi Roadtrip/ }).nth(1);
    await expect(secondCard).toBeVisible();
    await expect(page.locator('.message-assistant')).toHaveCount(2);
    await expect(page.getByText('Here is what I found.')).toHaveCount(2);
    await expect(providerRequests).toHaveLength(1);
    await expect(secondCard).toHaveAttribute('href', 'https://www.youtube.com/watch?v=lofiVid1');
    await expect(secondCard).toContainText('Watch');

    // And the intent must not have leaked into storage: a cached copy that carried
    // it would freeze the first intent onto every later search of that query.
    const cacheKeys = await page.evaluate(async () => {
      const name = 'elara-media-cache';
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        const store = 'entries';
        return await new Promise<Array<{ key: string; intents: unknown[] }>>((resolve, reject) => {
          const transaction = database.transaction(store, 'readonly');
          const request = transaction.objectStore(store).getAll();
          request.onsuccess = () => resolve((request.result as Array<{ key: string; items: Array<{ intent?: unknown }> }>)
            .map((entry) => ({ key: entry.key, intents: entry.items.map((item) => item.intent) })));
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    });
    expect(cacheKeys).toHaveLength(1);
    expect(cacheKeys[0].intents).toEqual([undefined]);
  });

  test.describe('on Android', () => {
    test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' });

    test('a tap is handed to the platform as an app picker, not to a player in the page', async ({ page }) => {
      await page.route('**/v1/interactions*', async (route) => {
        const payload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
        const hasToolResult = JSON.stringify(payload).includes('lofiVid1');
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: hasToolResult
            ? sse('interaction-2', [textStep('Picked one for you.')])
            : sse('interaction-1', [toolCallStep('call-1', { queries: ['lofi beats'], intent: 'listen' })]),
        });
      });
      await page.route('**/youtube/v3/search**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [YOUTUBE_VIDEO] }) });
      });

      await page.goto('');
      await unlockTestLockbox(page);
      await ask(page, 'put on some lofi');

      const card = page.getByRole('link', { name: /Lo-Fi Roadtrip/ });
      await expect(card).toBeVisible();

      // An `intent://` URI is what makes Android resolve the link across every
      // installed handler rather than the default browser, and the absence of a
      // pinned package is what keeps the chooser visible to the user.
      const href = await card.getAttribute('href');
      expect(href).toContain('intent://music.youtube.com/watch?v=lofiVid1#Intent;');
      expect(href).toContain('scheme=https;');
      expect(href).toContain('S.browser_fallback_url=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3BlofiVid1');
      expect(href).toContain('category=android.intent.category.BROWSABLE');
      expect(href).toContain('action=android.intent.action.VIEW');
      expect(href).not.toContain(';package=');
      expect(href?.endsWith(';end')).toBe(true);

      // The tooltip names the destination the tap will actually reach.
      await expect(card).toHaveAttribute('title', /in your music app$/);
      await expect(card.locator('iframe, video, audio')).toHaveCount(0);
      // Whether Android shows its chooser or opens a single default handler is the
      // platform's decision and cannot be observed from a browser. It is checked
      // on a device, not here.
    });
  });
});
