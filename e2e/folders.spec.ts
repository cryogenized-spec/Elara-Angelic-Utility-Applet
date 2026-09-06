import { expect, test } from '@playwright/test';

async function openSidebar(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await expect(page.getByRole('complementary', { name: 'Chat threads' })).toBeVisible();
}

function folderNode(page: import('@playwright/test').Page, name: string) {
  return page.locator('.folder-row__name').filter({ hasText: new RegExp(`^${name}$`) }).first()
    .locator('xpath=ancestor::details[contains(@class,"folder-node")][1]');
}

test('folder workspace supports nested creation and moving chats by drag and drop', async ({ page }) => {
  await page.goto('');
  await openSidebar(page);

  const createFolder = page.getByRole('button', { name: 'Create folder' });
  await expect(createFolder).toBeEnabled();
  await createFolder.click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Projects/Elara');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  const projects = folderNode(page, 'Projects');
  await expect(projects.locator('.folder-row__name').first()).toHaveText('Projects');
  await expect(page.locator('.folder-row__name').filter({ hasText: /^Elara$/ }).first()).toBeVisible();

  const thread = page.locator('.thread-row').filter({ hasText: 'New conversation' }).first();
  const elara = page.locator('.folder-row__name').filter({ hasText: /^Elara$/ }).first();
  await expect(thread).toBeVisible();
  await expect(elara).toBeVisible();
  await thread.dragTo(elara);

  const elaraFolder = folderNode(page, 'Elara');
  const threadActions = elaraFolder.locator('details.thread-menu > summary');
  await expect(threadActions).toHaveAttribute('aria-label', 'Thread actions for New conversation');
  await threadActions.click({ force: true });
  const moveSelect = page.getByRole('combobox', { name: 'Move New conversation to folder', exact: true });
  await expect(moveSelect).not.toHaveValue('');
  await expect(elaraFolder.locator('.folder-row__count')).toHaveText('1');
});

test('folder actions expose rename, move, memory scope, and deletion controls', async ({ page }) => {
  await page.goto('');
  await openSidebar(page);

  const createFolder = page.getByRole('button', { name: 'Create folder' });
  await expect(createFolder).toBeEnabled();
  await createFolder.click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Workspace');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  const folderPath = 'Workspace';
  const folder = folderNode(page, folderPath);
  await expect(folder).toBeVisible();
  const folderActions = folder.locator('details.folder-menu > summary');
  await expect(folderActions).toHaveAttribute('aria-label', `Folder actions for ${folderPath}`);
  await folderActions.click({ force: true });
  await expect(folder.getByRole('button', { name: 'Rename' })).toBeVisible();
  await expect(folder.getByRole('combobox', { name: `Move folder ${folderPath}` })).toBeVisible();
  await expect(folder.getByRole('combobox', { name: `Memory scope for ${folderPath}` })).toBeVisible();
  await expect(folder.getByRole('button', { name: 'Delete folder' })).toBeVisible();
});
