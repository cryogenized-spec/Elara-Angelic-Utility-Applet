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
          const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
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

  it('preserves the literal provider due date instead of timezone-shifting date-only task semantics', async () => {
    const requested: string[] = [];
    const calls: CapturedCall[] = [];
    const service = new GoogleTasksService(makeOAuth(requested, calls, () => ({
      id: 'task-offset',
      title: 'External client task',
      due: '2026-01-05T23:30:00.000-05:00',
      status: 'needsAction',
    })));

    await expect(service.getTask('list-1', 'task-offset')).resolves.toMatchObject({
      id: 'task-offset',
      scheduledDate: '2026-01-05',
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

    await expect(service.listTaskLists('page-1', 100)).resolves.toMatchObject({ nextPageToken: 'next-list' });
    await expect(service.getTaskList('list-1')).resolves.toMatchObject({ id: 'list-1', title: 'Life' });
    await expect(service.createTaskList('Projects')).resolves.toMatchObject({ title: 'Projects' });
    await expect(service.updateTaskList('list-1', 'Projects 2026')).resolves.toMatchObject({ title: 'Projects 2026' });
    await expect(service.deleteTaskList('list-1')).resolves.toBeUndefined();

    const listUrl = new URL(calls[0]!.url);
    expect(listUrl.searchParams.get('pageToken')).toBe('page-1');
    expect(listUrl.searchParams.get('maxResults')).toBe('100');
    expect(requested).toEqual(['tasks.read', 'tasks.read', 'tasks.write', 'tasks.write', 'tasks.write']);
  });

  it('rejects task-list page sizes above 100 without making a provider fetch', async () => {
    const requested: string[] = [];
    const calls: CapturedCall[] = [];
    const service = new GoogleTasksService(makeOAuth(requested, calls, () => ({ items: [] })));

    await expect(service.listTaskLists(undefined, 101)).rejects.toThrow(/integer from 1 to 100/i);
    expect(calls).toEqual([]);
  });

  it('uses write capability for reordering and omits hierarchy parameters when moving to first top-level position', async () => {
    const requested: string[] = [];
    const calls: CapturedCall[] = [];
    const service = new GoogleTasksService(makeOAuth(requested, calls, () => ({ id: 'task-1', title: 'Review Kanban' })));

    await expect(service.moveTask('list-1', 'task-1')).resolves.toMatchObject({ id: 'task-1' });
    expect(requested).toEqual(['tasks.write']);
    expect(new URL(calls[0]!.url).search).toBe('');
  });

  it('maps semantic cross-list moves to the provider destinationTasklist query parameter', async () => {
    const requested: string[] = [];
    const calls: CapturedCall[] = [];
    const service = new GoogleTasksService(makeOAuth(requested, calls, () => ({ id: 'task-1', title: 'Review Kanban' })));

    await expect(service.moveTask('list-1', 'task-1', 'parent-2', 'previous-2', 'list-2')).resolves.toMatchObject({ id: 'task-1' });

    const url = new URL(calls[0]!.url);
    expect(requested).toEqual(['tasks.write']);
    expect(url.searchParams.get('destinationTasklist')).toBe('list-2');
    expect(url.searchParams.get('parent')).toBe('parent-2');
    expect(url.searchParams.get('previous')).toBe('previous-2');
  });
});


describe('kanban writes', () => {
  it('patches only edited fields with If-Match and preserves response metadata', async () => {
    let received: RequestInit | undefined;
    const oauth = makeOAuth([], [], () => ({}));
    oauth.authorize = async (capability) => ({ capability, fetch: async (_url, init) => {
      received = init;
      return new Response(JSON.stringify({ id: 't', title: '', etag: 'next', completed: '2026-09-18', hidden: true }));
    } });
    const result = await new GoogleTasksService(oauth).updateSemanticTask({ taskListId: 'list', taskId: 't', notes: 'Updated', etag: 'original' });
    expect(received?.method).toBe('PATCH');
    expect(new Headers(received?.headers).get('If-Match')).toBe('original');
    expect(JSON.parse(String(received?.body))).toEqual({ notes: 'Updated' });
    expect(result).toMatchObject({ title: '', etag: 'next', hidden: true });
  });
  it('surfaces conflicts without retrying or overwriting', async () => {
    const oauth = makeOAuth([], [], () => ({}));
    let calls = 0;
    oauth.authorize = async (capability) => ({ capability, fetch: async () => { calls++; return new Response('', { status: 412 }); } });
    await expect(new GoogleTasksService(oauth).updateSemanticTask({ taskListId: 'list', taskId: 'task', title: 'Mine', etag: 'stale' })).rejects.toThrow('changed in Google');
    expect(calls).toBe(1);
  });
  it('validates new list titles before authorization', async () => {
    const requested: string[] = [];
    await expect(new GoogleTasksService(makeOAuth(requested, [], () => ({}))).createTaskList('   ')).rejects.toThrow('title');
    expect(requested).toEqual([]);
  });
});

describe('task-list management', () => {
  it('renames only the title using PATCH with the original ETag', async () => {
    let request: RequestInit | undefined;
    let path = '';
    const oauth = makeOAuth([], [], () => ({}));
    oauth.authorize = async (capability) => ({ capability, fetch: async (url, init) => { path = String(url); request = init; return new Response(JSON.stringify({ id: 'list/a', title: 'Next' })); } });
    await new GoogleTasksService(oauth).updateTaskList('list/a', ' Next ', 'original');
    expect(path).toContain('/users/@me/lists/list%2Fa');
    expect(request?.method).toBe('PATCH');
    expect(new Headers(request?.headers).get('If-Match')).toBe('original');
    expect(JSON.parse(String(request?.body))).toEqual({ title: 'Next' });
  });
  it('handles 204 list deletions without parsing JSON', async () => {
    let request: RequestInit | undefined;
    const oauth = makeOAuth([], [], () => ({}));
    oauth.authorize = async (capability) => ({ capability, fetch: async (_url, init) => { request = init; return new Response(null, { status: 204 }); } });
    await expect(new GoogleTasksService(oauth).deleteTaskList('list', 'original')).resolves.toBeUndefined();
    expect(request?.method).toBe('DELETE');
    expect(new Headers(request?.headers).get('If-Match')).toBe('original');
  });
  it('rejects empty list identifiers before requesting OAuth', async () => {
    const requested: string[] = [];
    await expect(new GoogleTasksService(makeOAuth(requested, [], () => ({}))).deleteTaskList(' ')).rejects.toThrow('required');
    expect(requested).toEqual([]);
  });
});
