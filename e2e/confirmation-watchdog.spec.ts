import { expect, test, type Page } from '@playwright/test';

const HOSTILE_BODY = "Release review — inspect all content before approval.\\n<img src=x onerror=\"globalThis.__watchdogProbe = true\">\\n<script>globalThis.__watchdogProbe = true</script>\\nLine 001: deterministic long confirmation content.\\nLine 002: deterministic long confirmation content.\\nLine 003: deterministic long confirmation content.\\nLine 004: deterministic long confirmation content.\\nLine 005: deterministic long confirmation content.\\nLine 006: deterministic long confirmation content.\\nLine 007: deterministic long confirmation content.\\nLine 008: deterministic long confirmation content.\\nLine 009: deterministic long confirmation content.\\nLine 010: deterministic long confirmation content.\\nLine 011: deterministic long confirmation content.\\nLine 012: deterministic long confirmation content.\\nLine 013: deterministic long confirmation content.\\nLine 014: deterministic long confirmation content.\\nLine 015: deterministic long confirmation content.\\nLine 016: deterministic long confirmation content.\\nLine 017: deterministic long confirmation content.\\nLine 018: deterministic long confirmation content.\\nLine 019: deterministic long confirmation content.\\nLine 020: deterministic long confirmation content.\\nLine 021: deterministic long confirmation content.\\nLine 022: deterministic long confirmation content.\\nLine 023: deterministic long confirmation content.\\nLine 024: deterministic long confirmation content.\\nLine 025: deterministic long confirmation content.\\nLine 026: deterministic long confirmation content.\\nLine 027: deterministic long confirmation content.\\nLine 028: deterministic long confirmation content.\\nLine 029: deterministic long confirmation content.\\nLine 030: deterministic long confirmation content.\\nLine 031: deterministic long confirmation content.\\nLine 032: deterministic long confirmation content.\\nLine 033: deterministic long confirmation content.\\nLine 034: deterministic long confirmation content.\\nLine 035: deterministic long confirmation content.\\nLine 036: deterministic long confirmation content.\\nLine 037: deterministic long confirmation content.\\nLine 038: deterministic long confirmation content.\\nLine 039: deterministic long confirmation content.\\nLine 040: deterministic long confirmation content.\\nLine 041: deterministic long confirmation content.\\nLine 042: deterministic long confirmation content.\\nLine 043: deterministic long confirmation content.\\nLine 044: deterministic long confirmation content.\\nLine 045: deterministic long confirmation content.\\nLine 046: deterministic long confirmation content.\\nLine 047: deterministic long confirmation content.\\nLine 048: deterministic long confirmation content.";

function sseTurn(interactionId: string, body: readonly string[], terminal: 'requires_action' | 'completed' = 'completed'): string {
  const created = `event: interaction.created\ndata: ${JSON.stringify({
    event_type: 'interaction.created',
    interaction: { id: interactionId, status: 'in_progress', model: 'gemini-3.8-flash' },
  })}\n\n`;
  const usage_metadata = {
    prompt_token_count: 4_000,
    candidates_token_count: 200,
    total_token_count: 4_200,
  };
  const end = terminal === 'completed'
    ? `event: interaction.completed\ndata: ${JSON.stringify({
      event_type: 'interaction.completed',
      interaction: { id: interactionId, status: 'completed', usage_metadata },
    })}\n\n`
    : `event: interaction.requires_action\ndata: ${JSON.stringify({
      event_type: 'interaction.requires_action',
      interaction: { id: interactionId, status: 'requires_action', usage_metadata },
    })}\n\n`;
  return created + body.join('') + end;
}

function toolCallStep(id: string, name: string, args: Record<string, unknown>): string {
  return [
    `event: step.start\ndata: ${JSON.stringify({
      event_type: 'step.start',
      index: 0,
      step: { index: 0, type: 'function_call', id, name, arguments: args },
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

async function unlockTestGemini(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill('e2e-confirmation-watchdog-key');
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('2468135790');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('2468135790');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message Elara' }).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

test('long memory approval stays inside Android viewport and hostile markup remains inert text', async ({ page }) => {
  await page.route('**/v1/interactions*', async (route) => {
    const payload = JSON.parse(route.request().postData() ?? '{}') as { input?: unknown };
    const hasMemoryResult = Array.isArray(payload.input)
      && (payload.input as Array<{ type?: string; name?: string }>).some(
        (entry) => entry?.type === 'function_result' && entry.name === 'memory.save',
      );
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: hasMemoryResult
        ? sseTurn('watchdog-done', [textStep('The proposed memory was not saved.')])
        : sseTurn('watchdog-write', [toolCallStep('watchdog-save-1', 'memory.save', {
          title: 'Release review',
          body: HOSTILE_BODY,
        })], 'requires_action'),
    });
  });

  await page.goto('');
  await unlockTestGemini(page);
  await ask(page, 'Please remember this exact release review note for me.');

  const dialog = page.getByRole('dialog', { name: 'Elara action confirmation' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/roleplay-confirmation--expanded/);
  await expect(dialog).toContainText('Memory');
  await expect(dialog).toContainText('Remember this');
  await expect(dialog).not.toContainText('memory.save');
  await expect(dialog.getByRole('button', { name: '✕ Decline' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '✓ Approve' })).toBeVisible();

  const review = dialog.locator('.google-confirmation-item__review-text');
  await expect(review).toHaveText(HOSTILE_BODY);
  await expect(dialog).toContainText('<img src=x onerror=');
  await expect(dialog.locator('script')).toHaveCount(0);
  await expect(dialog.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __watchdogProbe?: boolean }).__watchdogProbe === true)).toBe(false);

  const geometry = await dialog.evaluate((host) => {
    const box = host.getBoundingClientRect();
    const actions = host.querySelector('.roleplay-confirmation__actions')?.getBoundingClientRect();
    const reviewText = host.querySelector<HTMLElement>('.google-confirmation-item__review-text');
    const actionsTopBefore = actions?.top ?? 0;
    if (reviewText) reviewText.scrollTop = reviewText.scrollHeight;
    const actionsAfter = host.querySelector('.roleplay-confirmation__actions')?.getBoundingClientRect();
    return {
      viewportHeight: globalThis.innerHeight,
      top: box.top,
      bottom: box.bottom,
      actionsTopBefore,
      actionsTopAfter: actionsAfter?.top ?? 0,
      actionsBottom: actionsAfter?.bottom ?? 0,
      reviewClientHeight: reviewText?.clientHeight ?? 0,
      reviewScrollHeight: reviewText?.scrollHeight ?? 0,
      reviewOverflowY: reviewText ? globalThis.getComputedStyle(reviewText).overflowY : '',
      reviewUnicodeBidi: reviewText ? globalThis.getComputedStyle(reviewText).unicodeBidi : '',
    };
  });

  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.actionsBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(Math.abs(geometry.actionsTopAfter - geometry.actionsTopBefore)).toBeLessThan(1);
  expect(geometry.reviewClientHeight).toBeGreaterThan(0);
  expect(geometry.reviewScrollHeight).toBeGreaterThanOrEqual(geometry.reviewClientHeight);
  expect(geometry.reviewOverflowY).toBe('auto');
  expect(geometry.reviewUnicodeBidi).toBe('plaintext');

  await dialog.getByRole('button', { name: '✕ Decline' }).click();
  await expect(dialog).toHaveCount(0);
});
