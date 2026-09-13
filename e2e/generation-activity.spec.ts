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

    // Build history only through the public composer so the scroll container is
    // genuinely occupied; no storage or DOM state is manufactured for the test.
    for (let index = 0; index < 7; index += 1) {
      await ask(page, `history-${index}`);
      await expect(page.getByText(`History response ${index + 1}.`, { exact: true })).toBeVisible();
    }

    await ask(page, 'hold-final');
    const conversation = page.getByRole('region', { name: 'Conversation' });
    const activity = page.getByRole('region', { name: 'Generation activity' });
    await expect(activity).toBeVisible();
    await expect(activity.getByRole('button')).toContainText(/Thinking · (?:\d+ ms|\d+\.\d s)/);

    await expect.poll(async () => {
      const conversationBox = await conversation.boundingBox();
      const activityBox = await activity.boundingBox();
      if (!conversationBox || !activityBox) return 9999;
      return Math.abs(activityBox.y - conversationBox.y);
    }).toBeLessThan(28);

    // A deliberate user scroll changes the follow mode. The Newest affordance
    // is the visible proof that the app no longer owns the viewport position.
    await conversation.evaluate((element) => element.scrollBy({ top: -160, behavior: 'auto' }));
    await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toBeVisible();
    const manualPosition = await conversation.evaluate((element) => element.scrollTop);

    if (!releaseFinal) throw new Error('final response gate was not initialized');
    releaseFinal();
    await expect(page.getByText('Final response after the held generation.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toBeVisible();

    const completedPosition = await conversation.evaluate((element) => element.scrollTop);
    expect(Math.abs(completedPosition - manualPosition)).toBeLessThan(80);
  });

  test('persists a long reasoning timeline inside a bounded activity body', async ({ page }) => {
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
    await expect(toggle).toContainText(/Thought for .*wrote in .*total/);
    await toggle.click();

    await expect(activity.getByText('Reasoning summary')).toBeVisible();
    await expect(activity.getByText('Reasoning summary segment 1.', { exact: false })).toBeVisible();
    await expect(activity.locator('.generation-activity__step')).toHaveCount(37);

    const body = activity.locator('.generation-activity__body');
    const dimensions = await body.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
    expect(dimensions.clientHeight).toBeGreaterThan(0);
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
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
});
