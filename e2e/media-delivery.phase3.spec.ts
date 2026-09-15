import { expect, test, type Page } from '@playwright/test';

const PHASE3_VIDEO_ID = 'phase3Vid1';
const PHASE3_THUMBNAIL = `https://i.ytimg.com/vi/${PHASE3_VIDEO_ID}/hqdefault.jpg`;
const PHASE3_VIDEO = {
  id: { kind: 'youtube#video', videoId: PHASE3_VIDEO_ID },
  snippet: {
    title: 'Phase 3 Delivery Probe',
    channelTitle: 'Elara Reliability',
    publishedAt: '2026-09-13T00:00:00Z',
    thumbnails: {
      high: { url: PHASE3_THUMBNAIL, width: 480, height: 360 },
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

function toolCallStep(): string {
  return [
    `event: step.start\ndata: ${JSON.stringify({
      event_type: 'step.start',
      index: 0,
      step: {
        index: 0,
        type: 'function_call',
        id: 'phase3-call',
        name: 'youtube.search',
        arguments: { queries: ['phase 3 media'], intent: 'watch' },
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
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill('phase3-e2e-gemini-key');
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();

  await page.getByLabel('YouTube API key').fill('phase3-e2e-youtube-key');
  await page.getByLabel('Current Lockbox credential for the YouTube key').fill('284619');
  await page.getByRole('button', { name: 'Save YouTube Key' }).click();
  await expect(page.getByText('YouTube Data API · configured · unlocked')).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message Elara' }).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

async function installMediaTurn(page: Page): Promise<void> {
  await page.route('**/v1/interactions*', async (route) => {
    const payload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    const wire = JSON.stringify(payload);
    const hasToolResult = wire.includes(PHASE3_VIDEO_ID);
    const offersYouTube = wire.includes('youtube.search');
    const isProbe = wire.includes('show phase 3 media');

    if (hasToolResult || !offersYouTube || !isProbe) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseTurn('phase3-answer', [textStep('Delivery probe complete.')]),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseTurn('phase3-search', [toolCallStep()], 'requires_action'),
    });
  });

  await page.route('**/youtube/v3/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [PHASE3_VIDEO] }),
    });
  });
}

async function waitTwoFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

test.describe('Phase 3 media delivery resilience', () => {
  test('a delayed lazy media module reserves useful card geometry before it settles', async ({ page }) => {
    let releaseModule: () => void = () => undefined;
    const moduleGate = new Promise<void>((resolve) => { releaseModule = resolve; });
    let interceptedModules = 0;

    await page.route(/\/src\/app\/components\/media\/MediaCard\.tsx(?:\?|$)/, async (route) => {
      interceptedModules += 1;
      await moduleGate;
      await route.continue();
    });
    await installMediaTurn(page);

    await page.goto('');
    await unlockTestLockbox(page);
    await ask(page, 'show phase 3 media');

    const shell = page.locator('.media-card__skeleton');
    try {
      await expect.poll(() => interceptedModules).toBeGreaterThan(0);
      await expect(shell).toHaveCount(1);
      await expect(shell).toBeVisible();

      const shellBox = await shell.boundingBox();
      const conversationBox = await page.locator('.conversation').boundingBox();
      expect(shellBox).not.toBeNull();
      expect(conversationBox).not.toBeNull();
      expect(shellBox!.height).toBeGreaterThan(120);
      expect(shellBox!.width).toBeLessThanOrEqual(conversationBox!.width + 1);
    } finally {
      releaseModule();
    }

    const card = page.locator('.media-card').filter({ hasText: 'Phase 3 Delivery Probe' });
    await expect(card).toBeVisible();
    await expect(shell).toHaveCount(0);
  });

  test('a very slow thumbnail reserves 16:9 geometry and a later 404 degrades in place', async ({ page }) => {
    let releaseImage: () => void = () => undefined;
    const imageGate = new Promise<void>((resolve) => { releaseImage = resolve; });
    let thumbnailRequests = 0;

    await installMediaTurn(page);
    await page.route(PHASE3_THUMBNAIL, async (route) => {
      thumbnailRequests += 1;
      await imageGate;
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    });

    await page.goto('');
    await unlockTestLockbox(page);
    await ask(page, 'show phase 3 media');

    const card = page.locator('.media-card').filter({ hasText: 'Phase 3 Delivery Probe' });
    await expect(card).toBeVisible();
    const image = card.locator('img.media-card__thumb');

    try {
      await expect.poll(() => thumbnailRequests).toBeGreaterThan(0);
      await expect(image).toHaveCount(1);
      const box = await image.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width / box!.height).toBeGreaterThan(1.72);
      expect(box!.width / box!.height).toBeLessThan(1.83);
    } finally {
      releaseImage();
    }

    await expect(image).toHaveCount(0);
    await expect(card.locator('.media-card__thumb--empty')).toBeVisible();
    await expect(card).toContainText('Phase 3 Delivery Probe');
  });

  test('late content growth follows the bottom but never overrides deliberate manual scroll', async ({ page }) => {
    await page.route('**/v1/interactions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseTurn('phase3-scroll', [textStep('Scroll probe answer.')]),
      });
    });

    await page.goto('');
    await unlockTestLockbox(page);
    await ask(page, 'phase 3 scroll probe');
    await expect(page.getByText('Scroll probe answer.')).toBeVisible();
    await expect(page.locator('.message-assistant--streaming')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toHaveCount(0);

    await page.evaluate(() => {
      const stream = document.querySelector<HTMLElement>('.conversation__stream');
      if (!stream) throw new Error('Conversation stream unavailable');
      const spacer = document.createElement('div');
      spacer.dataset.phase3Growth = 'bottom';
      spacer.style.height = '1800px';
      stream.append(spacer);
    });

    await expect.poll(() => page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('.conversation');
      if (!element) throw new Error('Conversation unavailable');
      return element.scrollHeight - element.scrollTop - element.clientHeight;
    })).toBeLessThanOrEqual(2);
    await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toHaveCount(0);

    const conversation = page.locator('.conversation');
    await conversation.hover();
    await page.mouse.wheel(0, -1600);
    await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toBeVisible();

    const manualTop = await conversation.evaluate((element) => element.scrollTop);
    await page.evaluate(() => {
      const stream = document.querySelector<HTMLElement>('.conversation__stream');
      if (!stream) throw new Error('Conversation stream unavailable');
      const spacer = document.createElement('div');
      spacer.dataset.phase3Growth = 'manual';
      spacer.style.height = '1200px';
      stream.append(spacer);
    });
    await waitTwoFrames(page);
    await page.waitForTimeout(80);

    const afterGrowth = await conversation.evaluate((element) => element.scrollTop);
    expect(Math.abs(afterGrowth - manualTop)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toBeVisible();
  });
});
