import "fake-indexeddb/auto";
import Dexie from 'dexie';
import { READ_TIMEOUT_MS, RetryableReadError } from './sync-policy';
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { googleOAuthAuthority } from "../google/oauth/authority";
import { GoogleTasksService } from "../google/tasks/service";
import {
  boardStore,
  fetchBoard,
  kanbanContext,
  orderedTasks,
  overdueDays,
  overdueMemo,
  saveRoutine,
  removeRoutine,
  cancelBoardSync,
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
  beforeEach(async () => {
    vi.restoreAllMocks();
    const database = new Dexie('elara-kanban'); database.version(1).stores({ boards: '&account' });
    try { await database.table('boards').clear(); } finally { database.close(); }
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
  afterEach(() => { vi.useRealTimers(); });
  it('preserves unrelated rules and rejects a stale editor after another database connection updates a rule', async () => {
    await syncBoard();
    const first = { ...initial.routines[0], id: 'cross-tab-a' };
    const second = { ...first, id: 'cross-tab-b' };
    await Promise.all([saveRoutine(first, null), saveRoutine(second, null)]);
    const peer = new Dexie('elara-kanban'); peer.version(1).stores({ boards: '&account' });
    try {
      await peer.transaction('rw', peer.table('boards'), async () => {
        const board = await peer.table<Board>('boards').get(initial.account);
        await peer.table('boards').update(initial.account, { routines: board!.routines.map((rule) => rule.id === first.id ? { ...rule, name: 'Changed elsewhere' } : rule) });
      });
      await expect(saveRoutine({ ...first, name: 'Stale edit' }, first)).rejects.toThrow('another tab');
      await expect(removeRoutine(first)).rejects.toThrow('another tab');
      await saveRoutine({ ...second, days: 7 }, second);
      const board = await peer.table<Board>('boards').get(initial.account);
      expect(board?.routines.find((rule) => rule.id === first.id)?.name).toBe('Changed elsewhere');
      expect(board?.routines.find((rule) => rule.id === second.id)?.days).toBe(7);
    } finally { peer.close(); }
  });
  it('aborts a paginated sync without publishing a partial snapshot or an error', async () => {
    await syncBoard();
    const before = boardStore.getSnapshot().board;
    let finish: ((value: { items: BoardTask[] }) => void) | undefined;
    const waiting = new Promise<{ items: BoardTask[] }>((resolve) => { finish = resolve; });
    let reading = false;
    mocks.tasks.mockImplementationOnce(() => { reading = true; return waiting; });
    const pending = syncBoard();
    await vi.waitFor(() => expect(reading).toBe(true));
    cancelBoardSync(); finish!({ items: [{ ...task, title: 'Incomplete snapshot' }] });
    await pending;
    expect(boardStore.getSnapshot().board?.tasks).toEqual(before?.tasks);
    expect(boardStore.getSnapshot().error).toBeNull();
    expect(boardStore.getSnapshot().busy).toBe(false);
  });
  it('times out a stalled read and schedules only a read retry', async () => {
    await syncBoard();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    let reading = false;
    mocks.tasks.mockImplementationOnce((_id, options) => new Promise((_resolve, reject) => {
      reading = true;
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const pending = syncBoard();
    await vi.waitFor(() => expect(reading).toBe(true));
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    await pending;
    expect(boardStore.getSnapshot()).toMatchObject({ busy: false, phase: 'backoff', error: 'Task sync timed out.' });
    vi.setSystemTime(boardStore.getSnapshot().nextRetryAt! + 1);
    await syncBoard();
  });
  it('resumes after an aborted lifecycle without committing the old read', async () => {
    let finish: ((value: { items: BoardTask[] }) => void) | undefined;
    let reading = false;
    mocks.tasks.mockImplementationOnce(() => { reading = true; return new Promise((resolve) => { finish = resolve; }); });
    const stopFirst = startBoardSync();
    await vi.waitFor(() => expect(reading).toBe(true));
    stopFirst();
    const stopNext = startBoardSync();
    try {
      finish!({ items: [{ ...task, title: 'Cancelled result' }] });
      await vi.waitFor(() => {
        expect(mocks.tasks).toHaveBeenCalledTimes(2);
        expect(boardStore.getSnapshot().phase).toBe('idle');
        expect(boardStore.getSnapshot().board?.tasks[0]?.title).toBe(task.title);
      });
    } finally { stopNext(); await syncBoard(); }
  });
  it('honors provider cooldown even for manual refresh and resets after recovery', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await syncBoard();
    mocks.tasks.mockRejectedValueOnce(new RetryableReadError('Rate limited', 60000));
    await syncBoard();
    const { nextRetryAt, phase } = boardStore.getSnapshot();
    expect(phase).toBe('backoff');
    expect(nextRetryAt).toBeGreaterThanOrEqual(Date.now() + 60000);
    const calls = mocks.tasks.mock.calls.length;
    await syncBoard(); expect(mocks.tasks).toHaveBeenCalledTimes(calls);
    vi.setSystemTime(nextRetryAt! + 1);
    await syncBoard('automatic');
    expect(boardStore.getSnapshot()).toMatchObject({ phase: 'idle', failures: 0, nextRetryAt: null, error: null });
  });
  it('stops automatic retries after five failures and permits an explicit later retry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await syncBoard();
    for (let attempt = 0; attempt < 5; attempt++) {
      mocks.tasks.mockRejectedValueOnce(new RetryableReadError('Unavailable'));
      await syncBoard(attempt ? 'automatic' : 'manual');
      vi.setSystemTime(boardStore.getSnapshot().nextRetryAt! + 1);
    }
    expect(boardStore.getSnapshot()).toMatchObject({ phase: 'paused', failures: 5 });
    const calls = mocks.tasks.mock.calls.length;
    await syncBoard('automatic'); expect(mocks.tasks).toHaveBeenCalledTimes(calls);
    await syncBoard();
    expect(boardStore.getSnapshot()).toMatchObject({ phase: 'idle', failures: 0 });
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
    await saveRoutine(initial.routines[0], null);
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
      saveRoutine({ ...initial.routines[0], days: 0 }, null),
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
