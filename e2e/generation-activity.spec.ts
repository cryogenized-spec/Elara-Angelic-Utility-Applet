import { expect, test } from '@playwright/test';

type Page = import('@playwright/test').Page;

async function unlockTestGemini(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill(['e2e', 'generation', 'activity', 'key'].join('-'));
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

async function openAppearance(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Appearance' }).click();
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message Elara' }).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
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
    interaction: { id: interactionId, status: 'completed', usage: { input_tokens: 12, output_tokens: 9 } },
  })}\n\n`;
  return created + thoughtEvents + answerStep(outputIndex, answer) + completed;
}

test.describe('Generation Activity', () => {
  test('anchors the live turn topside and yields to deliberate user scrolling', async ({ page }) => {
    let releaseFinal: (() => void) | undefined;
    const finalGate = new Promise<void>((resolve) => { releaseFinal = resolve; });
    let requestSequence = 0;

    await page.route('**/v1/interactions*', async (route) => {
      const payload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      const input = typeof payload.input === 'string' ? payload.input : '';
      requestSequence += 1;
      const interactionId = `activity-${requestSequence}`;

      if (input === 'hold-final') await finalGate;

      const answer = input === 'hold-final'
        ? 'Final response after the held generation.'
        : `History response ${requestSequence}.`;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: completedTurn(interactionId, answer, [`Considered ${input || 'the request'}.`]),
      });
    });

    await page.goto('');
    await unlockTestGemini(page);

    for (let index = 0; index < 7; index += 1) {
      await ask(page, `history-${index}`);
      await expect(page.getByText(`History response ${index + 1}.`, { exact: true })).toBeVisible();
    }

    await ask(page, 'hold-final');
    const conversation = page.getByRole('region', { name: 'Conversation' });
    const activity = page.locator('section.generation-activity:not(.is-complete)');
    await expect(activity).toHaveCount(1);
    await expect(activity).toHaveAttribute('aria-label', 'Generation activity');
    await expect(activity).toBeVisible();
    await expect(activity.getByRole('button')).toContainText(/Thinking · (?:\d+ ms|\d+\.\d s)/);

    await expect.poll(async () => {
      const conversationBox = await conversation.boundingBox();
      const activityBox = await activity.boundingBox();
      if (!conversationBox || !activityBox) return 9999;
      return Math.abs(activityBox.y - conversationBox.y);
    }).toBeLessThan(28);

    await conversation.hover();
    await page.mouse.wheel(0, -220);
    await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toBeVisible();
    const manualPosition = await conversation.evaluate((element) => element.scrollTop);

    if (!releaseFinal) throw new Error('final response gate was not initialized');
    releaseFinal();
    await expect(page.getByText('Final response after the held generation.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toBeVisible();

    const completedPosition = await conversation.evaluate((element) => element.scrollTop);
    expect(Math.abs(completedPosition - manualPosition)).toBeLessThan(80);
  });

  test('persists a long reasoning timeline inside a bounded, keyboard-accessible activity body', async ({ page }) => {
    const thoughts = Array.from({ length: 36 }, (_, index) => `Reasoning summary segment ${index + 1}.`);

    await page.route('**/v1/interactions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: completedTurn('activity-long', 'Long activity complete.', thoughts),
      });
    });

    await page.goto('');
    await unlockTestGemini(page);
    await ask(page, 'exercise a long reasoning trace');
    await expect(page.getByText('Long activity complete.', { exact: true })).toBeVisible();

    const activity = page.getByRole('region', { name: 'Generation activity' });
    await expect(activity).toHaveCount(1);
    const toggle = activity.getByRole('button');
    await expect(toggle).toContainText(/37 steps · .*total/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const body = activity.locator('.generation-activity__body');
    await page.keyboard.press('Tab');
    await expect(body).toBeFocused();
    await expect(body).toHaveAttribute('aria-label', 'Generation activity details');
    await expect(activity.getByText('Reasoning summary', { exact: true })).toBeVisible();
    await expect(activity.getByText('Reasoning summary segment 1.', { exact: false })).toBeVisible();
    await expect(activity.locator('.generation-activity__step')).toHaveCount(37);

    const dimensions = await body.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
    expect(dimensions.clientHeight).toBeGreaterThan(0);
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  });

  test('rehydrates the completed activity and renders stable reasoning Markdown after reload', async ({ page }) => {
    await page.route('**/v1/interactions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: completedTurn('activity-reload', 'Persisted activity answer.', ['**Persisted reasoning summary.**']),
      });
    });

    await page.goto('');
    await unlockTestGemini(page);
    await ask(page, 'persist this activity');
    await expect(page.getByText('Persisted activity answer.', { exact: true })).toBeVisible();

    let activity = page.getByRole('region', { name: 'Generation activity' });
    await expect(activity).toHaveCount(1);
    await expect(activity.getByRole('button')).toContainText(/2 steps · .*total/);
    await activity.getByRole('button').click();
    await expect(activity.locator('.generation-activity__summary-body strong')).toHaveText('Persisted reasoning summary.');
    await expect(activity.locator('.generation-activity__step')).toHaveCount(2);

    await page.reload();
    await expect(page.getByText('Persisted activity answer.', { exact: true })).toBeVisible();

    activity = page.getByRole('region', { name: 'Generation activity' });
    await expect(activity).toHaveCount(1);
    await expect(activity.getByRole('button')).toContainText(/2 steps · .*total/);
    await activity.getByRole('button').click();
    await expect(activity.locator('.generation-activity__summary-body strong')).toHaveText('Persisted reasoning summary.');
    await expect(activity.locator('.generation-activity__step')).toHaveCount(2);
  });

  test('applies and persists the Appearance activity accent through the rendered card', async ({ page }) => {
    const accent = '#34D399';
    const accentRgb = 'rgb(52, 211, 153)';

    await page.route('**/v1/interactions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: completedTurn('activity-accent', 'Accent verification answer.', ['Accent verification reasoning.']),
      });
    });

    await page.goto('');
    await unlockTestGemini(page);
    await openAppearance(page);
    const accentInput = page.getByLabel('Generation activity accent hex');
    await accentInput.fill(accent);
    await accentInput.blur();
    await expect(accentInput).toHaveValue(accent);
    await page.getByRole('button', { name: 'Back to chat' }).click();

    await ask(page, 'verify the activity accent');
    await expect(page.getByText('Accent verification answer.', { exact: true })).toBeVisible();
    let activity = page.getByRole('region', { name: 'Generation activity' });
    await expect(activity).toHaveCount(1);
    await expect.poll(() => activity.evaluate((element) => getComputedStyle(element).borderLeftColor)).toBe(accentRgb);

    await page.reload();
    await expect(page.getByText('Accent verification answer.', { exact: true })).toBeVisible();
    activity = page.getByRole('region', { name: 'Generation activity' });
    await expect(activity).toHaveCount(1);
    await expect.poll(() => activity.evaluate((element) => getComputedStyle(element).borderLeftColor)).toBe(accentRgb);

    await openAppearance(page);
    await expect(page.getByLabel('Generation activity accent hex')).toHaveValue(accent);
  });

  test('keeps partial and malformed hex edits transactional instead of resetting the committed accent', async ({ page }) => {
    await page.goto('');
    await openAppearance(page);
    const accentInput = page.getByLabel('Generation activity accent hex');

    await accentInput.fill('#A855F7');
    await accentInput.press('Enter');
    await expect(accentInput).toHaveValue('#A855F7');

    await accentInput.fill('#A85');
    await expect(accentInput).toHaveValue('#A85');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await accentInput.blur();
    await expect(accentInput).toHaveValue('#A855F7');
    await expect(page.getByRole('alert')).toContainText('Enter a 6-digit hex colour');

    await accentInput.fill(' 34d399 ');
    await accentInput.blur();
    await expect(accentInput).toHaveValue('#34D399');
    await expect(page.getByRole('alert')).toHaveCount(0);

    await page.reload();
    await openAppearance(page);
    await expect(page.getByLabel('Generation activity accent hex')).toHaveValue('#34D399');
  });

  test('keeps completed activity useful when Gemini supplies no reasoning summary', async ({ page }) => {
    await page.route('**/v1/interactions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: completedTurn('activity-no-thought', 'Answer without a reasoning summary.'),
      });
    });

    await page.goto('');
    await unlockTestGemini(page);
    await ask(page, 'answer directly');
    await expect(page.getByText('Answer without a reasoning summary.', { exact: true })).toBeVisible();

    const activity = page.getByRole('region', { name: 'Generation activity' });
    await expect(activity).toHaveCount(1);
    await activity.getByRole('button').click();
    await expect(activity.getByText('Reasoning summary')).toHaveCount(0);
    await expect(activity.locator('.generation-activity__step')).toHaveCount(1);
  });

  test('rolls back an optimistic completed assistant when terminal persistence fails', async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Captured only for Reflect.apply with an explicit IDBObjectStore receiver below.
      const originalPut = IDBObjectStore.prototype.put;
      let failedTerminalSave = false;
      IDBObjectStore.prototype.put = function patchedPut(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        const request = Reflect.apply(originalPut, this, key === undefined ? [value] : [value, key]) as IDBRequest<IDBValidKey>;
        const record = typeof value === 'object' && value !== null ? value as { role?: unknown; providerTurn?: { provider?: unknown } } : null;
        if (!failedTerminalSave && record?.role === 'assistant' && record.providerTurn?.provider === 'gemini') {
          failedTerminalSave = true;
          queueMicrotask(() => {
            try { this.transaction.abort(); } catch { /* transaction already settled */ }
          });
        }
        return request;
      };
    });

    await page.route('**/v1/interactions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: completedTurn('activity-save-failure', 'This optimistic answer must roll back.', ['Save failure reasoning.']),
      });
    });

    await page.goto('');
    await unlockTestGemini(page);
    await ask(page, 'persist failure probe');

    await expect(page.getByText(/Could not save the response\./)).toBeVisible();
    await expect(page.getByText('This optimistic answer must roll back.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('persist failure probe', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText('persist failure probe', { exact: true })).toBeVisible();
    await expect(page.getByText('This optimistic answer must roll back.', { exact: true })).toHaveCount(0);
  });
});
