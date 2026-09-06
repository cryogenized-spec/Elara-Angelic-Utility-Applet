import { expect, test } from '@playwright/test';

async function openLockbox(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
}

test('fresh Lockbox uses the numeric PIN setup and permits focused PIN entry', async ({ page }) => {
  await page.goto('');
  await openLockbox(page);

  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: empty' })).toBeVisible();
  const pin = page.getByRole('textbox', { name: 'Lockbox PIN', exact: true });
  const confirm = page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true });

  await expect(pin).toHaveAttribute('type', 'password');
  await expect(pin).toHaveAttribute('inputmode', 'numeric');
  await expect(pin).toHaveAttribute('autocomplete', 'new-password');
  await expect(pin).toHaveAttribute('maxlength', '8');
  await expect(confirm).toHaveAttribute('inputmode', 'numeric');
  await expect(confirm).toHaveAttribute('maxlength', '8');
  await pin.focus();
  await expect(pin).toBeFocused();
});

test('PIN Lockbox locks the session, keeps the numeric unlock path, and does not expose passkey when unsupported', async ({ page }) => {
  await page.goto('');
  await openLockbox(page);

  await page.getByLabel('Gemini API key').fill('e2e-' + 'pin-lockbox-key');
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();

  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: locked' })).toBeVisible();

  const unlockPin = page.getByRole('textbox', { name: 'Lockbox PIN', exact: true });
  await expect(unlockPin).toBeVisible();
  await expect(unlockPin).toHaveAttribute('type', 'password');
  await expect(unlockPin).toHaveAttribute('inputmode', 'numeric');
  await expect(unlockPin).toHaveAttribute('maxlength', '8');
  await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unlock with Passkey' })).toHaveCount(0);
  await expect(unlockPin).toBeFocused();

  await unlockPin.fill('284619');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();
});
