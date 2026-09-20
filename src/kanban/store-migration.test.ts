import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, it, vi } from "vitest";
import { googleOAuthAuthority } from "../google/oauth/authority";

afterEach(() => {
  vi.restoreAllMocks();
});

it("upgrades the v1 Kanban board cache to v2 without losing persisted board state", async () => {
  await Dexie.delete("elara-kanban");
  const legacy = new Dexie("elara-kanban");
  legacy.version(1).stores({ boards: "&account" });
  const account = "legacy@example.com";
  await legacy.table("boards").put({
    account,
    lists: [{ id: "work", title: "Work" }],
    tasks: [{ id: "legacy-task", listId: "work", title: "Legacy task", scheduledDate: "2020-01-01", status: "needsAction" }],
    routines: [{ id: "legacy-rule", name: "Legacy watch", listId: "", days: 1, enabled: true }],
    syncedAt: Date.now(),
  });
  legacy.close();

  vi.spyOn(googleOAuthAuthority, "getStatus").mockResolvedValue({
    state: "connected",
    enabledCapabilities: ["tasks.read"],
    grantedCapabilities: ["tasks.read"],
    grantedProviderScopes: [],
    sessionReady: true,
    account: { email: account },
  });

  const { kanbanContext } = await import("./store");
  await expect(kanbanContext()).resolves.toContain("Legacy task");

  const inspected = new Dexie("elara-kanban");
  inspected.version(2).stores({ boards: "&account", readSchedules: "&account" });
  await inspected.open();
  expect(await inspected.table("boards").get(account)).toMatchObject({
    account,
    routines: [{ id: "legacy-rule", name: "Legacy watch" }],
    tasks: [{ id: "legacy-task", title: "Legacy task" }],
  });
  expect(inspected.tables.map(({ name }) => name)).toContain("readSchedules");
  inspected.close();
});
