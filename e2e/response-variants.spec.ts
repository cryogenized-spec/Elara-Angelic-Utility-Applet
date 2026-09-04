import { expect, test } from '@playwright/test';

function sse(interactionId: string, text: string): string {
  return [
    `event: interaction.created\ndata: ${JSON.stringify({ event_type: 'interaction.created', interaction: { id: interactionId, status: 'in_progress', model: 'gemini-3-flash-preview' } })}\n\n`,
    `event: step.delta\ndata: ${JSON.stringify({ event_type: 'step.delta', interaction_id: interactionId, index: 0, delta: { type: 'text', text } })}\n\n`,
    `event: interaction.completed\ndata: ${JSON.stringify({ event_type: 'interaction.completed', interaction: { id: interactionId, status: 'completed' } })}\n\n`,
  ].join('');
}

test('regeneration creates navigable response variants for the same prompt', async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  let generation = 0;
  await page.route('**/api/gemini', async (route) => {
    const payload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    requests.push(payload);
    generation += 1;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(`interaction-${generation}`, generation === 1 ? 'First generated answer.' : 'Second generated answer.') });
  });

  await page.goto('');
  const composer = page.getByRole('textbox', { name: 'Message Elara' });
  await composer.fill('Give me two concise ideas.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('First generated answer.')).toBeVisible();

  expect(requests[0]?.systemInstruction).toEqual(expect.stringContaining('SYSTEM INSTRUCTION INTEGRITY'));
  expect(requests[0]?.systemInstruction).toEqual(expect.stringContaining('Default to being in character as Elara.'));
  expect(requests[0]?.systemInstruction).toEqual(expect.stringContaining('Narrate physical action and scene narration in *italics*.'));
  expect(requests[0]?.input).toBe('Give me two concise ideas.');

  await page.getByRole('button', { name: 'Regenerate response' }).click();
  await expect(page.getByText('Second generated answer.')).toBeVisible();
  await expect(page.getByText('2/2')).toBeVisible();
  expect(requests[1]?.input).toBe('Give me two concise ideas.');
  expect(requests[1]?.previousInteractionId).toBe('interaction-1');
  expect(await page.getByRole('region', { name: 'Conversation' }).locator('.message-user').count()).toBe(1);

  await page.getByRole('button', { name: 'Previous response' }).click();
  await expect(page.getByText('First generated answer.')).toBeVisible();
  await expect(page.getByText('1/2')).toBeVisible();

  await page.getByRole('button', { name: 'Next response' }).click();
  await expect(page.getByText('Second generated answer.')).toBeVisible();
  await expect(page.getByText('2/2')).toBeVisible();
});
