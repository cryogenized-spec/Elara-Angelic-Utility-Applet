import { expect, test } from '@playwright/test';

function sse(interactionId: string, text: string): string {
  return [
    `event: interaction.created\ndata: ${JSON.stringify({ event_type: 'interaction.created', interaction: { id: interactionId, status: 'in_progress', model: 'gemini-3.8-flash' } })}`,
    `event: step.delta\ndata: ${JSON.stringify({ event_type: 'step.delta', interaction_id: interactionId, index: 0, delta: { type: 'text', text } })}`,
    `event: interaction.completed\ndata: ${JSON.stringify({ event_type: 'interaction.completed', interaction: { id: interactionId, status: 'completed' } })}`,
  ].join('\n\n') + '\n\n';
}

async function unlockTestGemini(page) {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill('e2e-test-api-key');
  await page.getByRole('textbox', { name: 'Lockbox password', exact: true }).fill('e2e-test-password');
  await page.getByLabel('Confirm Lockbox password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

test('normalizes a direct Gemini network failure without fabricating a response', async ({ page }) => {
  test.setTimeout(15_000);
  await page.goto('');
  await unlockTestGemini(page);
  await page.route('**/v1beta/interactions*', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Provider unavailable.' }) });
  });
  const composer = page.getByRole('textbox', { name: 'Message Elara' });
  await composer.fill('Verify the live runtime boundary');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('[GEMINI_PROVIDER]', { timeout: 12_000 });
  await expect(page.getByText('Verify the live runtime boundary')).toBeVisible();
});
