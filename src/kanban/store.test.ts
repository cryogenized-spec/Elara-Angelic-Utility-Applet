import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { googleOAuthAuthority } from "../google/oauth/authority";
import { GoogleTasksService } from "../google/tasks/service";
import {
  boardStore,
  fetchBoard,
  kanbanContext,
  orderedTasks,
  overdueDays,
  overdueMemo,
  saveRoutines,
  syncBoard,
  startBoardSync,
  SYNC_INTERVAL,
  type Board,
  type BoardTask,
} from "./store";

const mocks = {
  lists: vi.fn<GoogleTasksService['listTaskLists']>(),
  tasks: vi.fn<GoogleTasksService['listTasks']>(),
  status: vi.fn<typeof googleOAuthAuthority.getStatus>(),
};
const initial: Board = {
  account: "one@example.com",
  lists: [{ id: "a", title: "Work" }],
  tasks: [],
  routines: [{ id: "r", name: "Watch", days: 1, listId: "", enabled: true }],
  syncedAt: 1,
};
const task: BoardTask = {
  id: "t",
  listId: "a",
  title: "Review",
  scheduledDate: "2026-09-17T00:00:00.000Z",
  status: "needsAction",
};

describe("kanban due-date and memo semantics", () => {
  it("keeps nested tasks beneath their parents while preserving sibling positions", () => {
    expect(
      orderedTasks([
        { ...task, id: "child", parent: "parent", position: "00" },
        { ...task, id: "other", position: "02" },
        { ...task, id: "parent", position: "01" },
      ]).map((item) => item.id),
    ).toEqual(["parent", "child", "other"]);
  });
  it("does not mark today overdue and uses local calendar days rather than elapsed hours", () => {
    const now = new Date(2026, 8, 18, 0, 5);
    expect(overdueDays("2026-09-18T00:00:00Z", now)).toBe(0);
    expect(overdueDays(task.scheduledDate, now)).toBe(1);
    expect(overdueDays("2026-09-19T00:00:00Z", now)).toBe(0);
    expect(overdueDays(undefined, now)).toBe(0);
    expect(overdueDays("invalid", now)).toBe(0);
  });
  it("deduplicates overlapping rules and resolves completed/deleted/rescheduled tasks", () => {
    const board: Board = {
      ...initial,
      tasks: [
        task,
        { ...task, id: "done", status: "completed" },
        { ...task, id: "gone", deleted: true },
        { ...task, id: "future", scheduledDate: "2026-09-30" },
      ],
      routines: [...initial.routines, { ...initial.routines[0], id: "r2" }],
    };
    expect(overdueMemo(board, new Date(2026, 8, 18))).toEqual([task]);
  });
  it("honors list scope, disabled rules and thresholds", () => {
    const board: Board = { ...initial, tasks: [task] };
    expect(
      overdueMemo(
        { ...board, routines: [{ ...initial.routines[0], listId: "other" }] },
        new Date(2026, 8, 18),
      ),
    ).toEqual([]);
    expect(
      overdueMemo(
        { ...board, routines: [{ ...initial.routines[0], enabled: false }] },
        new Date(2026, 8, 18),
      ),
    ).toEqual([]);
    expect(
      overdueMemo(
        { ...board, routines: [{ ...initial.routines[0], days: 2 }] },
        new Date(2026, 8, 18),
      ),
    ).toEqual([]);
  });
});

describe("snapshot reconciliation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.lists.mockReset(); mocks.tasks.mockReset(); mocks.status.mockReset();
    vi.spyOn(googleOAuthAuthority, "getStatus").mockImplementation(mocks.status);
    vi.spyOn(GoogleTasksService.prototype, "listTaskLists").mockImplementation(mocks.lists);
    vi.spyOn(GoogleTasksService.prototype, "listTasks").mockImplementation(mocks.tasks);
    mocks.status.mockResolvedValue({
      state: "connected",
      enabledCapabilities: ["tasks.read", "tasks.write"], grantedProviderScopes: [], sessionReady: true,
      grantedCapabilities: ["tasks.read", "tasks.write"],
      account: { email: initial.account },
    });
    mocks.lists.mockResolvedValue({
      items: initial.lists,
    });
    mocks.tasks.mockResolvedValue({
      items: [task],
    });
  });
  it("walks all list/task pages and preserves imported fields without writes", async () => {
    mocks.lists
      .mockResolvedValueOnce({ items: initial.lists, nextPageToken: "lists-2" })
      .mockResolvedValueOnce({ items: [{ id: "b", title: "Home" }] });
    mocks.tasks
      .mockResolvedValueOnce({
        items: [
          {
            ...task,
            parent: "parent",
            position: "01",
            notes: "Email source",
            etag: "etag",
          },
        ],
        nextPageToken: "tasks-2",
      })
      .mockResolvedValueOnce({
        items: [{ ...task, id: "done", status: "completed", hidden: true }],
      })
      .mockResolvedValueOnce({ items: [] });
    const result = await fetchBoard(
      new GoogleTasksService(googleOAuthAuthority),
    );
    expect(result.lists).toHaveLength(2);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]).toMatchObject({
      parent: "parent",
      notes: "Email source",
      etag: "etag",
      listId: "a",
    });
    expect(mocks.tasks).toHaveBeenNthCalledWith(
      2,
      "a",
      expect.objectContaining({
        pageToken: "tasks-2",
        showHidden: true,
        showCompleted: true,
      }),
    );
  });
  it("rejects repeated page tokens rather than looping indefinitely", async () => {
    mocks.lists.mockResolvedValue({
      items: [],
      nextPageToken: "same",
    });
    await expect(
      fetchBoard(new GoogleTasksService(googleOAuthAuthority)),
    ).rejects.toThrow("repeated");
  });
  it("retains the last complete snapshot after a failed page and coalesces overlapping syncs", async () => {
    await syncBoard();
    const original = boardStore.getSnapshot().board;
    mocks.tasks.mockRejectedValueOnce(
      new Error("Network interrupted"),
    );
    const first = syncBoard();
    expect(syncBoard()).toBe(first);
    await first;
    expect(boardStore.getSnapshot().board).toBe(original);
    expect(boardStore.getSnapshot().error).toBe("Network interrupted");
  });
  it("persists rules, supplies bounded untrusted memo context, and excludes disconnected accounts", async () => {
    mocks.tasks.mockResolvedValue({
      items: [{ ...task, scheduledDate: "2020-01-01" }],
    });
    await syncBoard();
    await saveRoutines(initial.routines);
    await syncBoard();
    expect(boardStore.getSnapshot().board?.routines).toEqual(initial.routines);
    expect(await kanbanContext()).toContain("Review");
    expect(await kanbanContext()).toContain("untrusted data");
    mocks.status.mockResolvedValue({
      state: "disconnected",
      enabledCapabilities: [], grantedProviderScopes: [], sessionReady: false,
      grantedCapabilities: [],
    });
    expect(await kanbanContext()).toBe("");
    await syncBoard();
    expect(boardStore.getSnapshot().board).toBeNull();
  });
  it("does not publish results after the Google account changes mid-sync", async () => {
    mocks.tasks.mockImplementationOnce(
      async () => {
        mocks.status.mockResolvedValue({
          state: "connected",
      enabledCapabilities: ["tasks.read", "tasks.write"], grantedProviderScopes: [], sessionReady: true,
          grantedCapabilities: ["tasks.read"],
          account: { email: "two@example.com" },
        });
        return { items: [task] };
      },
    );
    await syncBoard();
    expect(boardStore.getSnapshot().board).toBeNull();
    expect(await kanbanContext()).toBe("");
  });
  it("rejects invalid routine thresholds", async () => {
    await expect(
      saveRoutines([{ ...initial.routines[0], days: 0 }]),
    ).rejects.toThrow("Invalid");
  });
  it('schedules only while visible and removes timers on cleanup', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const stop = startBoardSync();
    try {
      await syncBoard();
      const read = mocks.lists;
      const calls = read.mock.calls.length;
      await vi.advanceTimersByTimeAsync(SYNC_INTERVAL);
      await syncBoard();
      expect(read.mock.calls.length).toBeGreaterThan(calls);
      visibility.mockReturnValue('hidden');
      const beforeHidden = read.mock.calls.length;
      await vi.advanceTimersByTimeAsync(SYNC_INTERVAL);
      expect(read.mock.calls.length).toBe(beforeHidden);
      stop();
      visibility.mockReturnValue('visible');
      await vi.advanceTimersByTimeAsync(SYNC_INTERVAL);
      expect(read.mock.calls.length).toBe(beforeHidden);
    } finally { stop(); vi.useRealTimers(); }
  });

});
