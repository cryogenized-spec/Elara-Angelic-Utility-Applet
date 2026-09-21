import { describe, expect, it, vi } from 'vitest';
import { googleToolRegistry } from '../google/tools/registry';
import type { GoogleToolExecutionContext } from '../google/tools/executor';
import type { GoogleToolName } from '../google/tools/contracts';
import {
  createKanbanToolHandlers,
  inspectKanbanBoard,
  locateKanbanBoard,
  type KanbanAgentDeps,
} from './agent-tools';
import { validateKanbanToolArguments } from './tool-schema';
import type { Board, BoardState } from './store';

const board: Board = {
  account: 'person@example.com',
  lists: [
    { id: 'work', title: 'Work' },
    { id: 'home', title: 'Home' },
  ],
  tasks: [
    { id: 'quote', listId: 'work', title: 'Send supplier quote', notes: 'Use the revised PDF', status: 'needsAction', scheduledDate: '2026-09-19', position: '0001', etag: '"q1"' },
    { id: 'done', listId: 'work', title: 'Archive old quote', status: 'completed', position: '0002' },
    { id: 'milk', listId: 'home', title: 'Buy milk', status: 'needsAction', position: '0001' },
  ],
  routines: [],
  syncedAt: Date.parse('2026-09-20T10:00:00Z'),
};

const state: BoardState = {
  board,
  busy: false,
  error: null,
  phase: 'idle',
  nextRetryAt: null,
  failures: 0,
};

function context(tool: GoogleToolName, args: Record<string, unknown>): GoogleToolExecutionContext {
  const descriptor = googleToolRegistry.find((entry) => entry.name === tool);
  if (!descriptor) throw new Error(`missing descriptor ${tool}`);
  return {
    tool,
    descriptor,
    capability: 'tasks.read',
    risk: descriptor.risk,
    arguments: args,
  };
}

function deps(overrides: Partial<KanbanAgentDeps> = {}): KanbanAgentDeps {
  return {
    getSnapshot: () => state,
    currentAccount: async () => board.account,
    sync: async () => undefined,
    requestFocus: () => true,
    now: () => new Date('2026-09-20T12:00:00Z'),
    ...overrides,
  };
}

describe('Kanban agent surface', () => {
  it('exposes bounded board structure without creating a second task mutation authority', () => {
    const result = inspectKanbanBoard(board, state, {}, new Date('2026-09-20T12:00:00Z'));
    expect(result).toMatchObject({
      trust: 'untrusted-external',
      workspace: 'kanban',
      sourceOfTruth: 'google-tasks',
      view: 'lists',
      totals: { lists: 2, tasks: 3, open: 2, completed: 1 },
    });
    expect(result.mutationAuthority).toContain('tasks.*');
    expect(result.lists).toEqual([
      expect.objectContaining({ id: 'work', title: 'Work', taskCount: 2, openCount: 1, completedCount: 1, overdueCount: 1 }),
      expect.objectContaining({ id: 'home', title: 'Home', taskCount: 1, openCount: 1 }),
    ]);
  });

  it('inspects one list with pagination and hides completed cards by default', () => {
    const result = inspectKanbanBoard(board, state, { listId: 'work', limit: 1 }, new Date('2026-09-20T12:00:00Z'));
    expect(result).toMatchObject({
      view: 'list',
      list: { id: 'work', title: 'Work' },
      page: { offset: 0, limit: 1, returned: 1, hasMore: false },
    });
    expect(result.tasks).toEqual([
      expect.objectContaining({ taskId: 'quote', listId: 'work', title: 'Send supplier quote', etag: '"q1"' }),
    ]);
  });

  it('locates cards using board-local text while preserving provider identities', () => {
    const result = locateKanbanBoard(board, state, { query: 'supplier' }, new Date('2026-09-20T12:00:00Z'));
    expect(result).toMatchObject({ trust: 'untrusted-external', query: 'supplier', totalMatches: 1 });
    expect(result.matches).toEqual([
      expect.objectContaining({ kind: 'task', listId: 'work', taskId: 'quote', title: 'Send supplier quote' }),
    ]);
  });

  it('refreshes through the existing reconciliation path and focuses only existing board targets', async () => {
    const sync = vi.fn(async () => undefined);
    const requestFocus = vi.fn(() => true);
    const handlers = createKanbanToolHandlers(deps({ sync, requestFocus }));

    const refreshed = await handlers['kanban.refresh']!(context('kanban.refresh', {}));
    expect(sync).toHaveBeenCalledWith('manual');
    expect(refreshed).toMatchObject({ workspace: 'kanban', sourceOfTruth: 'google-tasks' });

    const focused = await handlers['kanban.focus']!(context('kanban.focus', { listId: 'work', taskId: 'quote' }));
    expect(requestFocus).toHaveBeenCalledWith({ listId: 'work', taskId: 'quote' });
    expect(focused).toMatchObject({ focused: true, providerMutation: false });

    await expect(handlers['kanban.focus']!(context('kanban.focus', { listId: 'work', taskId: 'missing' }))).rejects.toThrow(/not present/);
  });

  it('rechecks account identity before exposing a cached board', async () => {
    let calls = 0;
    const handlers = createKanbanToolHandlers(deps({
      currentAccount: async () => (++calls === 1 ? board.account : 'other@example.com'),
    }));

    await expect(handlers['kanban.inspect']!(context('kanban.inspect', {}))).rejects.toThrow(/account changed/i);
  });

  it('releases a cancelled model turn without cancelling the shared board refresh', async () => {
    let releaseSync!: () => void;
    const sync = vi.fn(() => new Promise<void>((resolve) => { releaseSync = resolve; }));
    const handlers = createKanbanToolHandlers(deps({ sync }));
    const controller = new AbortController();

    const pending = handlers['kanban.refresh']!({
      ...context('kanban.refresh', {}),
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toThrow(/no longer active/i);
    expect(sync).toHaveBeenCalledWith('manual');

    // The model turn stopped waiting, but the shared reconciliation remained
    // independently owned and can finish normally for the rest of the app.
    releaseSync();
    await Promise.resolve();
  });

  it('also releases refresh when the generation arbiter supersedes the turn', async () => {
    let releaseSync!: () => void;
    let active = true;
    const sync = vi.fn(() => new Promise<void>((resolve) => { releaseSync = resolve; }));
    const handlers = createKanbanToolHandlers(deps({ sync }));

    const pending = handlers['kanban.refresh']!({
      ...context('kanban.refresh', {}),
      isGenerationActive: () => active,
    });
    await Promise.resolve();
    active = false;

    await expect(pending).rejects.toThrow(/no longer active/i);
    releaseSync();
    await Promise.resolve();
  });

  it('does not start refresh when the originating generation is already inactive', async () => {
    const sync = vi.fn(async () => undefined);
    const handlers = createKanbanToolHandlers(deps({ sync }));

    const controller = new AbortController();
    controller.abort();
    await expect(handlers['kanban.refresh']!({
      ...context('kanban.refresh', {}),
      signal: controller.signal,
    })).rejects.toThrow(/no longer active/i);

    await expect(handlers['kanban.refresh']!({
      ...context('kanban.refresh', {}),
      isGenerationActive: () => false,
    })).rejects.toThrow(/no longer active/i);

    expect(sync).not.toHaveBeenCalled();
  });

  it('does not focus the UI after the originating generation is cancelled', async () => {
    const requestFocus = vi.fn(() => true);
    const handlers = createKanbanToolHandlers(deps({ requestFocus }));
    const controller = new AbortController();
    controller.abort();

    await expect(handlers['kanban.focus']!({
      ...context('kanban.focus', { listId: 'work', taskId: 'quote' }),
      signal: controller.signal,
    })).rejects.toThrow(/no longer active/i);
    expect(requestFocus).not.toHaveBeenCalled();

    await expect(handlers['kanban.focus']!({
      ...context('kanban.focus', { listId: 'work', taskId: 'quote' }),
      isGenerationActive: () => false,
    })).rejects.toThrow(/no longer active/i);
    expect(requestFocus).not.toHaveBeenCalled();
  });

  it('fails closed on malformed model arguments', () => {
    expect(() => validateKanbanToolArguments('kanban.locate', { query: '' })).toThrow();
    expect(() => validateKanbanToolArguments('kanban.focus', { listId: 'work', surprise: true })).toThrow();
    expect(validateKanbanToolArguments('kanban.inspect', { offset: 0, limit: 20 })).toEqual({ offset: 0, limit: 20 });
  });
});
