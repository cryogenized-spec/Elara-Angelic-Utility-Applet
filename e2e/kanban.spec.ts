import { expect, test, type Page } from "@playwright/test";

type FixtureTask = { id: string; title: string; notes?: string; due?: string | null; status: string; etag: string; position: string };

async function seedWorkspace(page: Page, existing = false) {
  const lists = [{ id: 'studio', title: 'Studio projects' }, { id: 'personal', title: 'Personal' }, { id: 'reading', title: 'Reading list' }, { id: 'later', title: 'Someday' }];
  const tasks: FixtureTask[] = [{ id: 'review', title: 'Review the launch proposal', notes: 'Read the source email and confirm the next steps.', due: '2020-01-01T00:00:00Z', status: 'needsAction', etag: 'one', position: '0001' }, ...Array.from({ length: 8 }, (_, index) => ({ id: `task-${index}`, title: `Project milestone ${index + 1}`, status: 'needsAction', etag: 'one', position: `000${index + 2}` }))];
  await page.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ contentType: 'text/javascript', body: `window.google = { accounts: { oauth2: { initTokenClient: (config) => ({ requestAccessToken: () => config.callback({ access_token: "kanban-test-token", expires_in: 3600, scope: config.scope }) }), revoke: (_token, callback) => callback({}) } } };` }));
  await page.route('https://www.googleapis.com/oauth2/v2/userinfo*', (route) => route.fulfill({ json: { email: 'test@example.com', name: 'Kanban Test' } }));
  await page.route('https://tasks.googleapis.com/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname; const method = request.method();
    const body = request.postData() ? request.postDataJSON() as Partial<FixtureTask> : {};
    let result: unknown;
    if (method === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'access-control-allow-headers': '*' } }); return; }
    if (path.endsWith('/users/@me/lists')) {
      if (method === 'POST') { const list = { id: crypto.randomUUID(), title: body.title ?? '' }; lists.push(list); result = list; } else result = { items: lists };
    } else if (path.includes('/users/@me/lists/')) {
      const index = lists.findIndex((list) => path.endsWith('/' + list.id));
      if (method === 'DELETE') { lists.splice(index, 1); await route.fulfill({ status: 204 }); return; }
      Object.assign(lists[index], body); result = lists[index];
    } else if (path.endsWith('/move')) {
      const id = path.split('/').at(-2); const source = tasks.splice(tasks.findIndex((task) => task.id === id), 1)[0];
      const previous = url.searchParams.get('previous');
      tasks.splice(previous ? tasks.findIndex((task) => task.id === previous) + 1 : 0, 0, source);
      tasks.forEach((task, index) => { task.position = String(index).padStart(4, '0'); }); result = source;
    } else if (method === 'DELETE') {
      tasks.splice(tasks.findIndex((task) => path.endsWith('/' + task.id)), 1); await route.fulfill({ status: 204 }); return;
    } else if (method === 'GET' && !path.endsWith('/tasks')) result = tasks.find((task) => path.endsWith('/' + task.id));
    else if (method === 'PATCH') { const task = tasks.find((task) => path.endsWith('/' + task.id)); Object.assign(task!, body); result = task; }
    else if (method === 'POST') { const task: FixtureTask = { id: crypto.randomUUID(), title: body.title ?? '', status: 'needsAction', etag: 'one', position: '9999', ...body }; tasks.push(task); result = task; }
    else result = { items: path.includes('/studio/') ? tasks : [] };
    await route.fulfill({ json: result, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Google', exact: true }).click();
  await page.getByRole('button', { name: /Connect Google account|Refresh Google session/ }).click();
  const service = page.locator('.google-oauth-service').filter({ hasText: 'Google Tasks' });
  if (!existing) {
    await service.getByRole('button', { name: 'Enable read access' }).click();
    await service.getByRole('button', { name: 'Enable writes' }).click();
  }
  await expect(service.getByLabel('Google Tasks base access authorized')).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

test("kanban command palette, Google writes, memo resolution and two-axis canvas", async ({
  page,
}) => {
  await page.goto("");
  await seedWorkspace(page);
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Task orchestration" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Review the launch proposal",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/kanban-desktop.png" });
  const canvas = page.getByLabel(
    "Kanban canvas. Scroll horizontally and vertically to explore lists.",
  );
  expect(
    await canvas.evaluate(
      (element) =>
        element.scrollWidth > element.clientWidth &&
        element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Open workspace command palette" })
    .click();
  await page.getByRole("button", { name: /Create new subroutine/ }).click();
  await page.getByRole("button", { name: "Enable subroutine" }).click();
  await page.getByRole("button", { name: /Internal memo/ }).click();
  await expect(page.locator(".kb-memo-task")).toHaveCount(1);
  await page.getByRole("button", { name: "Close memo" }).click();
  await page
    .getByRole("button", { name: "Complete Review the launch proposal" })
    .click();
  await expect(
    page.getByRole("button", { name: "Reopen Review the launch proposal" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Internal memo/ }).click();
  await expect(page.locator(".kb-memo-task")).toHaveCount(0);
  await page.getByRole("button", { name: "Close memo" }).click();
  await page
    .getByRole("button", { name: "Add task to Studio projects" })
    .click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Reply to the client email");
  await page
    .getByLabel("Notes", { exact: true })
    .fill("https://mail.google.com/mail/u/0/#inbox/example");
  await page.getByRole("button", { name: "Save to Google" }).click();
  await expect(
    page.getByRole("button", {
      name: "Reply to the client email",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await page
    .getByRole("dialog", { name: "Workspace commands" })
    .getByRole("button", { name: /Create new list/ })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("New initiatives");
  await page.getByRole("button", { name: "Save to Google" }).click();
  await expect(
    page.getByRole("heading", { name: "New initiatives", exact: true }),
  ).toBeAttached();
  await page.getByLabel("Search tasks").fill("Reply to the client");
  await expect(page.locator(".kb-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(
    page.getByRole("textbox", { name: "Message Elara" }),
  ).toBeVisible();
});

test("mobile disconnected workspace and accessible modal escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("");
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Connect Google Tasks" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open workspace command palette" })
    .click();
  await expect(
    page.getByRole("button", { name: /Create new task/ }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});


test("list and subroutine lifecycle require explicit destructive confirmation", async ({ page }) => {
  await page.goto(""); await seedWorkspace(page);
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  await page.getByRole("button", { name: "Manage list Personal" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Home projects");
  await page.getByRole("button", { name: "Save to Google" }).click();
  await expect(page.getByRole("heading", { name: "Home projects", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage list Home projects" }).click();
  await page.getByRole("button", { name: "Delete list and tasks" }).click();
  await page.getByLabel("Type the list title to confirm").fill("wrong title");
  await page.getByRole("button", { name: "Confirm removal" }).click();
  await expect(page.getByRole("alert").last()).toContainText("does not match");
  await page.getByLabel("Type the list title to confirm").fill("Home projects");
  await page.getByRole("button", { name: "Confirm removal" }).click();
  await expect(page.getByRole("heading", { name: "Home projects", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Internal memo 0" }).click();
  await page.getByRole("button", { name: "Create subroutine", exact: true }).click();
  await page.getByRole("button", { name: "Enable subroutine" }).click();
  await page.getByRole("button", { name: "Edit subroutine Overdue watch" }).click();
  await page.getByLabel("Subroutine name").fill("Studio overdue");
  await page.getByLabel("Surface after this many days overdue").fill("7");
  await page.getByRole("button", { name: "Save subroutine" }).click();
  await expect(page.locator(".kb-rule")).toContainText("7+ days overdue");
  await page.getByRole("button", { name: "Edit subroutine Studio overdue" }).click();
  await page.getByRole("button", { name: "Remove subroutine", exact: true }).click();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Confirm removal" }).click();
  await expect(page.locator(".kb-rule")).toHaveCount(0);
  await expect(page.locator(".kb-memo-task")).toHaveCount(0);
});

test("reordering uses Google move, supports dragging and disables filtered reordering", async ({ page }) => {
  await page.goto(""); await seedWorkspace(page);
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  const titles = page.locator('.kb-task-title');
  await expect(titles.first()).toHaveText("Review the launch proposal");
  await expect(page.getByRole("button", { name: "Move Review the launch proposal up", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Move Review the launch proposal down", exact: true }).click();
  await expect(titles.first()).toHaveText("Project milestone 1");
  await page.getByRole("button", { name: "Drag Project milestone 2 to reorder among siblings", exact: true }).dragTo(page.locator('.kb-card').first());
  await expect(titles.first()).toHaveText("Project milestone 2");
  await page.getByLabel("Search tasks").fill("milestone");
  await expect(page.getByRole("button", { name: "Move Project milestone 2 down", exact: true })).toBeDisabled();
  await page.getByLabel("Search tasks").fill("");
  await page.getByRole("button", { name: "Review the launch proposal", exact: true }).click();
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Confirm removal" }).click();
  await expect(page.getByRole("button", { name: "Review the launch proposal", exact: true })).toHaveCount(0);
});

test('overdue memo reaches an ordinary Gemini turn without a hidden user message', async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/v1/interactions*', async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ contentType: 'text/event-stream', body: [
      `event: interaction.created\ndata: ${JSON.stringify({ event_type: 'interaction.created', interaction: { id: 'kanban-memo-turn', status: 'in_progress', model: 'gemini-3.8-flash' } })}\n\n`,
      `event: step.delta\ndata: ${JSON.stringify({ event_type: 'step.delta', interaction_id: 'kanban-memo-turn', index: 0, delta: { type: 'text', text: 'I can see your overdue memo.' } })}\n\n`,
      `event: interaction.completed\ndata: ${JSON.stringify({ event_type: 'interaction.completed', interaction: { id: 'kanban-memo-turn', status: 'completed' } })}\n\n`,
    ].join('') });
  });
  await page.goto(''); await seedWorkspace(page);
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review the launch proposal', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open workspace command palette' }).click();
  await page.getByRole('button', { name: /Create new subroutine/ }).click();
  await page.getByRole('button', { name: 'Enable subroutine' }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to chat' }).click();
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox', exact: true }).click();
  await page.getByLabel('Gemini API key').fill(['kanban', 'test', 'key'].join('-'));
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
  await page.getByRole('textbox', { name: 'Message Elara' }).fill('Any overdue tasks?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('I can see your overdue memo.')).toBeVisible();
  const request = requests.find((entry) => JSON.stringify(entry.input).includes('Any overdue tasks?'));
  expect(request).toBeDefined();
  expect(request?.system_instruction).toEqual(expect.stringContaining('Review the launch proposal'));
  expect(request?.system_instruction).toEqual(expect.stringContaining('untrusted data'));
  expect(JSON.stringify(request?.input)).not.toContain('Review the launch proposal');
});


test('rate limits retain the last snapshot and defer reads until Retry-After', async ({ page }) => {
  await page.goto(''); await seedWorkspace(page);
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review the launch proposal', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeEnabled();
  await page.clock.install();
  let reads = 0;
  await page.route('https://tasks.googleapis.com/tasks/v1/users/@me/lists*', async (route) => {
    reads++;
    if (reads === 1) await route.fulfill({ status: 429, headers: { 'retry-after': '60' }, json: { error: 'rate limited' } });
    else await route.fallback();
  });
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('alert')).toContainText('429');
  await expect(page.getByRole('button', { name: 'Cooling down' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review the launch proposal', exact: true })).toBeVisible();
  await page.clock.fastForward(30000);
  expect(reads).toBe(1);
  await page.clock.fastForward(31000);
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(reads).toBe(2);
});

test('two tabs share local rules and stale editors cannot overwrite each other', async ({ page, context }) => {
  await page.goto(''); await seedWorkspace(page);
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review the launch proposal', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open workspace command palette' }).click();
  await page.getByRole('button', { name: /Create new subroutine/ }).click();
  await page.getByRole('button', { name: 'Enable subroutine' }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /Internal memo/ }).click();
  await page.getByRole('button', { name: 'Edit subroutine Overdue watch' }).click();
  const peer = await context.newPage();
  try {
    await peer.goto(''); await seedWorkspace(peer, true);
    await peer.getByRole('button', { name: 'Kanban', exact: true }).click();
    await peer.getByRole('button', { name: /Internal memo/ }).click();
    await peer.getByRole('button', { name: 'Edit subroutine Overdue watch' }).click();
    await peer.getByLabel('Subroutine name').fill('Changed in another tab');
    await peer.getByRole('button', { name: 'Save subroutine' }).click();
    await expect(peer.locator('dialog')).toHaveCount(0);
    await page.bringToFront();
    await page.getByLabel('Subroutine name').fill('Stale draft');
    await page.getByRole('button', { name: 'Save subroutine' }).click();
    await expect(page.getByRole('alert')).toContainText('changed in another tab');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit subroutine Changed in another tab' })).toBeVisible();
  } finally { await peer.close(); }
});
