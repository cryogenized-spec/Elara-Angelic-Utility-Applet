import { expect, test, type Page } from '@playwright/test';

const VIDEO_ID = 'closeoutVid1';
const CANONICAL_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

function providerVideo(title = 'Closeout Media Probe') {
  return {
    id: { kind: 'youtube#video', videoId: VIDEO_ID },
    snippet: {
      title,
      channelTitle: 'Elara Reliability',
      publishedAt: '2026-09-13T00:00:00Z',
      thumbnails: {
        high: { url: `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`, width: 480, height: 360 },
      },
    },
  };
}

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

function toolCallStep(callId: string, query: string): string {
  return [
    `event: step.start\ndata: ${JSON.stringify({
      event_type: 'step.start',
      index: 0,
      step: {
        index: 0,
        type: 'function_call',
        id: callId,
        name: 'youtube.search',
        arguments: { queries: [query], intent: 'watch' },
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

function failedTurn(interactionId: string, message = 'Continuation failed deliberately.'): string {
  return [
    `event: interaction.created\ndata: ${JSON.stringify({
      event_type: 'interaction.created',
      interaction: { id: interactionId, status: 'in_progress', model: 'gemini-3.8-flash' },
    })}\n\n`,
    `event: error\ndata: ${JSON.stringify({
      event_type: 'error',
      interaction_id: interactionId,
      error: { message, status: 500, code: 'INTERNAL' },
    })}\n\n`,
  ].join('');
}

async function unlockTestLockbox(page: Page): Promise<void> {
  await page.route('**/youtube/v3/videos**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });

  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill('closeout-e2e-gemini-key');
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();

  await page.getByLabel('YouTube API key').fill('closeout-e2e-youtube-key');
  await page.getByLabel('Current Lockbox credential for the YouTube key').fill('284619');
  await page.getByRole('button', { name: 'Save YouTube Key' }).click();
  await expect(page.getByText(/YouTube Data API · configured · unlocked/)).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message Elara' }).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

async function persistedMediaSnapshot(page: Page): Promise<Array<{ id: string; title: string }>> {
  return page.evaluate(async (videoId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('elara-angelic-utility-applet');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise<Array<{ media?: unknown }>>((resolve, reject) => {
        const request = database.transaction('messages', 'readonly').objectStore('messages').getAll();
        request.onsuccess = () => resolve(request.result as Array<{ media?: unknown }>);
        request.onerror = () => reject(request.error);
      });
      const mediaValues = rows.flatMap((row): unknown[] => Array.isArray(row.media) ? row.media as unknown[] : []);
      return mediaValues
        .filter((entry): entry is { id: string; title: string } => (
          typeof entry === 'object'
          && entry !== null
          && (entry as { id?: unknown }).id === videoId
          && typeof (entry as { title?: unknown }).title === 'string'
        ))
        .map((entry) => ({ id: entry.id, title: entry.title }));
    } finally {
      database.close();
    }
  }, VIDEO_ID);
}

async function installSingleSearch(page: Page, continuation: (route: import('@playwright/test').Route) => Promise<void>): Promise<void> {
  await page.route('**/v1/interactions*', async (route) => {
    const payload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    if (JSON.stringify(payload).includes(VIDEO_ID)) {
      await continuation(route);
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseTurn('closeout-search', [toolCallStep('closeout-call', 'closeout media probe')], 'requires_action'),
    });
  });
  await page.route('**/youtube/v3/search**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [providerVideo()] }) });
  });
}

test.describe('media lifecycle closeout acceptance', () => {
  test('a media-only terminal answer is renderable, singular, durable, reloadable, and exposes accessible default ask routes', async ({ page }) => {
    await installSingleSearch(page, async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseTurn('closeout-media-only', []) });
    });

    await page.goto('');
    await unlockTestLockbox(page);
    await ask(page, 'return only the matching media card');

    const card = page.locator('.media-card').filter({ hasText: 'Closeout Media Probe' });
    await expect(card).toBeVisible();
    await expect(page.locator('.message-assistant')).toHaveCount(1);
    await expect(page.locator('.message-assistant--streaming')).toHaveCount(0);

    const primary = card.locator('.media-card__primary');
    await expect(primary).toContainText('Choose playback');
    await primary.click();
    await expect(card.getByRole('button', { name: 'Play here' })).toBeVisible();
    const external = card.locator('a.media-card__choice--external');
    await expect(external).toHaveAttribute('href', CANONICAL_URL);

    await page.keyboard.press('Escape');
    await expect(card.locator('.media-card__chooser')).toHaveCount(0);
    await expect(primary).toBeFocused();
    await expect(primary).toHaveAttribute('aria-expanded', 'false');

    await primary.click();
    await expect(card.getByRole('button', { name: 'Play here' })).toBeVisible();
    await expect(external).toHaveAttribute('href', CANONICAL_URL);

    await expect.poll(async () => JSON.stringify(await persistedMediaSnapshot(page)))
      .toBe(JSON.stringify([{ id: VIDEO_ID, title: 'Closeout Media Probe' }]));

    await page.reload();
    await expect(page.locator('.media-card').filter({ hasText: 'Closeout Media Probe' })).toHaveCount(1);
    await expect(page.locator('.message-assistant')).toHaveCount(1);
  });

  test('resolved media renders before a deliberately stalled Gemini continuation', async ({ page }) => {
    let releaseContinuation: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { releaseContinuation = resolve; });
    let continuationStarted = false;

    await installSingleSearch(page, async (route) => {
      continuationStarted = true;
      await gate;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseTurn('closeout-stalled-answer', [textStep('Continuation released.')]),
      });
    });

    await page.goto('');
    await unlockTestLockbox(page);
    await ask(page, 'show the card before finishing');

    try {
      await expect.poll(() => continuationStarted).toBe(true);
      await expect(page.locator('.media-card').filter({ hasText: 'Closeout Media Probe' })).toBeVisible();
      await expect(page.locator('.message-assistant--streaming')).toHaveCount(1);
      await expect(page.getByText('Continuation released.', { exact: true })).toHaveCount(0);
    } finally {
      releaseContinuation();
    }

    await expect(page.getByText('Continuation released.', { exact: true })).toBeVisible();
    await expect(page.locator('.message-assistant--streaming')).toHaveCount(0);
  });

  test('a failed continuation leaves useful partial media visible but never makes it durable', async ({ page }) => {
    await installSingleSearch(page, async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: failedTurn('closeout-failure') });
    });

    await page.goto('');
    await unlockTestLockbox(page);
    await ask(page, 'fail after resolving media');

    await expect(page.locator('.media-card').filter({ hasText: 'Closeout Media Probe' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Continuation failed deliberately.');
    await expect.poll(async () => JSON.stringify(await persistedMediaSnapshot(page))).toBe('[]');

    await page.reload();
    await expect(page.getByText('fail after resolving media', { exact: true })).toBeVisible();
    await expect(page.locator('.media-card').filter({ hasText: 'Closeout Media Probe' })).toHaveCount(0);
  });

  test('the same provider identity from separate tool calls collapses to one newest card', async ({ page }) => {
    let modelCall = 0;
    const providerQueries: string[] = [];

    await page.route('**/v1/interactions*', async (route) => {
      modelCall += 1;
      if (modelCall === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: sseTurn('closeout-dedupe-1', [toolCallStep('dedupe-call-1', 'first duplicate probe')], 'requires_action'),
        });
        return;
      }
      if (modelCall === 2) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: sseTurn('closeout-dedupe-2', [toolCallStep('dedupe-call-2', 'second duplicate probe')], 'requires_action'),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseTurn('closeout-dedupe-final', []) });
    });
    await page.route('**/youtube/v3/search**', async (route) => {
      const query = new URL(route.request().url()).searchParams.get('q') ?? '';
      providerQueries.push(query);
      const title = query.startsWith('second') ? 'Closeout Media Probe — refreshed' : 'Closeout Media Probe — first';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [providerVideo(title)] }) });
    });

    await page.goto('');
    await unlockTestLockbox(page);
    await ask(page, 'exercise duplicate media identities');

    const cards = page.locator('.media-card');
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText('Closeout Media Probe — refreshed');
    expect(providerQueries).toEqual(['first duplicate probe', 'second duplicate probe']);
    await expect.poll(async () => JSON.stringify(await persistedMediaSnapshot(page)))
      .toBe(JSON.stringify([{ id: VIDEO_ID, title: 'Closeout Media Probe — refreshed' }]));

    await page.reload();
    await expect(page.locator('.media-card')).toHaveCount(1);
    await expect(page.locator('.media-card')).toContainText('Closeout Media Probe — refreshed');
  });
});

test.describe('Android media handoff closeout acceptance', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' });

  test('a real ask-choice click executes the Android handoff handler and preserves canonical HTTPS fallback', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __mediaOpened?: string }).__mediaOpened = '';
      window.open = ((url?: string | URL) => {
        (window as unknown as { __mediaOpened?: string }).__mediaOpened = String(url ?? '');
        return null;
      }) as typeof window.open;
    });

    await installSingleSearch(page, async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseTurn('closeout-click', []) });
    });

    await page.goto('');
    await unlockTestLockbox(page);
    await ask(page, 'open the closeout media probe');

    const card = page.locator('.media-card').filter({ hasText: 'Closeout Media Probe' });
    await expect(card).toBeVisible();
    await card.locator('.media-card__primary').click();
    const external = card.locator('a.media-card__choice--external');
    await expect(external).toHaveAttribute('href', CANONICAL_URL);
    await external.click();

    await expect.poll(() => page.evaluate(() => (window as unknown as { __mediaOpened?: string }).__mediaOpened ?? ''))
      .toBe(CANONICAL_URL);
  });
});
