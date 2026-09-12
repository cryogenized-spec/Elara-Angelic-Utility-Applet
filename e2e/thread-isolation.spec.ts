import { expect, test } from '@playwright/test';

function sse(interactionId: string): string {
  return [
    `event: interaction.created\ndata: ${JSON.stringify({ event_type: 'interaction.created', interaction: { id: interactionId, status: 'in_progress', model: 'gemini-3.8-flash' } })}\n\n`,
    `event: step.delta\ndata: ${JSON.stringify({ event_type: 'step.delta', interaction_id: interactionId, index: 0, delta: { type: 'text', text: 'Old thread response.' } })}\n\n`,
    `event: interaction.completed\ndata: ${JSON.stringify({ event_type: 'interaction.completed', interaction: { id: interactionId, status: 'completed' } })}\n\n`,
  ].join('');
}

async function unlockTestGemini(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill(['e2e', 'test', 'api', 'key'].join('-'));
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

test('starting a new thread isolates it from a still-running previous response', async ({ page }) => {
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  let interactionRequests = 0;
  let responseDelivered = false;

  await page.route('**/v1/interactions*', async (route) => {
    interactionRequests += 1;
    await responseGate;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse('old-thread-interaction') });
    responseDelivered = true;
  });

  await page.goto('');
  await unlockTestGemini(page);
  const conversation = page.getByRole('region', { name: 'Conversation' });
  const composer = page.getByRole('textbox', { name: 'Message Elara' });
  await composer.fill('This belongs only to the old thread.');
  await page.getByRole('button', { name: 'Send message' }).click();

  // Prove this test really entered the canonical browser-direct Gemini path.
  // The old test intercepted /api/gemini and had no Lockbox key, so it could
  // pass while the send was rejected before any provider request existed.
  await expect(conversation.locator('.message-user', { hasText: 'This belongs only to the old thread.' })).toHaveCount(1);
  await expect.poll(() => interactionRequests).toBe(1);

  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'New chat' }).click();

  const newConversation = page.getByRole('region', { name: 'Conversation' });
  await expect(newConversation).not.toContainText('This belongs only to the old thread.');
  await expect(newConversation).not.toContainText('Old thread response.');

  // Release the response only after the new thread is active. This is a
  // deterministic race: no sleep controls whether the old response arrives.
  releaseResponse();
  await expect.poll(() => responseDelivered).toBe(true);
  await expect(interactionRequests).toBe(1);
  await expect(newConversation).not.toContainText('This belongs only to the old thread.');
  await expect(newConversation).not.toContainText('Old thread response.');
});
