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

/**
 * Builds one SSE turn.
 *
 * `terminal` matters and is not interchangeable: a turn that hands work to a tool
 * pauses on `requires_action`, and only an answer turn ends with
 * `interaction.completed`. Emitting `completed` after a function call is a shape
 * the real API does not produce, so this suite must not rely on the loop
 * tolerating it.
 */
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

/**
 * A snapshot of the turn, for use as an assertion message.
 *
 * Cheap and string-only, because it has to be safe to build while a run is
 * already failing. These counts separate the three ways this chain can break -
 * the model never called the tool, the tool ran but never reached YouTube, or
 * the result never became a card - which matters because the CI logs and the
 * Playwright report are not readable from every environment this repo is worked
 * in, so the annotation has to carry the diagnosis itself.
 */
function traceFor(page: import('@playwright/test').Page, modelRequests: readonly unknown[], providerRequests: readonly unknown[]): () => Promise<string> {
  return async () => {
    const dom = await page.locator('.conversation').innerText().catch(() => '<conversation unavailable>');
    const payloads = JSON.stringify(modelRequests);
    return [
      `model requests=${modelRequests.length}`,
      `YouTube calls=${providerRequests.length}`,
      `tool result reached the model=${payloads.includes('lofiVid1')}`,
      `conversation: ${dom.replace(/\s+/g, ' ').slice(0, 400)}`,
    ].join(' | ');
  };
}

async function ask(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message Elara' }).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

test.describe('YouTube media results', () => {
  test('a searched result becomes a card, and only one billed call is made for both intents', async ({ page }) => {
    const modelRequests: Array<Record<string, unknown>> = [];
    const providerRequests: Array<{ url: string; apiKeyHeader: string | null }> = [];

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
          body: sseTurn('interaction-answer', [textStep('Here is what I found.')]),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseTurn('interaction-search', [
          toolCallStep('call-search', { queries: ['lofi beats'], intent: asks.listen ? 'listen' : 'watch' }),
        ], 'requires_action'),
      });
    });

    await page.route('**/youtube/v3/search**', async (route) => {
      providerRequests.push({
        url: route.request().url(),
        // `headerValue`, not `header`: the latter does not exist on Request, and
        // an exception thrown in a route handler fails the intercepted request
        // rather than the assertion, which reads as "the app never called
        // YouTube". e2e specs are outside `npm run typecheck`, so nothing else
        // catches this class of typo until a run.
        apiKeyHeader: await route.request().headerValue('x-goog-api-key'),
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [YOUTUBE_VIDEO] }) });
    });

    await page.goto('');
    await unlockTestLockbox(page);

    await ask(page, 'put on some lofi');
    const trace = traceFor(page, modelRequests, providerRequests);
    // The card is the signal that the whole chain ran, and asserting it first is
    // deliberate: the assistant bubble exists from the start of the turn, so any
    // count taken against it can be read before the tool has had a chance to
    // fetch. Everything below is therefore sampled after the card appeared, and
    // compared as a settled value rather than polled.
    const card = page.getByRole('link', { name: /Lo-Fi Roadtrip/ });
    await expect(card, await trace()).toBeVisible();
    expect(providerRequests.length, await trace()).toBe(1);

    // The tool was actually offered to the model, with the intent argument
    // declared - without this the model could never ask for a hand-off.
    // The first request that carries tools, not merely the first request: a turn
    // can start with a model call that declares none.
    const chatRequest = modelRequests.find((entry) => Array.isArray(entry.tools) && (entry.tools as unknown[]).length > 0);
    expect(chatRequest).toBeTruthy();
    const declarations = (chatRequest!.tools ?? []) as Array<Record<string, any>>;
    const youtube = declarations.find((entry) => entry.function?.name === 'youtube.search' || entry.name === 'youtube.search');
    if (!youtube) {
      throw new Error(`youtube.search was not declared to the model. Declared: ${JSON.stringify(declarations.map((entry) => entry.name ?? entry.function?.name))}`);
    }
    const parameters = ((youtube as Record<string, any>).function ?? youtube).parameters as Record<string, any>;
    expect(Object.keys(parameters.properties)).toContain('intent');
    expect(parameters.properties.intent.enum).toEqual(['watch', 'listen']);
    expect(parameters.required).toEqual(['queries']);

    // The key travels as a header only. A URL-borne key lands in history and logs.
    expect(providerRequests[0]!.apiKeyHeader).toBeTruthy();
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
    // One billed call for two intents is the design's central promise, so it is
    // asserted as a settled count once the second card is on screen.
    expect(providerRequests.length, await trace()).toBe(1);
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
      const androidModelRequests: Record<string, unknown>[] = [];
      const androidProviderCalls: string[] = [];
      await page.route('**/v1/interactions*', async (route) => {
        const payload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
        androidModelRequests.push(payload);
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
        androidProviderCalls.push(route.request().url());
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [YOUTUBE_VIDEO] }) });
      });

      await page.goto('');
      await unlockTestLockbox(page);
      await ask(page, 'put on some lofi');

      const card = page.getByRole('link', { name: /Lo-Fi Roadtrip/ });
      await expect(card, await traceFor(page, androidModelRequests, androidProviderCalls)()).toBeVisible();
      expect(androidProviderCalls, await traceFor(page, androidModelRequests, androidProviderCalls)()).toHaveLength(1);

      // The href is always https — never intent:// — so the link is never dead
      // and never shows ERR_UNKNOWN_URL_SCHEME. The intent URI is attempted via
      // a user-gesture navigation with https as guaranteed fallback.
      const href = await card.getAttribute('href');
      expect(href).toBe('https://music.youtube.com/watch?v=lofiVid1');

      // The intent URI is stored in data-intent-href and is what makes Android
      // resolve the link across every installed handler rather than the default
      // browser. The absence of a pinned package is what keeps the chooser visible.
      const intentHref = await card.getAttribute('data-intent-href');
      expect(intentHref).toContain('intent://music.youtube.com/watch?v=lofiVid1#Intent;');
      expect(intentHref).toContain('scheme=https;');
      // Decoded rather than compared as a literal: what matters is that the
      // fallback round-trips to the destination the tap will open. Note that
      // `%3D` here is not cosmetic - an unencoded `=` inside the parameter would
      // collide with the `;`-separated intent syntax and truncate the fallback.
      const fallback = /S\.browser_fallback_url=([^;]*)/.exec(intentHref ?? '')?.[1];
      expect(fallback ? decodeURIComponent(fallback) : null).toBe('https://music.youtube.com/watch?v=lofiVid1');
      expect(intentHref).toContain('category=android.intent.category.BROWSABLE');
      expect(intentHref).toContain('action=android.intent.action.VIEW');
      expect(intentHref).not.toContain(';package=');
      expect(intentHref?.endsWith(';end')).toBe(true);

      // The tooltip names the destination the tap will actually reach.
      await expect(card).toHaveAttribute('title', /in your music app$/);
      await expect(card.locator('iframe, video, audio')).toHaveCount(0);
      // Whether Android shows its chooser or opens a single default handler is the
      // platform's decision and cannot be observed from a browser. It is checked
      // on a device, not here.
    });
  });
});
