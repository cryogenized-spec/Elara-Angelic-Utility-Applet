import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('YouTube policy consent is explicit, accessible, served locally and durable', async ({ page, request }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('elara.onboarding.completed', 'true');
  });
  await page.goto('');

  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();

  const policy = page.getByLabel('YouTube privacy and terms');
  await expect(policy).toBeVisible();

  const checkbox = page.getByLabel('Agree to Elara YouTube privacy and terms');
  const enable = page.getByRole('button', { name: 'Enable YouTube features' });
  await expect(checkbox).not.toBeChecked();
  await expect(enable).toBeDisabled();

  const privacyHref = await policy.getByRole('link', { name: 'Elara Privacy Notice' }).getAttribute('href');
  const termsHref = await policy.getByRole('link', { name: 'Elara Terms of Use' }).getAttribute('href');
  expect(privacyHref).toBeTruthy();
  expect(termsHref).toBeTruthy();

  const privacyResponse = await request.get(new URL(privacyHref!, page.url()).toString());
  expect(privacyResponse.ok()).toBe(true);
  expect(await privacyResponse.text()).toContain('Elara Privacy Notice');
  const termsResponse = await request.get(new URL(termsHref!, page.url()).toString());
  expect(termsResponse.ok()).toBe(true);
  expect(await termsResponse.text()).toContain('Elara Terms of Use');

  await expect(policy.locator('a[href="https://www.youtube.com/t/terms"]')).toHaveCount(1);
  await expect(policy.locator('a[href="https://policies.google.com/privacy"]')).toHaveCount(1);

  await checkbox.check();
  await expect(enable).toBeEnabled();
  await enable.click();
  await expect(policy.getByRole('status')).toContainText('Accepted · policy version');

  await page.reload();
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await expect(page.getByLabel('YouTube privacy and terms').getByRole('status')).toContainText('Accepted · policy version');
  await expect(page.getByLabel('Agree to Elara YouTube privacy and terms')).toHaveCount(0);
});
