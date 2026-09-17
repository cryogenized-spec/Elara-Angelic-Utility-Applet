import { describe, expect, it } from 'vitest';
import { GoogleTasksService } from './service';
import type { GoogleOAuthAuthority } from '../oauth/contracts';

interface CapturedCall {
  readonly url: string;
  readonly method: string;
  readonly body?: unknown;
}

function makeOAuth(
  requested: string[],
  calls: CapturedCall[],
  responder: (url: string, method: string, body: unknown) => unknown,
): GoogleOAuthAuthority {
  return {
    authorize: async (capability) => {
      requested.push(capability);
      return {
        capability,
        fetch: async (input, init) => {
          const url = String(input);
          const method = init?.method ?? 'GET';
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
          calls.push({ url, method, body });
          const payload = responder(url, method, body);
          return payload === undefined
            ? new Response(null, { status: 204 })
            : new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
        },
      };
    },
    getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
    disconnect: async () => undefined,
  };
}

describe('GoogleTasksService', () => {
  it('maps provider due timestamps to an honest date-only scheduledDate', async () => {
    const requested: string[] = [];
    const calls: CapturedCall[] = [];
    const service = new GoogleTasksService(makeOAuth(requested, calls, () => ({
      id: 'task-1',
      title: 'Review Kanban',
      due: '2026-09-20T00:00:00.000Z',
      status: 'needsAction',
      assignmentInfo: { surfaceType: 'DOCUMENT', driveResourceInfo: { driveFileId: 'doc-1' } },
    })));

    await expect(service.getTask('list-1', 'task-1')).resolves.toMatchObject({
      id: 'task-1',
      title: 'Review Kanban',
      scheduledDate: '2026-09-20',
      assignmentInfo: { surfaceType: 'DOCUMENT', driveResourceInfo: { driveFileId: 'doc-1' } },
    });
    expect(requested).toEqual(['tasks.read']);
    expect(calls[0]?.method).toBe('GET');
  });

  it('serializes semantic scheduledDate as provider midnight without exposing task time semantics', async () => {
    const requested: string[] = [];
    const calls: CapturedCall[] = [];
    const service = new GoogleTasksService(makeOAuth(requested, calls, (_url, _method, body) => ({
      id: 'task-created',
      title: (body as { title?: string })?.title,
      due: (body as { due?: string })?.due,
      status: 'needsAction',
    })));

    await expect(service.createSemanticTask({
      taskListId: 'list-1',
      title: 'Pay supplier',
      notes: 'Use the approved invoice',
      scheduledDate: '2026-09-22',
      parent: 'parent-1',
      previous: 'previous-1',
    })).resolves.toMatchObject({ scheduledDate: '2026-09-22' });

    expect(requested).toEqual(['tasks.write']);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toContain('/lists/list-1/tasks?');
    expect(calls[0]?.url).toContain('parent=parent-1');
    expect(calls[0]?.url).toContain('previous=previous-1');
    expect(calls[0]?.body).toEqual({
      title: 'Pay supplier',
      notes: 'Use the approved invoice',
      due: '2026-09-22T00:00:00.000Z',
    });
  });

  it('rejects timed or impossible scheduled dates before authorization', async () => {
    const requested: string[] = [];
    const calls: CapturedCall[] = [];
    const service = new GoogleTasksService(makeOAuth(requested, calls, () => ({ id: 'unused' })));

    await expect(service.createSemanticTask({ taskListId: 'list-1', title: 'Bad time', scheduledDate: '2026-09-22T15:00:00+02:00' }))
      .rejects.toThrow(/scheduled date must be YYYY-MM-DD/i);
    await expect(service.createSemanticTask({ taskListId: 'list-1', title: 'Bad date', scheduledDate: '2026-02-30' }))
      .rejects.toThrow(/not a real calendar date/i);
    expect(requested).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('PATCHes explicit task fields and can clear the scheduled date', async () => {
    const requested: string[] = [];
    const calls: CapturedCall[] = [];
    const service = new GoogleTasksService(makeOAuth(requested, calls, (_url, _method, body) => ({
      id: 'task-1',
      title: 'Done',
      status: (body as { status?: string })?.status,
    })));

    await service.updateSemanticTask({
      taskListId: 'list-1',
      taskId: 'task-1',
      title: 'Done',
      clearScheduledDate: true,
      status: 'completed',
    });

    expect(requested).toEqual(['tasks.write']);
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.body).toEqual({ title: 'Done', due: null, status: 'completed' });
  });

  it('lists assigned tasks only when explicitly requested and preserves provider filter bounds', async () => {
    const requested: string[] = [];
    const calls: CapturedCall[] = [];
    const service = new GoogleTasksService(makeOAuth(requested, calls, () => ({ items: [], nextPageToken: 'next' })));

    await expect(service.listTasks('list-1', {
      showAssigned: true,
      maxResults: 100,
      dueMin: '2026-09-01T00:00:00+02:00',
      dueMax: '2026-09-30T23:59:59+02:00',
    })).resolves.toEqual({ items: [], nextPageToken: 'next' });

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('showAssigned')).toBe('true');
    expect(url.searchParams.get('maxResults')).toBe('100');
    expect(url.searchParams.get('dueMin')).toBe('2026-09-01T00:00:00+02:00');
    expect(url.searchParams.get('dueMax')).toBe('2026-09-30T23:59:59+02:00');
  });

  it('supports full task-list read and mutation parity with documented page bounds', async () => {
    const requested: string[] = [];
    const calls: CapturedCall[] = [];
    const service = new GoogleTasksService(makeOAuth(requested, calls, (url, method, body) => {
      if (url.includes('/users/@me/lists?')) return { items: [{ id: 'list-1', title: 'Life' }], nextPageToken: 'next-list' };
      if (method === 'DELETE') return undefined;
      return { id: 'list-1', title: (body as { title?: string })?.title ?? 'Life' };
    }));

    await expect(service.listTaskLists('page-1', 1000)).resolves.toMatchObject({ nextPageToken: 'next-list' });
    await expect(service.getTaskList('list-1')).resolves.toMatchObject({ id: 'list-1', title: 'Life' });
    await expect(service.createTaskList('Projects')).resolves.toMatchObject({ title: 'Projects' });
    await expect(service.updateTaskList('list-1', 'Projects 2026')).resolves.toMatchObject({ title: 'Projects 2026' });
    await expect(service.deleteTaskList('list-1')).resolves.toBeUndefined();

    const listUrl = new URL(calls[0]!.url);
    expect(listUrl.searchParams.get('pageToken')).toBe('page-1');
    expect(listUrl.searchParams.get('maxResults')).toBe('1000');
    expect(requested).toEqual(['tasks.read', 'tasks.read', 'tasks.write', 'tasks.write', 'tasks.write']);
  });

  it('uses write capability for reordering and omits hierarchy parameters when moving to first top-level position', async () => {
    const requested: string[] = [];
    const calls: CapturedCall[] = [];
    const service = new GoogleTasksService(makeOAuth(requested, calls, () => ({ id: 'task-1', title: 'Review Kanban' })));

    await expect(service.moveTask('list-1', 'task-1')).resolves.toMatchObject({ id: 'task-1' });
    expect(requested).toEqual(['tasks.write']);
    expect(new URL(calls[0]!.url).search).toBe('');
  });
});
