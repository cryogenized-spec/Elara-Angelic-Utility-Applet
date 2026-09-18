import { expect, test } from '@playwright/test';

function sse(interactionId: string): string {
  return [
    `event: interaction.created\ndata: ${JSON.stringify({ event_type: 'interaction.created', interaction: { id: interactionId, status: 'in_progress', model: 'gemini-3-flash-preview' } })}\n\n`,
    `event: step.delta\ndata: ${JSON.stringify({ event_type: 'step.delta', interaction_id: interactionId, index: 0, delta: { type: 'text', text: 'Old thread response.' } })}\n\n`,
    `event: interaction.completed\ndata: ${JSON.stringify({ event_type: 'interaction.completed', interaction: { id: interactionId, status: 'completed' } })}\n\n`,
  ].join('');
}

test('starting a new thread isolates it from a still-running previous response', async ({ page }) => {
  // Browser turns now go directly through the Interactions transport. Keep the
  // delayed response on that real route so this test continues to prove that
  // late events from an abandoned conversation cannot leak into the new one.
  await page.route('**/v1/interactions*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse('old-thread-interaction') });
  });

  await page.goto('');
  const composer = page.getByRole('textbox', { name: 'Message Elara' });
  await composer.fill('This belongs only to the old thread.');
  await page.getByRole('button', { name: 'Send message' }).click();

  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'New chat' }).click();

  const conversation = page.getByRole('region', { name: 'Conversation' });
  await expect(conversation).not.toContainText('This belongs only to the old thread.');
  await expect(conversation).not.toContainText('Old thread response.');
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await expect(conversation).not.toContainText('This belongs only to the old thread.');
  await expect(conversation).not.toContainText('Old thread response.');
});
