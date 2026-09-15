import { expect, test, type Page } from '@playwright/test';

const VIDEO_ID = 'advPlay8A1B';
const TITLE = 'Phase 8 Playback Probe';
const CANONICAL_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

function providerVideo() {
  return {
    id: { kind: 'youtube#video', videoId: VIDEO_ID },
    snippet: {
      title: TITLE,
      channelTitle: 'Elara Adversarial Lab',
      publishedAt: '2026-09-15T00:00:00Z',
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

function toolCallStep(): string {
  return [
    `event: step.start\ndata: ${JSON.stringify({
      event_type: 'step.start',
      index: 0,
      step: {
        index: 0,
        type: 'function_call',
        id: 'phase8-youtube-call',
        name: 'youtube.search',
        arguments: { queries: ['phase 8 playback probe'], intent: 'watch' },
      },
    })}\n\n`,
    `event: step.stop\ndata: ${JSON.stringify({ event_type: 'step.stop', index: 0 })}\n\n`,
  ].join('');
}

async function installMediaTurn(page: Page): Promise<void> {
  let modelCall = 0;
  await page.route('**/v1/interactions*', async (route) => {
    modelCall += 1;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: modelCall === 1
        ? sseTurn('phase8-search', [toolCallStep()], 'requires_action')
        : sseTurn('phase8-complete', []),
    });
  });
  await page.route('**/youtube/v3/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [providerVideo()] }),
    });
  });
}

async function unlockTestLockbox(page: Page): Promise<void> {
  await page.route('**/youtube/v3/videos**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill('phase8-e2e-gemini-key');
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();
  await page.getByLabel('YouTube API key').fill('phase8-e2e-youtube-key');
  await page.getByLabel('Current Lockbox credential for the YouTube key').fill('284619');
  await page.getByRole('button', { name: 'Save YouTube Key' }).click();
  await expect(page.getByText(/YouTube Data API · configured · unlocked/)).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
  await page.unroute('**/youtube/v3/videos**');
}

async function askForCard(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.getByRole('textbox', { name: 'Message Elara' }).fill('show the phase 8 playback probe');
  await page.getByRole('button', { name: 'Send message' }).click();
  const card = page.locator('.media-card').filter({ hasText: TITLE });
  await expect(card).toBeVisible();
  return card;
}

async function openPlayHere(card: ReturnType<Page['locator']>): Promise<void> {
  await card.locator('.media-card__primary').click();
  await card.getByRole('button', { name: 'Play here' }).click();
}

async function corruptPersistedWebUrl(page: Page): Promise<void> {
  await page.evaluate(async ({ videoId }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('elara-angelic-utility-applet');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('messages', 'readwrite');
        const store = transaction.objectStore('messages');
        const read = store.getAll();
        read.onerror = () => reject(read.error);
        read.onsuccess = () => {
          for (const row of read.result as Array<{ media?: Array<Record<string, unknown>> }>) {
            if (!Array.isArray(row.media)) continue;
            const next = row.media.map((entry) => entry.id === videoId
              ? { ...entry, webUrl: `https://evil.example/watch?v=${videoId}` }
              : entry);
            store.put({ ...row, media: next });
          }
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, { videoId: VIDEO_ID });
}

function fakeIframeApiScript(): string {
  return `
    window.__phase8PlayerCount = window.__phase8PlayerCount || 0;
    window.YT = {
      Player: function(target, options) {
        window.__phase8PlayerCount += 1;
        var iframe = document.createElement('iframe');
        iframe.dataset.phase8PlayerInstance = String(window.__phase8PlayerCount);
        iframe.title = 'YouTube video player';
        target.replaceWith(iframe);
        this.destroy = function() { iframe.remove(); };
        setTimeout(function() { options.events.onReady(); }, 0);
      }
    };
    setTimeout(function() {
      if (typeof window.onYouTubeIframeAPIReady === 'function') window.onYouTubeIframeAPIReady();
    }, 0);
  `;
}

test.describe('Phase 8 adversarial media playback acceptance', () => {
  test('offline readiness fails closed, remains retryable, and keeps the exact external fallback', async ({ page }) => {
    await installMediaTurn(page);
    await page.goto('');
    await unlockTestLockbox(page);
    const card = await askForCard(page);

    let readinessAttempts = 0;
    await page.route('**/youtube/v3/videos**', async (route) => {
      readinessAttempts += 1;
      await route.abort('failed');
    });

    await openPlayHere(card);
    await expect(card.locator('.media-card__failure')).toContainText('Could not reach YouTube to check internal playback.');
    await expect(card.getByRole('link', { name: 'Open YouTube instead' })).toHaveAttribute('href', CANONICAL_URL);
    await expect(page.locator('.playback-player-surface')).toBeHidden();

    await openPlayHere(card);
    await expect.poll(() => readinessAttempts).toBe(2);
    await expect(card.getByRole('link', { name: 'Open YouTube instead' })).toHaveAttribute('href', CANONICAL_URL);
  });

  test('a visible player survives preset changes without recreation and stays usable at a narrow Android-sized viewport', async ({ page }) => {
    await installMediaTurn(page);
    await page.route('**/youtube/v3/videos**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ id: VIDEO_ID, status: { embeddable: true, madeForKids: false } }] }),
      });
    });
    await page.route('**/iframe_api', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: fakeIframeApiScript() });
    });

    await page.goto('');
    await unlockTestLockbox(page);
    await page.route('**/youtube/v3/videos**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ id: VIDEO_ID, status: { embeddable: true, madeForKids: false } }] }),
      });
    });
    const card = await askForCard(page);

    await openPlayHere(card);
    await expect(card.locator('.media-card__primary')).toContainText('Player ready');
    const surface = page.locator('.playback-player-surface');
    await expect(surface).toBeVisible();
    const iframe = surface.locator('iframe[data-phase8-player-instance="1"]');
    await expect(iframe).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __phase8PlayerCount?: number }).__phase8PlayerCount ?? 0)).toBe(1);

    await page.getByRole('button', { name: 'Open sidebar' }).click();
    await page.getByRole('button', { name: 'Open settings' }).click();
    const presets = page.getByRole('radiogroup', { name: 'Media player surface preset' });
    await presets.getByRole('radio', { name: 'Cinema' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-elara-media-player-preset', 'cinema');
    await presets.getByRole('radio', { name: 'Minimal' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-elara-media-player-preset', 'minimal');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __phase8PlayerCount?: number }).__phase8PlayerCount ?? 0)).toBe(1);
    await expect(iframe).toHaveCount(1);

    await page.getByRole('button', { name: 'Back to chat' }).click();
    await page.setViewportSize({ width: 220, height: 500 });
    const surfaceBox = await surface.boundingBox();
    const hostBox = await surface.locator('.playback-player-host').boundingBox();
    expect(surfaceBox && hostBox).toBeTruthy();
    expect(surfaceBox!.x).toBeGreaterThanOrEqual(0);
    expect(surfaceBox!.x + surfaceBox!.width).toBeLessThanOrEqual(220);
    expect(hostBox!.width).toBeGreaterThanOrEqual(200);
    expect(hostBox!.height).toBeGreaterThanOrEqual(200);

    await surface.getByRole('button', { name: 'Close player' }).click();
    await expect(surface).toBeHidden();
    await expect(surface.locator('iframe')).toHaveCount(0);
  });

  test('corrupted persisted media becomes inert after reload instead of becoming an internal or external target', async ({ page }) => {
    await installMediaTurn(page);
    await page.goto('');
    await unlockTestLockbox(page);
    const card = await askForCard(page);
    await expect(card).toBeVisible();

    await expect.poll(async () => page.evaluate((videoId) => {
      return new Promise<boolean>((resolve, reject) => {
        const request = indexedDB.open('elara-angelic-utility-applet');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const read = database.transaction('messages', 'readonly').objectStore('messages').getAll();
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            const found = (read.result as Array<{ media?: Array<{ id?: string }> }>).some((row) => row.media?.some((entry) => entry.id === videoId));
            database.close();
            resolve(found);
          };
        };
      });
    }, VIDEO_ID)).toBe(true);

    await corruptPersistedWebUrl(page);
    await page.reload();

    const unavailable = page.locator('.media-card--unavailable').filter({ hasText: TITLE });
    await expect(unavailable).toBeVisible();
    await expect(unavailable).toContainText('Unavailable');
    await expect(unavailable.locator('a, button')).toHaveCount(0);
    await expect(page.locator('a[href*="evil.example"]')).toHaveCount(0);
  });

  test('repeated chooser open/Escape cycles restore focus without multiplying chooser surfaces', async ({ page }) => {
    await installMediaTurn(page);
    await page.goto('');
    await unlockTestLockbox(page);
    const card = await askForCard(page);
    const primary = card.locator('.media-card__primary');

    for (let cycle = 0; cycle < 10; cycle += 1) {
      await primary.click();
      await expect(card.locator('.media-card__chooser')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(card.locator('.media-card__chooser')).toHaveCount(0);
      await expect(primary).toBeFocused();
    }
  });
});
