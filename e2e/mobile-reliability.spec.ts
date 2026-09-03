import { expect, test } from '@playwright/test';

test.describe('Android portrait reliability', () => {
  test('keeps the primary shell inside the viewport and preserves the composer', async ({ page }) => {
    await page.goto('');

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    const shell = page.locator('.app-shell');
    const composer = page.getByRole('textbox', { name: 'Message Elara' });
    const rail = page.getByRole('region', { name: 'Workspace quick actions' });

    await expect(shell).toBeVisible();
    await expect(composer).toBeVisible();
    await expect(rail).toBeVisible();

    const shellBox = await shell.boundingBox();
    const composerBox = await composer.boundingBox();
    const railBox = await rail.boundingBox();
    expect(shellBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(railBox).not.toBeNull();

    expect(shellBox!.x).toBeGreaterThanOrEqual(0);
    expect(shellBox!.x + shellBox!.width).toBeLessThanOrEqual(viewport!.width);
    expect(composerBox!.x + composerBox!.width).toBeLessThanOrEqual(viewport!.width);
    expect(railBox!.x + railBox!.width).toBeLessThanOrEqual(viewport!.width);
  });

  test('keeps touch targets usable and the Workspace rail horizontally scrollable', async ({ page }) => {
    await page.goto('');

    for (const name of ['Calendar', 'Tasks', 'Gmail']) {
      const button = page.getByRole('button', { name, exact: true });
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    const track = page.locator('.tool-rail__track');
    const metrics = await track.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(metrics.scrollWidth).toBeGreaterThanOrEqual(metrics.clientWidth);
  });

  test('opens and closes the sidebar without losing the composer position', async ({ page }) => {
    await page.goto('');
    const composer = page.getByRole('textbox', { name: 'Message Elara' });

    await page.getByRole('button', { name: 'Open sidebar' }).click();
    const sidebar = page.getByRole('complementary', { name: 'Chat threads' });
    await expect(sidebar).toHaveClass(/is-open/);
    await expect(composer).toBeVisible();

    await sidebar.getByRole('button', { name: 'Close sidebar' }).click();
    await expect(sidebar).not.toHaveClass(/is-open/);
    await expect(composer).toBeVisible();
  });

  test('keeps Settings navigation recoverable on a narrow portrait viewport', async ({ page }) => {
    await page.goto('');
    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Typography' }).click();
    await expect(page.getByText('The quick brown fox jumps over the lazy dog.').first()).toBeVisible();
    await page.getByRole('button', { name: 'Back to chat' }).click();
    await expect(page.getByRole('heading', { name: 'Elara' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message Elara' })).toBeVisible();
  });

  test('does not animate essential controls when reduced motion is requested', async ({ page }) => {
    await page.goto('');
    const calendar = page.getByRole('button', { name: 'Calendar', exact: true });
    const surface = page.getByRole('region', { name: 'Calendar action surface' });

    const transition = await calendar.evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(transition).toMatch(/^0s|0(?:\.0+)?s$/);

    await calendar.click();
    await expect(surface).toBeVisible();
    const animation = await surface.evaluate((element) => getComputedStyle(element).animationName);
    expect(animation === 'none' || animation === 'quick-action-surface-in').toBeTruthy();
  });
});
