import { expect, test } from '@playwright/test';

async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
}

test.describe('Android portrait reliability', () => {
  test('keeps the primary shell inside the viewport and preserves the composer', async ({ page }) => {
    await page.goto('');

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    const shell = page.locator('.app-shell');
    const composer = page.getByRole('textbox', { name: 'Message Elara' });
    const rail = page.getByRole('navigation', { name: 'Quick actions' });

    await expect(shell).toBeVisible();
    await expect(composer).toBeVisible();
    await expect(rail).toBeVisible();

    const shellBox = await shell.boundingBox();
    const composerBox = await composer.boundingBox();
    const railBox = await rail.boundingBox();
    expect(shellBox && composerBox && railBox).toBeTruthy();
    expect(shellBox!.x).toBeGreaterThanOrEqual(0);
    expect(shellBox!.x + shellBox!.width).toBeLessThanOrEqual(viewport!.width);
    expect(composerBox!.x + composerBox!.width).toBeLessThanOrEqual(viewport!.width);
    expect(railBox!.x + railBox!.width).toBeLessThanOrEqual(viewport!.width);
  });

  test('keeps a single Workspace trigger usable and opens services to its right', async ({ page }) => {
    await page.goto('');

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const rail = page.getByRole('navigation', { name: 'Quick actions' });
    // Default state: exactly one Workspace button, no per-service pills.
    await expect(rail.getByRole('button')).toHaveCount(1);
    const trigger = rail.getByRole('button', { name: 'Workspace', exact: true });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    for (const name of ['Calendar', 'Tasks', 'Gmail']) {
      await expect(rail.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(triggerBox!.height).toBeGreaterThanOrEqual(44);

    await trigger.click();
    const menu = page.getByRole('group', { name: 'Google Workspace services' });
    await expect(menu).toBeVisible();
    for (const name of ['Calendar', 'Tasks', 'Gmail']) {
      await expect(menu.getByRole('button', { name, exact: true })).toBeVisible();
    }
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    // Flyout opens to the right of the trigger and stays inside the viewport.
    expect(menuBox!.x).toBeGreaterThanOrEqual(triggerBox!.x + triggerBox!.width);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport!.width);
  });

  test('keeps the Workspace flyout inside narrow portrait widths', async ({ page }) => {
    await page.goto('');
    for (const width of [412, 390, 360]) {
      await page.setViewportSize({ width, height: 800 });
      const trigger = page.getByRole('button', { name: 'Workspace', exact: true });
      await expect(trigger).toBeVisible();
      await trigger.click();

      const menu = page.getByRole('group', { name: 'Google Workspace services' });
      await expect(menu).toBeVisible();
      const menuBox = await menu.boundingBox();
      const triggerBox = await trigger.boundingBox();
      expect(menuBox && triggerBox).toBeTruthy();
      expect(menuBox!.x).toBeGreaterThanOrEqual(0);
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(width);
      // Services stay readable/tappable at every width.
      const row = menu.getByRole('button', { name: 'Calendar', exact: true });
      const rowBox = await row.boundingBox();
      expect(rowBox!.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    }
  });

  test('opens and closes the sidebar without losing the composer position', async ({ page }) => {
    await page.goto('');
    const composer = page.getByRole('textbox', { name: 'Message Elara' });

    await page.getByRole('button', { name: 'Open sidebar' }).click();
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toHaveClass(/is-open/);
    await expect(composer).toBeVisible();

    await sidebar.getByRole('button', { name: 'Close sidebar' }).click();
    await expect(sidebar).not.toHaveClass(/is-open/);
    await expect(composer).toBeVisible();
  });

  test('persists presentation and chat typography settings across reload', async ({ page }) => {
    await page.goto('');
    await openSettings(page);

    await page.getByRole('button', { name: 'Typography' }).click();
    const chatTextSize = page.getByRole('slider', { name: 'Chat text size' });
    await expect(chatTextSize).toBeVisible();
    await chatTextSize.fill('21');

    await page.getByRole('radio', { name: /Manrope/ }).click();
    await page.getByRole('button', { name: 'Appearance' }).click();
    const portraitScale = page.getByRole('slider', { name: 'Character presentation scale' });
    await portraitScale.fill('3');
    await page.getByRole('radio', { name: /^Rose/ }).click();

    await page.getByRole('button', { name: 'Back to chat' }).click();
    await expect(page.locator('.app-shell')).toHaveCSS('font-family', /Manrope/);

    await page.reload();
    await expect(page.locator('.app-shell')).toHaveCSS('font-family', /Manrope/);
    await openSettings(page);
    await page.getByRole('button', { name: 'Typography' }).click();
    await expect(page.getByRole('slider', { name: 'Chat text size' })).toHaveValue('21');
    await page.getByRole('button', { name: 'Appearance' }).click();
    await expect(page.getByRole('slider', { name: 'Character presentation scale' })).toHaveValue('3');
    await expect(page.getByRole('radio', { name: /^Rose/ })).toHaveAttribute('aria-checked', 'true');
  });

  test('keeps Settings navigation recoverable on a narrow portrait viewport', async ({ page }) => {
    await page.goto('');
    await openSettings(page);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Lockbox' }).click();
    await expect(page.getByRole('heading', { name: 'Gemini API' })).toBeVisible();
    await expect(page.getByText(/The API key is encrypted locally in Dexie/)).toBeVisible();
    await page.getByRole('button', { name: 'Typography' }).click();
    await expect(page.getByText('The quick brown fox jumps over the lazy dog.').first()).toBeVisible();
    await page.getByRole('button', { name: 'Back to chat' }).click();
    await expect(page.getByRole('textbox', { name: 'Message Elara' })).toBeVisible();
  });

  test('does not animate essential controls when reduced motion is requested', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('');
    const trigger = page.getByRole('button', { name: 'Workspace', exact: true });
    const menu = page.getByRole('group', { name: 'Google Workspace services' });

    const transition = await trigger.evaluate((element) => getComputedStyle(element).transitionDuration);
    const durations = transition.split(',').map((value) => Number.parseFloat(value));
    expect(durations.every((duration) => duration <= 0.001)).toBe(true);

    await trigger.click();
    await expect(menu).toBeVisible();
  });

  test('keeps the command rail reachable after keyboard navigation', async ({ page }) => {
    await page.goto('');
    const rail = page.getByRole('navigation', { name: 'Quick actions' });
    const trigger = rail.getByRole('button', { name: 'Workspace', exact: true });
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('group', { name: 'Google Workspace services' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
  });
});
test.describe('Portrait artwork layout', () => {
  test('places the Workspace tool cluster in the left opening, clear of the spine, at phone and narrow widths', async ({ page }) => {
    await page.goto('');
    await openSettings(page);
    await page.getByRole('button', { name: 'Character' }).click();
    await page.getByRole('radio', { name: /Portrait · 4:5/ }).click();
    await page.getByRole('button', { name: 'Back to chat' }).click();
    await expect(page.locator('.artwork-mode-portrait')).toBeVisible();

    for (const width of [412, 360, 320]) {
      await page.setViewportSize({ width, height: 800 });
      const rail = page.getByRole('navigation', { name: 'Quick actions' });
      const spine = page.getByRole('button', { name: 'Open sidebar' });
      const trigger = rail.getByRole('button', { name: 'Workspace', exact: true });
      await expect(trigger).toBeVisible();
      const railBox = await rail.boundingBox();
      const spineBox = await spine.boundingBox();
      const triggerBox = await trigger.boundingBox();
      expect(railBox && spineBox && triggerBox).toBeTruthy();
      // Left-anchored: starts to the right of the spine button, and its right
      // edge leaves free space (it is not pushed against the right edge).
      expect(triggerBox!.x).toBeGreaterThanOrEqual(spineBox!.x + spineBox!.width);
      expect(triggerBox!.x).toBeLessThan(width / 3);
      expect(triggerBox!.x + triggerBox!.width).toBeLessThan(width - 24);
      expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(width);
    }
  });
});

test.describe('Composer geometry and resume reconciliation', () => {
  test('keeps rail controls bottom-anchored as the editor grows', async ({ page }) => {
    await page.goto('');
    const editor = page.getByRole('textbox', { name: 'Message Elara' });
    const send = page.getByRole('button', { name: 'Send message' });
    const attach = page.getByRole('button', { name: 'Composer tools' });
    const mic = page.getByRole('button', { name: 'VTT voice input' });
    const wrap = page.locator('.composer__input-wrap');
    const expand = page.getByRole('button', { name: 'Expand message editor' });
    await expect(editor).toBeVisible();

    const bottomOf = (box: { y: number; height: number }) => box.y + box.height;
    const sendBefore = (await send.boundingBox())!;
    const attachBefore = (await attach.boundingBox())!;
    const micBefore = (await mic.boundingBox())!;
    const editorBefore = (await editor.boundingBox())!;
    const wrapBefore = (await wrap.boundingBox())!;
    const expandBefore = (await expand.boundingBox())!;
    expect(sendBefore && attachBefore && micBefore && editorBefore && wrapBefore && expandBefore).toBeTruthy();
    const expandGapBefore = bottomOf(wrapBefore) - bottomOf(expandBefore);

    await editor.fill('one\ntwo\nthree\nfour\nfive\nsix');
    await expect.poll(async () => (await editor.boundingBox())?.height ?? 0).toBeGreaterThan(editorBefore.height + 20);

    // The row grows upward; the rail controls do not float with the text.
    const sendAfter = (await send.boundingBox())!;
    const attachAfter = (await attach.boundingBox())!;
    const micAfter = (await mic.boundingBox())!;
    expect(Math.abs(bottomOf(sendAfter) - bottomOf(sendBefore))).toBeLessThan(2);
    expect(Math.abs(bottomOf(attachAfter) - bottomOf(attachBefore))).toBeLessThan(2);
    expect(Math.abs(bottomOf(micAfter) - bottomOf(micBefore))).toBeLessThan(2);

    // The expand control stays bottom-anchored inside the growing editor.
    const wrapAfter = (await wrap.boundingBox())!;
    const expandAfter = (await expand.boundingBox())!;
    const expandGapAfter = bottomOf(wrapAfter) - bottomOf(expandAfter);
    expect(Math.abs(expandGapAfter - expandGapBefore)).toBeLessThan(3);
  });

  test('suppresses the platform tap highlight on the send control', async ({ page }) => {
    await page.goto('');
    const send = page.getByRole('button', { name: 'Send message' });
    await expect(send).toBeVisible();
    const highlight = await send.evaluate(
      (element) => (getComputedStyle(element) as unknown as { webkitTapHighlightColor?: string }).webkitTapHighlightColor,
    );
    expect(highlight).toBe('rgba(0, 0, 0, 0)');
  });

  test('reconciles viewport metrics on app resume signals', async ({ page }) => {
    await page.goto('');
    const composer = page.getByRole('textbox', { name: 'Message Elara' });
    await expect(composer).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
      window.dispatchEvent(new Event('focus'));
    });
    await expect(composer).toBeVisible();
    const viewportVar = await page.evaluate(() => document.documentElement.style.getPropertyValue('--elara-visual-viewport-height'));
    expect(viewportVar).toMatch(/^\d+px$/);
  });
});
