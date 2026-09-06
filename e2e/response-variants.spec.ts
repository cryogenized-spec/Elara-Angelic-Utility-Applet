import { expect, test } from '@playwright/test';

function sse(interactionId: string, text: string): string {
  return [
    `event: interaction.created\ndata: ${JSON.stringify({ event_type: 'interaction.created', interaction: { id: interactionId, status: 'in_progress', model: 'gemini-3.8-flash' } })}\n\n`,
    `event: step.delta\ndata: ${JSON.stringify({ event_type: 'step.delta', interaction_id: interactionId, index: 0, delta: { type: 'text', text } })}\n\n`,
    `event: interaction.completed\ndata: ${JSON.stringify({ event_type: 'interaction.completed', interaction: { id: interactionId, status: 'completed' } })}\n\n`,
  ].join('');
}

async function unlockTestGemini(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill('e2e-' + 'test-api-key');
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

test('regeneration creates navigable response variants for the same prompt', async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  let generation = 0;
  await page.route('**/v1beta/interactions*', async (route) => {
    const payload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    requests.push(payload);
    generation += 1;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(`interaction-${generation}`, generation === 1 ? 'First generated answer.' : 'Second generated answer.') });
  });

  await page.goto('');
  await unlockTestGemini(page);
  const composer = page.getByRole('textbox', { name: 'Message Elara' });
  await composer.fill('Give me two concise ideas.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('First generated answer.')).toBeVisible();

  expect(requests[0]?.system_instruction).toBeUndefined();
  expect(requests[0]?.input).toBe('Give me two concise ideas.');

  await page.getByRole('button', { name: 'Regenerate response' }).click();
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('2/2')).toBeVisible();
  expect(requests[1]?.system_instruction).toBeUndefined();
  expect(requests[1]?.input).toBe('Give me two concise ideas.');
  expect(requests[1]?.previous_interaction_id).toBe('interaction-1');
  await expect(page.getByRole('region', { name: 'Conversation' }).locator('.message-user')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Next response' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Previous response' })).toBeEnabled();

  await page.getByRole('button', { name: 'Previous response' }).click();
  await expect(page.getByText('First generated answer.')).toBeVisible();
  await expect(page.getByText('1/2')).toBeVisible();

  await page.getByRole('button', { name: 'Next response' }).click();
  await expect(page.getByText('Second generated answer.')).toBeVisible();
  await expect(page.getByText('2/2')).toBeVisible();
});
