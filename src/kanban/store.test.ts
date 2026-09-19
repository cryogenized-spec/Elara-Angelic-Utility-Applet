import "fake-indexeddb/auto";
import Dexie from 'dexie';
import { claimRead, releaseRead, type ReadSchedule } from './read-coordination';
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
  it('orders twenty thousand nested tasks without recursive stack growth', () => {
    const tasks = Array.from({ length: 20_000 }, (_, index) => ({ ...task, id: String(index), parent: index ? String(index - 1) : undefined, position: String(index).padStart(5, '0') }));
    const imported = [...tasks].reverse();
    expect(orderedTasks(imported)).toEqual(tasks);
    expect(imported[0].id).toBe('19999'); // Input remains untouched.
  });
  it('retains stable sibling order, orphans and cycles exactly once', () => {
    const tasks = [
      { ...task, id: 'child-b', parent: 'root', position: '2' },
      { ...task, id: 'cycle-a', parent: 'cycle-b', position: '4' },
      { ...task, id: 'child-a', parent: 'root', position: '1' },
      { ...task, id: 'root', position: '3' },
      { ...task, id: 'orphan', parent: 'missing', position: '5' },
      { ...task, id: 'cycle-b', parent: 'cycle-a', position: '6' },
      { ...task, id: 'self', parent: 'self', position: '7' },
    ];
    expect(orderedTasks(tasks).map(({ id }) => id)).toEqual(['root', 'child-a', 'child-b', 'orphan', 'cycle-a', 'cycle-b', 'self']);
  });
  it('indexes overlapping rule thresholds without changing scope or task order', () => {
    const tasks = Array.from({ length: 10_000 }, (_, index) => ({ ...task, id: String(index), listId: index % 2 ? 'b' : 'a' }));
    const routines = Array.from({ length: 100 }, (_, index) => ({ ...initial.routines[0], id: String(index), listId: 'a', days: index + 1 }));
    const board = { ...initial, tasks, routines };
    expect(overdueMemo(board, new Date(2026, 8, 18))).toEqual(tasks.filter(({ listId }) => listId === 'a'));
    expect(overdueMemo({ ...board, routines: [...routines, { ...routines[0], listId: '' }] }, new Date(2026, 8, 18))).toEqual(tasks);
    expect(overdueMemo({ ...board, routines: [] }, new Date(2026, 8, 18))).toEqual([]);
  });

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
    const database = new Dexie('elara-kanban'); database.version(2).stores({ boards: '&account', readSchedules: '&account' });
    try { await database.table('boards').clear(); await database.table('readSchedules').clear(); } finally { database.close(); }
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
  it('adopts a completed peer snapshot without a duplicate automatic provider read', async () => {
    const peer = new Dexie('elara-kanban'); peer.version(2).stores({ boards: '&account', readSchedules: '&account' });
    const schedules = peer.table<ReadSchedule, string>('readSchedules');
    await claimRead(schedules, initial.account, 'peer', Infinity, false);
    const pending = syncBoard('automatic');
    try {
      await vi.waitFor(() => expect(boardStore.getSnapshot().phase).toBe('waiting'));
      expect(mocks.lists).not.toHaveBeenCalled();
      const syncedAt = Date.now();
      await peer.table('boards').put({ ...initial, tasks: [task], syncedAt });
      await releaseRead(schedules, initial.account, 'peer', { lastSuccessAt: syncedAt });
      await pending;
      expect(boardStore.getSnapshot().board?.tasks).toEqual([task]);
      expect(mocks.lists).not.toHaveBeenCalled();
      await syncBoard();
      expect(mocks.lists).toHaveBeenCalledOnce();
    } finally { cancelBoardSync(); await pending; peer.close(); }
  });
  it('cannot commit a stale read after another connection takes over an expired lease', async () => {
    await syncBoard();
    const peer = new Dexie('elara-kanban'); peer.version(2).stores({ boards: '&account', readSchedules: '&account' });
    const schedules = peer.table<ReadSchedule, string>('readSchedules');
    let finish: ((value: { items: BoardTask[] }) => void) | undefined;
    mocks.tasks.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = syncBoard();
    try {
      await vi.waitFor(() => expect(finish).toBeDefined());
      await schedules.update(initial.account, { leaseUntil: Date.now() - 1 });
      await claimRead(schedules, initial.account, 'replacement', Infinity, false);
      const replacement = { ...initial, tasks: [{ ...task, title: 'Current peer snapshot' }], syncedAt: Date.now() };
      await peer.table('boards').put(replacement);
      finish!({ items: [{ ...task, title: 'Stale result' }] });
      await pending;
      expect((await peer.table<Board>('boards').get(initial.account))?.tasks[0].title).toBe('Current peer snapshot');
      expect((await schedules.get(initial.account))?.owner).toBe('replacement');
      expect(boardStore.getSnapshot().board?.tasks[0].title).not.toBe('Stale result');
    } finally { finish?.({ items: [] }); cancelBoardSync(); await pending; peer.close(); }
  });
  it('shares another connection’s cooldown even without a cached board', async () => {
    const peer = new Dexie('elara-kanban'); peer.version(2).stores({ boards: '&account', readSchedules: '&account' });
    const schedules = peer.table<ReadSchedule, string>('readSchedules');
    try {
      await claimRead(schedules, initial.account, 'peer', Infinity, false);
      const nextRetryAt = Date.now() + 60000;
      await releaseRead(schedules, initial.account, 'peer', { failures: 1, nextRetryAt, error: 'Google 429' });
      await syncBoard();
      expect(mocks.lists).not.toHaveBeenCalled();
      expect(boardStore.getSnapshot()).toMatchObject({ failures: 1, nextRetryAt, phase: 'backoff' });
    } finally { peer.close(); }
  });
  it('preserves unrelated rules and rejects a stale editor after another database connection updates a rule', async () => {
    await syncBoard();
    const first = { ...initial.routines[0], id: 'cross-tab-a' };
    const second = { ...first, id: 'cross-tab-b' };
    await Promise.all([saveRoutine(first, null), saveRoutine(second, null)]);
    const peer = new Dexie('elara-kanban'); peer.version(2).stores({ boards: '&account', readSchedules: '&account' });
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
  it('keeps polling and account checks suspended after pagehide until pageshow', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const stop = startBoardSync();
    try {
      await syncBoard();
      const reads = mocks.tasks.mock.calls.length;
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      mocks.status.mockClear();
      window.dispatchEvent(new Event('elara:tasks-changed'));
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(SYNC_INTERVAL);
      expect(mocks.status).not.toHaveBeenCalled();
      expect(mocks.tasks).toHaveBeenCalledTimes(reads);
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      await vi.waitFor(() => {
        expect(mocks.tasks).toHaveBeenCalledTimes(reads + 1);
        expect(boardStore.getSnapshot().busy).toBe(false);
      });
    } finally { stop(); await syncBoard(); }
  });
  it('releases an in-flight read lease on pagehide and reads again on pageshow', async () => {
    let signal: AbortSignal | undefined;
    mocks.tasks.mockImplementationOnce((_id, options) => new Promise((_resolve, reject) => {
      signal = options?.signal;
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const peer = new Dexie('elara-kanban'); peer.version(2).stores({ boards: '&account', readSchedules: '&account' });
    const stop = startBoardSync();
    try {
      await vi.waitFor(() => expect(signal).toBeDefined());
      const pending = syncBoard();
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      await pending;
      expect(signal?.aborted).toBe(true);
      expect((await peer.table<ReadSchedule>('readSchedules').get(initial.account))?.owner).toBeNull();
      expect(boardStore.getSnapshot()).toMatchObject({ busy: false, error: null });
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      await vi.waitFor(() => {
        expect(mocks.tasks).toHaveBeenCalledTimes(2);
        expect(boardStore.getSnapshot().phase).toBe('idle');
      });
    } finally { stop(); await syncBoard(); peer.close(); }
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
