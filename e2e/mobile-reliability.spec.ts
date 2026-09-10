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

  test('keeps the consolidated Workspace trigger usable and opens services to its right', async ({ page }) => {
    await page.goto('');

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const trigger = page.getByRole('button', { name: 'Workspace', exact: true });
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(triggerBox!.height).toBeGreaterThanOrEqual(44);

    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Google Workspace services' });
    await expect(menu).toBeVisible();
    for (const name of ['Calendar', 'Tasks', 'Gmail']) {
      await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
    }
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    // Flyout opens to the right of the trigger and stays inside the viewport.
    expect(menuBox!.x).toBeGreaterThanOrEqual(triggerBox!.x + triggerBox!.width);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport!.width);
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
    const menu = page.getByRole('menu', { name: 'Google Workspace services' });

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
    const menu = page.getByRole('menu', { name: 'Google Workspace services' });
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
