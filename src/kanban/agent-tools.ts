import type { GoogleToolHandlers } from '../google/tools/executor';
import {
  boardStore,
  currentAccount,
  orderedTasks,
  overdueDays,
  syncBoard,
  type Board,
  type BoardState,
  type BoardTask,
} from './store';
import { requestKanbanFocus, type KanbanFocusTarget } from './focus';

const DEFAULT_PAGE_LIMIT = 20;
const DEFAULT_LOCATE_LIMIT = 10;
const MAX_NOTE_PREVIEW = 500;
const MAX_TITLE_PREVIEW = 300;

export interface KanbanAgentDeps {
  readonly getSnapshot: () => BoardState;
  readonly currentAccount: () => Promise<string | null>;
  readonly sync: (reason: 'manual') => Promise<void>;
  readonly requestFocus: (target: KanbanFocusTarget) => boolean;
  readonly now: () => Date;
}

const defaultDeps: KanbanAgentDeps = {
  getSnapshot: boardStore.getSnapshot,
  currentAccount,
  sync: (reason) => syncBoard(reason),
  requestFocus: requestKanbanFocus,
  now: () => new Date(),
};

function bounded(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function numberArg(args: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  return typeof args[key] === 'number' ? args[key] : fallback;
}

function booleanArg(args: Readonly<Record<string, unknown>>, key: string, fallback = false): boolean {
  return typeof args[key] === 'boolean' ? args[key] : fallback;
}

function stringArg(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
  return typeof args[key] === 'string' ? args[key].trim() : undefined;
}

function tasksByList(board: Board): Map<string, BoardTask[]> {
  const groups = new Map<string, BoardTask[]>();
  for (const task of board.tasks) {
    const existing = groups.get(task.listId);
    if (existing) existing.push(task);
    else groups.set(task.listId, [task]);
  }
  return groups;
}

async function requireLiveBoard(deps: KanbanAgentDeps): Promise<{ board: Board; state: BoardState }> {
  const account = await deps.currentAccount();
  const state = deps.getSnapshot();
  if (!account || !state.board || state.board.account !== account) {
    throw new Error('Kanban workspace is unavailable until the current Google Tasks account has a live synchronized board.');
  }
  // Account identity is an authority boundary. Recheck after reading the
  // account-keyed projection so a same-origin switch cannot disclose the
  // previous account's board through a racing model tool call.
  if (await deps.currentAccount() !== account) {
    throw new Error('Google account changed while reading the Kanban workspace. Retry after the new account is synchronized.');
  }
  return { board: state.board, state };
}

function assertActiveRequest(signal?: AbortSignal, isGenerationActive?: () => boolean): void {
  if (signal?.aborted || isGenerationActive?.() === false) {
    throw new Error('Kanban request was cancelled because the originating generation is no longer active.');
  }
}

async function awaitWhileGenerationActive<T>(
  work: Promise<T>,
  signal?: AbortSignal,
  isGenerationActive?: () => boolean,
): Promise<T> {
  assertActiveRequest(signal, isGenerationActive);
  if (!signal && !isGenerationActive) return work;

  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    };
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const cancel = () => finish(() => reject(new Error('Kanban request was cancelled because the originating generation is no longer active.')));
    const poll = () => {
      if (settled) return;
      if (isGenerationActive?.() === false) {
        cancel();
        return;
      }
      timer = setTimeout(poll, 50);
    };

    signal?.addEventListener('abort', cancel, { once: true });
    if (isGenerationActive) timer = setTimeout(poll, 50);
    work.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error instanceof Error ? error : new Error('Kanban request failed.'))),
    );
  });
}

function syncProjection(state: BoardState, board: Board, now: Date) {
  return {
    phase: state.phase,
    busy: state.busy,
    syncedAt: new Date(board.syncedAt).toISOString(),
    ageMs: Math.max(0, now.getTime() - board.syncedAt),
    nextRetryAt: state.nextRetryAt ? new Date(state.nextRetryAt).toISOString() : null,
    error: state.error,
  };
}

export function inspectKanbanBoard(
  board: Board,
  state: BoardState,
  args: Readonly<Record<string, unknown>>,
  now: Date,
): Record<string, unknown> {
  const includeCompleted = booleanArg(args, 'includeCompleted');
  const offset = numberArg(args, 'offset', 0);
  const limit = numberArg(args, 'limit', DEFAULT_PAGE_LIMIT);
  const listId = stringArg(args, 'listId');
  const grouped = tasksByList(board);

  const base = {
    trust: 'untrusted-external',
    workspace: 'kanban',
    sourceOfTruth: 'google-tasks',
    mutationAuthority: 'Use the existing tasks.* tools for Google Task or task-list mutations. Kanban tools inspect, refresh, locate, or focus the board projection only.',
    sync: syncProjection(state, board, now),
    totals: {
      lists: board.lists.length,
      tasks: board.tasks.length,
      open: board.tasks.filter((task) => task.status !== 'completed').length,
      completed: board.tasks.filter((task) => task.status === 'completed').length,
    },
  };

  if (!listId) {
    const page = board.lists.slice(offset, offset + limit);
    return {
      ...base,
      view: 'lists',
      page: { offset, limit, returned: page.length, hasMore: offset + page.length < board.lists.length },
      lists: page.map((list) => {
        const tasks = grouped.get(list.id) ?? [];
        return {
          id: list.id,
          title: bounded(list.title || 'Untitled list', MAX_TITLE_PREVIEW),
          taskCount: tasks.length,
          openCount: tasks.filter((task) => task.status !== 'completed').length,
          completedCount: tasks.filter((task) => task.status === 'completed').length,
          overdueCount: tasks.filter((task) => task.status !== 'completed' && overdueDays(task.scheduledDate, now) > 0).length,
        };
      }),
    };
  }

  const list = board.lists.find((candidate) => candidate.id === listId);
  if (!list) throw new Error('The requested Kanban list is not present in the current synchronized board.');
  const tasks = orderedTasks(grouped.get(list.id) ?? [])
    .filter((task) => includeCompleted || task.status !== 'completed');
  const page = tasks.slice(offset, offset + limit);
  return {
    ...base,
    view: 'list',
    list: { id: list.id, title: bounded(list.title || 'Untitled list', MAX_TITLE_PREVIEW) },
    page: { offset, limit, returned: page.length, hasMore: offset + page.length < tasks.length },
    tasks: page.map((task) => ({
      taskId: task.id,
      listId: task.listId,
      title: bounded(task.title || 'Untitled task', MAX_TITLE_PREVIEW),
      notes: bounded(task.notes, MAX_NOTE_PREVIEW),
      status: task.status,
      scheduledDate: task.scheduledDate,
      parentTaskId: task.parent,
      etag: task.etag,
      assigned: Boolean(task.assignmentInfo),
    })),
  };
}

export function locateKanbanBoard(
  board: Board,
  state: BoardState,
  args: Readonly<Record<string, unknown>>,
  now: Date,
): Record<string, unknown> {
  const query = (stringArg(args, 'query') ?? '').toLocaleLowerCase();
  const includeCompleted = booleanArg(args, 'includeCompleted');
  const limit = numberArg(args, 'limit', DEFAULT_LOCATE_LIMIT);
  const listTitle = new Map(board.lists.map((list) => [list.id, list.title || 'Untitled list'] as const));

  const listMatches = board.lists
    .filter((list) => (bounded(list.title || '', MAX_TITLE_PREVIEW) ?? '').toLocaleLowerCase().includes(query))
    .map((list) => ({
      kind: 'list' as const,
      listId: list.id,
      listTitle: bounded(list.title || 'Untitled list', MAX_TITLE_PREVIEW),
    }));

  const taskMatches = board.tasks
    .filter((task) => includeCompleted || task.status !== 'completed')
    .filter((task) => {
      const title = bounded(task.title, MAX_TITLE_PREVIEW) ?? '';
      const notes = bounded(task.notes, MAX_NOTE_PREVIEW) ?? '';
      const list = bounded(listTitle.get(task.listId), MAX_TITLE_PREVIEW) ?? '';
      return `${title} ${notes} ${list}`.toLocaleLowerCase().includes(query);
    })
    .map((task) => ({
      kind: 'task' as const,
      listId: task.listId,
      listTitle: bounded(listTitle.get(task.listId) ?? 'Unknown list', MAX_TITLE_PREVIEW),
      taskId: task.id,
      title: bounded(task.title || 'Untitled task', MAX_TITLE_PREVIEW),
      notes: bounded(task.notes, MAX_NOTE_PREVIEW),
      status: task.status,
      scheduledDate: task.scheduledDate,
      parentTaskId: task.parent,
      etag: task.etag,
    }));

  const matches = [...listMatches, ...taskMatches];
  return {
    trust: 'untrusted-external',
    workspace: 'kanban',
    sourceOfTruth: 'google-tasks',
    mutationAuthority: 'Use tasks.* tools for provider mutations.',
    sync: syncProjection(state, board, now),
    query,
    returned: Math.min(limit, matches.length),
    totalMatches: matches.length,
    truncated: matches.length > limit,
    matches: matches.slice(0, limit),
  };
}

export function createKanbanToolHandlers(deps: KanbanAgentDeps = defaultDeps): GoogleToolHandlers {
  return {
    'kanban.inspect': async ({ arguments: args }) => {
      const { board, state } = await requireLiveBoard(deps);
      return inspectKanbanBoard(board, state, args, deps.now());
    },
    'kanban.refresh': async ({ signal, isGenerationActive }) => {
      // Do not start shared reconciliation for a model turn that already lost
      // authority while upstream OAuth/capability checks were still resolving.
      assertActiveRequest(signal, isGenerationActive);
      // Board reconciliation is shared application work. Cancellation releases
      // this obsolete model turn without aborting a refresh another surface may
      // already be awaiting.
      await awaitWhileGenerationActive(deps.sync('manual'), signal, isGenerationActive);
      assertActiveRequest(signal, isGenerationActive);
      const { board, state } = await requireLiveBoard(deps);
      assertActiveRequest(signal, isGenerationActive);
      return inspectKanbanBoard(board, state, {}, deps.now());
    },
    'kanban.locate': async ({ arguments: args }) => {
      const { board, state } = await requireLiveBoard(deps);
      return locateKanbanBoard(board, state, args, deps.now());
    },
    'kanban.focus': async ({ arguments: args, signal, isGenerationActive }) => {
      assertActiveRequest(signal, isGenerationActive);
      const { board } = await requireLiveBoard(deps);
      assertActiveRequest(signal, isGenerationActive);
      const listId = stringArg(args, 'listId')!;
      const taskId = stringArg(args, 'taskId');
      if (!board.lists.some((list) => list.id === listId)) throw new Error('The requested Kanban list is not present in the current synchronized board.');
      if (taskId && !board.tasks.some((task) => task.listId === listId && task.id === taskId)) {
        throw new Error('The requested Kanban task is not present in that list.');
      }
      const target = { listId, ...(taskId ? { taskId } : {}) };
      assertActiveRequest(signal, isGenerationActive);
      if (!deps.requestFocus(target)) throw new Error('The Kanban presentation surface is unavailable in this runtime.');
      return {
        trust: 'application-data',
        workspace: 'kanban',
        focused: true,
        listId,
        ...(taskId ? { taskId } : {}),
        providerMutation: false,
      };
    },
  };
}

export const kanbanToolHandlers = createKanbanToolHandlers();
