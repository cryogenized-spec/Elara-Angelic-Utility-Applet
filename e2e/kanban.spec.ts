import { expect, test, type Page } from "@playwright/test";

async function seedWorkspace(page: Page) {
  await page.evaluate(async () => {
    const { googleOAuthAuthority: oauth } =
      await import("/Elara-Angelic-Utility-Applet/src/google/oauth/authority.ts");
    const { syncBoard } =
      await import("/Elara-Angelic-Utility-Applet/src/kanban/store.ts");
    const lists = [
      { id: "studio", title: "Studio projects" },
      { id: "personal", title: "Personal" },
      { id: "reading", title: "Reading list" },
      { id: "later", title: "Someday" },
    ];
    const tasks = [
      {
        id: "review",
        title: "Review the launch proposal",
        notes: "Read the source email and confirm the next steps.",
        due: "2020-01-01T00:00:00Z",
        status: "needsAction",
        etag: "one",
        position: "0001",
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `task-${index}`,
        title: `Project milestone ${index + 1}`,
        status: "needsAction",
        etag: "one",
        position: `000${index + 2}`,
      })),
    ];
    oauth.getStatus = async () => ({
      state: "connected",
      grantedCapabilities: ["tasks.read", "tasks.write"],
      account: { email: "test@example.com" },
    });
    oauth.authorize = async (capability) => ({
      capability,
      fetch: async (url, init) => {
        const path = new URL(String(url)).pathname;
        let result: unknown;
        if (path.endsWith("/users/@me/lists")) {
          if (init?.method === "POST") {
            const list = {
              id: crypto.randomUUID(),
              ...JSON.parse(String(init.body)),
            };
            lists.push(list);
            result = list;
          } else result = { items: lists };
        } else if (path.includes("/users/@me/lists/")) {
          const id = decodeURIComponent(path.split("/").at(-1)!);
          const index = lists.findIndex((list) => list.id === id);
          if (init?.method === "DELETE") { lists.splice(index, 1); return new Response(null, { status: 204 }); }
          Object.assign(lists[index], JSON.parse(String(init?.body))); result = lists[index];
        } else if (path.endsWith("/move")) {
          const id = path.split("/").at(-2)!;
          const source = tasks.splice(tasks.findIndex((task) => task.id === id), 1)[0];
          const previous = new URL(String(url)).searchParams.get("previous");
          tasks.splice(previous ? tasks.findIndex((task) => task.id === previous) + 1 : 0, 0, source);
          tasks.forEach((task, index) => { task.position = String(index).padStart(4, "0"); });
          result = source;
        } else if (init?.method === "DELETE") {
          const index = tasks.findIndex((task) => path.endsWith("/" + task.id));
          tasks.splice(index, 1); return new Response(null, { status: 204 });
        } else if (!init?.method && !path.endsWith("/tasks")) {
          result = tasks.find((task) => path.endsWith("/" + task.id));
        } else if (init?.method === "PATCH") {
          const task = tasks.find((item) => path.endsWith("/" + item.id));
          Object.assign(task!, JSON.parse(String(init.body)));
          result = task;
        } else if (init?.method === "POST") {
          const task = {
            id: crypto.randomUUID(),
            status: "needsAction",
            ...JSON.parse(String(init.body)),
          };
          tasks.push(task);
          result = task;
        } else result = { items: path.includes("/studio/") ? tasks : [] };
        return new Response(JSON.stringify(result), {
          headers: { "content-type": "application/json" },
        });
      },
    });
    await syncBoard();
  });
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
