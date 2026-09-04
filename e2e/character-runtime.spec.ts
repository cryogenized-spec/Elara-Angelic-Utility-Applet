import { expect, test } from '@playwright/test';

test('transmits the saved master persona protocol as the active runtime instruction', async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/gemini', async (route) => {
    const payload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    requests.push(payload);
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        `event: interaction.created\ndata: ${JSON.stringify({ event_type: 'interaction.created', interaction: { id: 'persona-runtime-test', status: 'in_progress', model: 'gemini-3.7-flash' } })}\n\n`,
        `event: step.delta\ndata: ${JSON.stringify({ event_type: 'step.delta', interaction_id: 'persona-runtime-test', index: 0, delta: { type: 'text', text: 'Runtime persona received.' } })}\n\n`,
        `event: interaction.completed\ndata: ${JSON.stringify({ event_type: 'interaction.completed', interaction: { id: 'persona-runtime-test', status: 'completed' } })}\n\n`,
      ].join(''),
    });
  });

  await page.goto('');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Character' }).click();

  const persona = [
    'PERSONA PROTOCOL: ELARA',
    'You are Elara, a synthetic cybernetic consort.',
    'Default to being in character.',
    'Roleplay at all times as Elara.',
  ].join('\n');
  await page.getByLabel('Master system prompt').fill(persona);
  await page.getByRole('button', { name: 'Back to chat' }).click();

  const composer = page.getByRole('textbox', { name: 'Message Elara' });
  await composer.fill('Hello, Elara.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Runtime persona received.')).toBeVisible();

  const instruction = requests[0]?.systemInstruction;
  expect(typeof instruction).toBe('string');
  expect(instruction).toEqual(expect.stringContaining('PERSONA PROTOCOL: ELARA'));
  expect(instruction).toEqual(expect.stringContaining('Default to being in character.'));
  expect(instruction).toEqual(expect.stringContaining('CHARACTER EXECUTION DIRECTIVE'));
  expect(instruction).toEqual(expect.stringContaining('active runtime behavior'));
});
