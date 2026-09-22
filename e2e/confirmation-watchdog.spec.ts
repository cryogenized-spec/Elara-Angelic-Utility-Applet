import { expect, test, type Page } from '@playwright/test';

const BROKER_MODULE = '/Elara-Angelic-Utility-Applet/src/google/confirmation/broker.ts';

async function mountConfirmation(page: Page, request: Record<string, unknown>) {
  await page.evaluate(async ({ moduleUrl, requestValue }) => {
    const broker = await import(moduleUrl) as {
      requestGoogleToolConfirmations: (requests: readonly Record<string, unknown>[]) => Promise<boolean[]>;
    };
    void broker.requestGoogleToolConfirmations([requestValue]);
  }, { moduleUrl: BROKER_MODULE, requestValue: request });
  const dialog = page.locator('#elara-google-confirmation');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'android-portrait', 'Canonical watchdog geometry is certified on the Android portrait project.');
  await page.goto('');
});

test('expanded review stays inside the Android viewport with decisions reachable', async ({ page }) => {
  const body = [
    'Release review — inspect all content before approval.',
    ...Array.from({ length: 100 }, (_, index) => `Line ${String(index + 1).padStart(3, '0')}: deterministic long confirmation content.`),
  ].join('\n');

  const dialog = await mountConfirmation(page, {
    tool: 'memory.save',
    risk: 'write',
    resourceSummary: 'Save durable memory “Release review”. Review the full proposed body below before approving.',
    reviewText: body,
    requestedAt: new Date().toISOString(),
  });

  await expect(dialog).toHaveClass(/roleplay-confirmation--expanded/);
  await expect(dialog.getByRole('button', { name: '✕ Decline' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '✓ Approve' })).toBeVisible();

  const geometry = await dialog.evaluate((host) => {
    const box = host.getBoundingClientRect();
    const actions = host.querySelector('.roleplay-confirmation__actions')?.getBoundingClientRect();
    const review = host.querySelector<HTMLElement>('.google-confirmation-item__review-text');
    const actionsTopBefore = actions?.top ?? 0;
    if (review) review.scrollTop = review.scrollHeight;
    const actionsAfter = host.querySelector('.roleplay-confirmation__actions')?.getBoundingClientRect();
    return {
      viewportHeight: globalThis.innerHeight,
      top: box.top,
      bottom: box.bottom,
      actionsTopBefore,
      actionsTopAfter: actionsAfter?.top ?? 0,
      actionsBottom: actionsAfter?.bottom ?? 0,
      reviewClientHeight: review?.clientHeight ?? 0,
      reviewScrollHeight: review?.scrollHeight ?? 0,
    };
  });

  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.actionsBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(Math.abs(geometry.actionsTopAfter - geometry.actionsTopBefore)).toBeLessThan(1);
  expect(geometry.reviewScrollHeight).toBeGreaterThan(geometry.reviewClientHeight);
  await expect(dialog.locator('.google-confirmation-item__review-text')).toHaveText(body);

  await dialog.getByRole('button', { name: '✕ Decline' }).click();
  await expect(dialog).toHaveCount(0);
});

test('attachment review renders hostile markup literally and hides implementation bindings', async ({ page }) => {
  const hostile = [
    'Repair complete. Pressure holding.',
    '<img src=x onerror="globalThis.__watchdogProbe = true">',
    '<script>globalThis.__watchdogProbe = true</script>',
    ...Array.from({ length: 40 }, (_, index) => `Inspection line ${index + 1}: approved preview content.`),
  ].join('\n');

  const dialog = await mountConfirmation(page, {
    tool: 'clickup.attachArtifact',
    risk: 'write',
    resourceSummary: 'Attach the approved file below to ClickUp task 86task.',
    attachmentReview: {
      name: 'repair-notes.txt',
      uploadName: 'repair-notes-final.txt',
      mimeType: 'text/plain',
      sizeBytes: 2_048,
      previewText: hostile,
      previewTruncated: true,
    },
    requestedAt: new Date().toISOString(),
  });

  await expect(dialog).toContainText('ClickUp');
  await expect(dialog).toContainText('Attach file');
  await expect(dialog).toContainText('repair-notes.txt');
  await expect(dialog).toContainText('2.0 KB');
  await expect(dialog).toContainText('Upload as “repair-notes-final.txt”');
  await expect(dialog).toContainText('<img src=x onerror=');
  await expect(dialog).toContainText('Preview shortened');
  await expect(dialog).not.toContainText('clickup.attachArtifact');
  await expect(dialog).not.toContainText('SHA-256');
  await expect(dialog.locator('script')).toHaveCount(0);
  await expect(dialog.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __watchdogProbe?: boolean }).__watchdogProbe === true)).toBe(false);

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? -1)).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(915);

  await dialog.getByRole('button', { name: '✕ Decline' }).click();
});
