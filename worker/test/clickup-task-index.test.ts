import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { deriveInstallationId, internalWakeMarker } from '../../src/autonomy/protocol';
import { CLICKUP_GRANT_REVISION_HEADER } from '../../src/clickup/mcp-protocol';
import { TOKEN, resetClickUpTestState, signedWrite } from './helpers';

const ORIGIN = 'https://cryogenized-spec.github.io';
const REDIRECT_URI = `${ORIGIN}/clickup/oauth/callback`;
let grantRevision = 0;

type TaskSearchPayload = {
  readonly result: {
    readonly tasks: readonly Record<string, unknown>[];
    readonly index: Record<string, unknown>;
  };
};

async function taskSearchPayload(response: Response): Promise<TaskSearchPayload> {
  const value = await response.json() as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected ClickUp search response object.');
  const result = (value as Record<string, unknown>).result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected ClickUp search result object.');
  const resultRecord = result as Record<string, unknown>;
  if (!Array.isArray(resultRecord.tasks) || !resultRecord.index || typeof resultRecord.index !== 'object' || Array.isArray(resultRecord.index)) {
    throw new Error('Expected ClickUp search tasks and index.');
  }
  const tasks = resultRecord.tasks as unknown[];
  return {
    result: {
      tasks: tasks.map((task) => {
        if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error('Expected indexed task object.');
        return task as Record<string, unknown>;
      }),
      index: resultRecord.index as Record<string, unknown>,
    },
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  grantRevision = 0;
  await resetClickUpTestState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function stub() {
  const installationId = await deriveInstallationId(TOKEN);
  return env.CLICKUP_OAUTH!.get(env.CLICKUP_OAUTH!.idFromName(installationId));
}

async function doFetch(request: Request): Promise<Response> {
  const remote = await (await stub()).fetch(request);
  const body = await remote.arrayBuffer();
  return new Response(body, {
    status: remote.status,
    statusText: remote.statusText,
    headers: remote.headers,
  });
}

async function connect() {
  const startBody = JSON.stringify({ redirectUri: REDIRECT_URI });
  const started = await doFetch(await signedWrite('/clickup/oauth/start', startBody));
  expect(started.status).toBe(200);
  const { state } = await started.json() as { state: string };
  const exchangeBody = JSON.stringify({ code: 'one-time-code', state, redirectUri: REDIRECT_URI });
  const exchanged = await doFetch(await signedWrite('/clickup/oauth/exchange', exchangeBody));
  expect(exchanged.status).toBe(200);
  const status = await exchanged.json() as { updatedAt?: number };
  grantRevision = status.updatedAt ?? 0;
  expect(grantRevision).toBeGreaterThan(0);
}

async function internalCommand(command: unknown) {
  return doFetch(new Request('https://clickup-oauth-vault/internal/clickup/command', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Elara-Internal': await internalWakeMarker(TOKEN),
      [CLICKUP_GRANT_REVISION_HEADER]: String(grantRevision),
    },
    body: JSON.stringify(command),
  }));
}

async function search(argumentsValue: Record<string, unknown>) {
  return internalCommand({ operation: 'searchTaskIndex', arguments: argumentsValue });
}

async function materializedSearch(argumentsValue: Record<string, unknown>): Promise<{
  status: number;
  payload: TaskSearchPayload;
}> {
  const response = await search(argumentsValue);
  return {
    status: response.status,
    payload: await taskSearchPayload(response),
  };
}

async function harnessFetch(path: string, init?: RequestInit): Promise<Response> {
  return doFetch(new Request(`https://clickup-oauth-vault${path}`, init));
}

async function forceRefreshAt(value: number) {
  const response = await harnessFetch('/__test/clickup/task-index/refresh-at', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId: '999', value }),
  });
  expect(response.status).toBe(200);
}

async function forceIndexedAt(value: number) {
  const response = await harnessFetch('/__test/clickup/task-index/indexed-at', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId: '999', value }),
  });
  expect(response.status).toBe(200);
}

async function seedTombstone(workspaceId: string, taskId: string) {
  const response = await harnessFetch('/__test/clickup/task-index/tombstone', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId, taskId }),
  });
  expect(response.status).toBe(200);
}

async function tombstoneCount(workspaceId: string): Promise<number> {
  const response = await harnessFetch(`/__test/clickup/task-index/tombstones?workspaceId=${encodeURIComponent(workspaceId)}`);
  expect(response.status).toBe(200);
  const body = await response.json() as { count: number };
  return body.count;
}

async function clearWorkspaceIndex(workspaceId: string) {
  const response = await harnessFetch('/__test/clickup/task-index/clear-workspace', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId }),
  });
  expect(response.status).toBe(200);
}

async function taskJsonLength(taskId: string): Promise<number | null> {
  const response = await harnessFetch(
    `/__test/clickup/task-json-length?workspaceId=999&taskId=${encodeURIComponent(taskId)}`,
  );
  expect(response.status).toBe(200);
  const body = await response.json() as { length: number | null };
  return body.length;
}

async function indexSnapshot(): Promise<{
  fullSyncComplete: boolean;
  nextPage: number;
  lastRefreshAt: number;
  lastProviderUpdatedAt: number;
  indexedTasks: number;
  incrementalSince: number;
  incrementalNextPage: number;
  incrementalMaxUpdatedAt: number;
}> {
  const response = await harnessFetch('/__test/clickup/task-index?workspaceId=999');
  expect(response.status).toBe(200);
  return await response.json() as {
    fullSyncComplete: boolean;
    nextPage: number;
    lastRefreshAt: number;
    lastProviderUpdatedAt: number;
    indexedTasks: number;
    incrementalSince: number;
    incrementalNextPage: number;
    incrementalMaxUpdatedAt: number;
  };
}

describe('ClickUp durable task index', () => {
  it('purges Workspace-scoped deletion tombstones when that Workspace index authority is cleared', async () => {
    await seedTombstone('999', 'task-old-grant');
    await seedTombstone('998', 'task-other-workspace');
    expect(await tombstoneCount('999')).toBe(1);
    expect(await tombstoneCount('998')).toBe(1);

    await clearWorkspaceIndex('999');

    expect(await tombstoneCount('999')).toBe(0);
    expect(await tombstoneCount('998')).toBe(1);
  });


  it('warms once, serves repeated searches locally, and incrementally refreshes stale indexes', async () => {
    let workspaceTaskCalls = 0;
    const providerRequests: URL[] = [];
    const firstUpdatedAt = 1_790_000_000_000;
    const secondUpdatedAt = firstUpdatedAt + 60_000;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'secret-clickup-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183, username: 'Gareth', email: 'gareth@example.com' } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '99',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
          },
        });
      }

      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({
          teams: [{
            id: '999',
            name: 'Neon Sales',
            members: [{ user: { id: 183, username: 'Gareth', email: 'gareth@example.com' } }],
          }],
        }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '98',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
          },
        });
      }

      if (url.pathname === '/api/v2/team/999/task') {
        workspaceTaskCalls += 1;
        providerRequests.push(url);
        const incremental = url.searchParams.has('date_updated_gt');
        const tasks = incremental
          ? [{
              id: 'task-repair',
              name: 'Repair S56 — updated',
              markdown_description: 'Trigger pin inspection completed.',
              date_updated: String(secondUpdatedAt),
              archived: false,
              parent: null,
              status: { status: 'in progress', type: 'custom' },
              assignees: [{ id: 183, username: 'Gareth' }],
              list: { id: '123', name: 'Repairs' },
              folder: { id: '456', name: 'Workshop' },
              space: { id: '789' },
            }]
          : [{
              id: 'task-repair',
              name: 'Repair S56',
              markdown_description: 'Inspect trigger pin.',
              date_updated: String(firstUpdatedAt),
              archived: false,
              parent: null,
              status: { status: 'open', type: 'custom' },
              assignees: [{ id: 183, username: 'Gareth' }],
              list: { id: '123', name: 'Repairs' },
              folder: { id: '456', name: 'Workshop' },
              space: { id: '789' },
            }, {
              id: 'task-subtask',
              name: 'Repair magazine',
              markdown_description: 'Subtask detail.',
              date_updated: String(firstUpdatedAt - 1_000),
              archived: false,
              parent: 'task-repair',
              status: { status: 'open', type: 'custom' },
              assignees: [],
              list: { id: '123', name: 'Repairs' },
              folder: { id: '456', name: 'Workshop' },
              space: { id: '789' },
            }, {
              id: 'task-closed',
              name: 'Repair archived unit',
              markdown_description: 'Already complete.',
              date_updated: String(firstUpdatedAt - 2_000),
              date_closed: String(firstUpdatedAt - 1_000),
              archived: false,
              parent: null,
              status: { status: 'complete', type: 'closed' },
              assignees: [],
              list: { id: '123', name: 'Repairs' },
              folder: { id: '456', name: 'Workshop' },
              space: { id: '789' },
            }];

        return new Response(JSON.stringify({ tasks }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': String(95 - workspaceTaskCalls),
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
          },
        });
      }

      throw new Error(`Unexpected ClickUp provider request: ${request.method} ${request.url}`);
    });

    await connect();

    const first = await search({ workspaceId: '999', query: 'repair' });
    expect(first.status).toBe(200);
    const firstBody = await taskSearchPayload(first);
    expect(firstBody.result.index).toEqual(expect.objectContaining({
      mode: 'persistent-sqlite',
      indexedTasks: 3,
      fullSyncComplete: true,
    }));
    expect(firstBody.result.tasks.map((task: Record<string, unknown>) => task.id)).toEqual([
      'task-repair',
    ]);
    expect(workspaceTaskCalls).toBe(1);

    const second = await search({ workspaceId: '999', query: 'repair' });
    expect(second.status).toBe(200);
    expect(workspaceTaskCalls).toBe(1);

    const withSubtasks = await search({ workspaceId: '999', query: 'repair', includeSubtasks: true });
    expect((await taskSearchPayload(withSubtasks)).result.tasks.map((task: Record<string, unknown>) => task.id)).toEqual([
      'task-repair',
      'task-subtask',
    ]);

    const withoutSubtasks = await search({ workspaceId: '999', query: 'repair', includeSubtasks: false });
    expect((await taskSearchPayload(withoutSubtasks)).result.tasks.map((task: Record<string, unknown>) => task.id)).toEqual([
      'task-repair',
    ]);

    const withClosed = await search({ workspaceId: '999', query: 'repair', includeClosed: true });
    expect((await taskSearchPayload(withClosed)).result.tasks.map((task: Record<string, unknown>) => task.id)).toContain('task-closed');

    await forceRefreshAt(0);
    const refreshed = await search({ workspaceId: '999', query: 'trigger' });
    const refreshedBody = await taskSearchPayload(refreshed);
    expect(workspaceTaskCalls).toBe(2);
    expect(providerRequests[1]?.searchParams.get('date_updated_gt')).toBeTruthy();
    expect(refreshedBody.result.tasks[0]).toEqual(expect.objectContaining({
      id: 'task-repair',
      name: 'Repair S56 — updated',
    }));

    expect(await indexSnapshot()).toEqual(expect.objectContaining({
      fullSyncComplete: true,
      indexedTasks: 3,
      lastProviderUpdatedAt: secondUpdatedAt,
    }));

    // Even with webhook + incremental refresh, periodically rebuild the full
    // snapshot so a missed delete/archive cannot remain cached indefinitely.
    await forceIndexedAt(Date.now() - (7 * 60 * 60_000));
    await forceRefreshAt(0);
    const reconciled = await search({ workspaceId: '999', query: 'repair' });
    expect(reconciled.status).toBe(200);
    expect(workspaceTaskCalls).toBe(3);
    expect(providerRequests[2]?.searchParams.has('date_updated_gt')).toBe(false);
  });

  it('invalidates the cached task projection after a Custom Field write', async () => {
    let customFieldValue = 'Before';
    let taskUpdatedAt = 1_790_000_000_000;
    let workspaceTaskCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'secret-clickup-token' }), { status: 200 });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183, username: 'Gareth' } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), { status: 200 });
      }
      const task = () => ({
        id: 'task-repair',
        name: 'Repair S56',
        date_updated: String(taskUpdatedAt),
        archived: false,
        parent: null,
        status: { status: 'open', type: 'custom' },
        list: { id: '123', name: 'Repairs' },
        folder: { id: '456', name: 'Workshop' },
        space: { id: '789' },
        custom_fields: [{ id: 'field_1', name: 'Repair state', type: 'short_text', value: customFieldValue }],
      });
      if (url.pathname === '/api/v2/team/999/task' && request.method === 'GET') {
        workspaceTaskCalls += 1;
        return new Response(JSON.stringify({ tasks: [task()] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.pathname === '/api/v2/task/task-repair' && request.method === 'GET') {
        return new Response(JSON.stringify({ ...task(), team_id: '999' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.pathname === '/api/v2/list/123/field' && request.method === 'GET') {
        return new Response(JSON.stringify({
          fields: [{ id: 'field_1', name: 'Repair state', type: 'short_text' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/task/task-repair/field/field_1' && request.method === 'POST') {
        customFieldValue = 'Ready';
        taskUpdatedAt += 1_000;
        return new Response(JSON.stringify({ id: 'hist-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected ClickUp provider request: ${request.method} ${request.url}`);
    });

    await connect();

    const first = await materializedSearch({ workspaceId: '999', query: 'Repair', limit: 20 });
    expect(first.status).toBe(200);
    const firstFields = first.payload.result.tasks[0]?.custom_fields as Array<Record<string, unknown>>;
    expect(firstFields[0]?.value).toBe('Before');
    expect(workspaceTaskCalls).toBe(1);

    const mutation = await doFetch(new Request('https://clickup-oauth-vault/internal/clickup/command', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Elara-Internal': await internalWakeMarker(TOKEN),
        [CLICKUP_GRANT_REVISION_HEADER]: String(grantRevision),
      },
      body: JSON.stringify({
        operation: 'setCustomField',
        workspaceId: '999',
        taskId: 'task-repair',
        fieldId: 'field_1',
        value: 'Ready',
      }),
    }));
    expect(mutation.status).toBe(200);

    const second = await materializedSearch({ workspaceId: '999', query: 'Repair', limit: 20 });
    expect(second.status).toBe(200);
    const secondFields = second.payload.result.tasks[0]?.custom_fields as Array<Record<string, unknown>>;
    expect(secondFields[0]?.value).toBe('Ready');
    expect(workspaceTaskCalls).toBeGreaterThan(1);
  });

  it('persists hostile provider tasks below the hard 64k projection ceiling', async () => {
    const hostile = 'x'.repeat(20_000);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/api/v2/oauth/token') return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
      if (url.pathname === '/api/v2/user') return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200 });
      if (url.pathname === '/api/v2/team') return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), { status: 200 });
      if (url.pathname === '/api/v2/team/999/task') {
        return new Response(JSON.stringify({
          tasks: [{
            id: 'hostile-task',
            name: 'Hostile but valid task',
            date_updated: '1790000000000',
            status: { status: hostile, type: hostile },
            priority: { id: '1', priority: hostile },
            assignees: [{ id: 183, username: hostile, email: `${'a'.repeat(10_000)}@example.com`, extra: hostile }],
            tags: [{ name: hostile, extra: hostile }],
            list: { id: '123', name: hostile, extra: hostile },
            folder: { id: '456', name: hostile, extra: hostile },
            space: { id: '789', name: hostile, extra: hostile },
            custom_fields: [{ id: 'field-1', name: hostile, type: hostile, value: { nested: hostile } }],
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected provider request: ${request.url}`);
    });

    await connect();
    const response = await search({ workspaceId: '999', query: 'hostile' });
    expect(response.status).toBe(200);
    expect(await taskJsonLength('hostile-task')).not.toBeNull();
    expect(await taskJsonLength('hostile-task')).toBeLessThanOrEqual(64_000);
  });

  it('persists incremental continuation without advancing the durable watermark until every page is consumed', async () => {
    const initialUpdatedAt = 1_790_000_000_000;
    const changedUpdatedAt = initialUpdatedAt + 60_000;
    const seenPages: number[] = [];
    let incremental = false;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/api/v2/oauth/token') return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
      if (url.pathname === '/api/v2/user') return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200 });
      if (url.pathname === '/api/v2/team') return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), { status: 200 });
      if (url.pathname === '/api/v2/team/999/task') {
        const page = Number(url.searchParams.get('page') ?? '0');
        if (!url.searchParams.has('date_updated_gt')) {
          return new Response(JSON.stringify({
            tasks: [{ id: 'initial', name: 'Initial', date_updated: String(initialUpdatedAt), status: { status: 'open' } }],
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }

        incremental = true;
        seenPages.push(page);
        if (page < 3) {
          const tasks = Array.from({ length: 100 }, (_, index) => ({
            id: `page-${page}-task-${index}`,
            name: `changed page ${page} item ${index}`,
            date_updated: String(changedUpdatedAt + page * 1_000 + index),
            status: { status: 'open' },
          }));
          return new Response(JSON.stringify({ tasks }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          tasks: [{ id: 'late-target', name: 'Needle task', date_updated: String(changedUpdatedAt + 99_999), status: { status: 'open' } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected provider request: ${request.url}`);
    });

    await connect();
    expect((await search({ workspaceId: '999', query: 'initial' })).status).toBe(200);
    await forceRefreshAt(0);

    const firstPass = await search({ workspaceId: '999', query: 'needle' });
    expect(firstPass.status).toBe(200);
    expect(incremental).toBe(true);
    expect(seenPages).toEqual([0, 1, 2]);
    expect((await taskSearchPayload(firstPass)).result.tasks).toEqual([]);
    expect(await indexSnapshot()).toEqual(expect.objectContaining({
      lastProviderUpdatedAt: initialUpdatedAt,
      incrementalNextPage: 3,
    }));
    expect((await indexSnapshot()).incrementalSince).toBeGreaterThan(0);

    const secondPass = await search({ workspaceId: '999', query: 'needle' });
    expect(secondPass.status).toBe(200);
    expect(seenPages).toEqual([0, 1, 2, 3]);
    expect((await taskSearchPayload(secondPass)).result.tasks).toEqual([
      expect.objectContaining({ id: 'late-target' }),
    ]);
    expect(await indexSnapshot()).toEqual(expect.objectContaining({
      incrementalSince: 0,
      incrementalNextPage: 0,
      lastProviderUpdatedAt: changedUpdatedAt + 99_999,
    }));
  });

  it('purges cached Workspace tasks and authorization metadata when refresh is denied', async () => {
    let deny = false;
    let taskCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/api/v2/oauth/token') return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
      if (url.pathname === '/api/v2/user') return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200 });
      if (url.pathname === '/api/v2/team') return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), { status: 200 });
      if (url.pathname === '/api/v2/team/999/task') {
        taskCalls += 1;
        if (deny) return new Response(JSON.stringify({ ECODE: 'ACCESS_403', err: 'Forbidden' }), { status: 403 });
        return new Response(JSON.stringify({
          tasks: [{ id: 'cached-task', name: 'Cached repair', date_updated: '1790000000000', status: { status: 'open' } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected provider request: ${request.url}`);
    });

    await connect();
    expect((await search({ workspaceId: '999', query: 'cached' })).status).toBe(200);
    expect((await indexSnapshot()).indexedTasks).toBe(1);

    deny = true;
    await forceRefreshAt(0);
    const denied = await search({ workspaceId: '999', query: 'cached' });
    expect(denied.status).toBe(403);
    expect((await indexSnapshot()).indexedTasks).toBe(0);

    const deniedAgain = await search({ workspaceId: '999', query: 'cached' });
    expect(deniedAgain.status).toBe(401);
    expect(await deniedAgain.json()).toEqual(expect.objectContaining({ code: 'authorization_required' }));
    expect(taskCalls).toBe(2);
  });

  it('removes tasks omitted from the periodic full reconciliation snapshot', async () => {
    let reconciled = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/api/v2/oauth/token') return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
      if (url.pathname === '/api/v2/user') return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200 });
      if (url.pathname === '/api/v2/team') return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), { status: 200 });
      if (url.pathname === '/api/v2/team/999/task') {
        const tasks = reconciled
          ? [{ id: 'survivor', name: 'Survivor', date_updated: '1790000001000', status: { status: 'open' } }]
          : [
              { id: 'survivor', name: 'Survivor', date_updated: '1790000000000', status: { status: 'open' } },
              { id: 'removed-task', name: 'Removed task', date_updated: '1790000000000', status: { status: 'open' } },
            ];
        return new Response(JSON.stringify({ tasks }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected provider request: ${request.url}`);
    });

    await connect();
    expect((await search({ workspaceId: '999', query: 'removed' })).status).toBe(200);
    expect((await indexSnapshot()).indexedTasks).toBe(2);

    reconciled = true;
    await forceIndexedAt(Date.now() - (7 * 60 * 60_000));
    await forceRefreshAt(0);
    const after = await search({ workspaceId: '999', query: 'removed' });
    expect(after.status).toBe(200);
    expect((await taskSearchPayload(after)).result.tasks).toEqual([]);
    expect((await indexSnapshot()).indexedTasks).toBe(1);
  });

  it('keeps the completed live index searchable until a >500-task full reconciliation atomically commits', async () => {
    let mode: 'initial' | 'reconcile' = 'initial';
    const providerPages: Array<{ mode: string; page: number }> = [];

    const pageTasks = (prefix: string, page: number, count: number, includeLegacyNeedle = false) =>
      Array.from({ length: count }, (_, index) => {
        const ordinal = page * 100 + index;
        return {
          id: includeLegacyNeedle && page === 5 && index === 50 ? 'legacy-needle-task' : `${prefix}-${ordinal}`,
          name: includeLegacyNeedle && page === 5 && index === 50 ? 'Legacy needle retained until swap' : `${prefix} task ${ordinal}`,
          date_updated: String(1_790_000_000_000 + ordinal),
          status: { status: 'open' },
        };
      });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/api/v2/oauth/token') return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
      if (url.pathname === '/api/v2/user') return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200 });
      if (url.pathname === '/api/v2/team') return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), { status: 200 });
      if (url.pathname === '/api/v2/team/999/task') {
        expect(url.searchParams.has('date_updated_gt')).toBe(false);
        const page = Number(url.searchParams.get('page') ?? '0');
        providerPages.push({ mode, page });
        if (page < 6) {
          return new Response(JSON.stringify({
            tasks: pageTasks(mode === 'initial' ? 'old' : 'new', page, 100, mode === 'initial'),
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          tasks: pageTasks(mode === 'initial' ? 'old' : 'new', page, 1, mode === 'initial'),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected provider request: ${request.url}`);
    });

    await connect();

    // Cold warm-up is deliberately bounded to five pages per call.
    const firstWarm = await search({ workspaceId: '999', query: 'legacy needle' });
    expect(firstWarm.status).toBe(200);
    expect((await taskSearchPayload(firstWarm)).result.tasks).toEqual([]);
    expect(await indexSnapshot()).toEqual(expect.objectContaining({
      fullSyncComplete: false,
      indexedTasks: 500,
      nextPage: 5,
    }));

    const completedWarm = await search({ workspaceId: '999', query: 'legacy needle' });
    expect(completedWarm.status).toBe(200);
    expect((await taskSearchPayload(completedWarm)).result.tasks).toEqual([
      expect.objectContaining({ id: 'legacy-needle-task' }),
    ]);
    expect(await indexSnapshot()).toEqual(expect.objectContaining({
      fullSyncComplete: true,
      indexedTasks: 601,
    }));

    mode = 'reconcile';
    await forceIndexedAt(Date.now() - (7 * 60 * 60_000));
    await forceRefreshAt(0);

    // The first reconciliation pass stages only pages 0-4. The old completed
    // live snapshot must remain searchable until the full provider walk ends.
    const staged = await search({ workspaceId: '999', query: 'legacy needle' });
    expect(staged.status).toBe(200);
    const stagedBody = await taskSearchPayload(staged);
    expect(stagedBody.result.tasks).toEqual([
      expect.objectContaining({ id: 'legacy-needle-task' }),
    ]);
    expect(stagedBody.result.index).toEqual(expect.objectContaining({
      indexedTasks: 601,
      fullSyncComplete: true,
      refreshIncomplete: true,
    }));
    expect(providerPages.slice(-5)).toEqual([
      { mode: 'reconcile', page: 0 },
      { mode: 'reconcile', page: 1 },
      { mode: 'reconcile', page: 2 },
      { mode: 'reconcile', page: 3 },
      { mode: 'reconcile', page: 4 },
    ]);

    // Continuation finishes pages 5-6 and atomically swaps the new snapshot.
    const committed = await search({ workspaceId: '999', query: 'legacy needle' });
    expect(committed.status).toBe(200);
    expect((await taskSearchPayload(committed)).result.tasks).toEqual([]);
    expect(providerPages.slice(-2)).toEqual([
      { mode: 'reconcile', page: 5 },
      { mode: 'reconcile', page: 6 },
    ]);
    expect(await indexSnapshot()).toEqual(expect.objectContaining({
      fullSyncComplete: true,
      indexedTasks: 601,
    }));
  });

  it('lets concurrent searches adopt a peer full-reconciliation commit instead of returning a false conflict', async () => {
    let reconcile = false;
    let reconcileCalls = 0;
    let bothStarted!: () => void;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const bothStartedPromise = new Promise<void>((resolve) => { bothStarted = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/api/v2/oauth/token') return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
      const rateHeaders = {
        'content-type': 'application/json',
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '90',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 600),
      };
      if (url.pathname === '/api/v2/user') return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200, headers: rateHeaders });
      if (url.pathname === '/api/v2/team') return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), { status: 200, headers: rateHeaders });
      if (url.pathname === '/api/v2/team/999/task') {
        if (!reconcile) {
          return new Response(JSON.stringify({
            tasks: [{ id: 'old-task', name: 'Old needle', date_updated: '1790000000000', status: { status: 'open' } }],
          }), { status: 200, headers: rateHeaders });
        }

        reconcileCalls += 1;
        const ordinal = reconcileCalls;
        if (reconcileCalls === 2) bothStarted();
        await (ordinal === 1 ? firstGate : secondGate);
        return new Response(JSON.stringify({
          tasks: [{ id: 'new-task', name: 'New needle', date_updated: '1790000100000', status: { status: 'open' } }],
        }), { status: 200, headers: rateHeaders });
      }
      throw new Error(`Unexpected provider request: ${request.url}`);
    });

    await connect();
    expect((await search({ workspaceId: '999', query: 'old needle' })).status).toBe(200);
    reconcile = true;
    await forceIndexedAt(Date.now() - (7 * 60 * 60_000));
    await forceRefreshAt(0);

    const first = materializedSearch({ workspaceId: '999', query: 'new needle' });
    const second = materializedSearch({ workspaceId: '999', query: 'new needle' });
    await bothStartedPromise;

    releaseFirst();
    const firstResult = await first;
    expect(firstResult.status).toBe(200);
    expect(firstResult.payload.result.tasks).toEqual([
      expect.objectContaining({ id: 'new-task' }),
    ]);

    releaseSecond();
    const secondResult = await second;
    expect(secondResult.status).toBe(200);
    expect(secondResult.payload.result.tasks).toEqual([
      expect.objectContaining({ id: 'new-task' }),
    ]);
    expect(reconcileCalls).toBe(2);
  });

  it('keeps the previous complete snapshot after a mid-reconciliation provider failure', async () => {
    let reconcile = false;
    let failPageOne = true;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/api/v2/oauth/token') return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
      if (url.pathname === '/api/v2/user') return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200 });
      if (url.pathname === '/api/v2/team') return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), { status: 200 });
      if (url.pathname === '/api/v2/team/999/task') {
        const page = Number(url.searchParams.get('page') ?? '0');
        if (!reconcile) {
          return new Response(JSON.stringify({
            tasks: [{ id: 'stable-live-task', name: 'Stable live needle', date_updated: '1790000000000', status: { status: 'open' } }],
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (page === 0) {
          return new Response(JSON.stringify({
            tasks: Array.from({ length: 100 }, (_, index) => ({
              id: `replacement-${index}`,
              name: `Replacement ${index}`,
              date_updated: String(1_790_000_100_000 + index),
              status: { status: 'open' },
            })),
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (page === 1 && failPageOne) {
          return new Response(JSON.stringify({ err: 'provider failed during reconciliation' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({
          tasks: [{ id: 'replacement-final', name: 'Replacement final', date_updated: '1790000200000', status: { status: 'open' } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected provider request: ${request.url}`);
    });

    await connect();
    const warm = await search({ workspaceId: '999', query: 'stable live needle' });
    expect(warm.status).toBe(200);
    expect((await taskSearchPayload(warm)).result.tasks).toEqual([
      expect.objectContaining({ id: 'stable-live-task' }),
    ]);
    expect((await indexSnapshot()).indexedTasks).toBe(1);

    reconcile = true;
    await forceIndexedAt(Date.now() - (7 * 60 * 60_000));
    await forceRefreshAt(0);

    const interrupted = await search({ workspaceId: '999', query: 'stable live needle' });
    expect(interrupted.status).toBe(200);
    const interruptedBody = await taskSearchPayload(interrupted);
    expect(interruptedBody.result.tasks).toEqual([
      expect.objectContaining({ id: 'stable-live-task' }),
    ]);
    expect(interruptedBody.result.index).toEqual(expect.objectContaining({
      indexedTasks: 1,
      fullSyncComplete: true,
      refreshIncomplete: true,
      refreshError: {
        code: 'http-500',
        message: 'ClickUp is temporarily unavailable.',
      },
    }));
    expect((await indexSnapshot()).indexedTasks).toBe(1);

    failPageOne = false;
    const recovered = await search({ workspaceId: '999', query: 'stable live needle' });
    expect(recovered.status).toBe(200);
    expect((await taskSearchPayload(recovered)).result.tasks).toEqual([]);
    expect(await indexSnapshot()).toEqual(expect.objectContaining({
      fullSyncComplete: true,
      indexedTasks: 101,
    }));
  });

  it('invalidates cached task evidence before and after a Custom Field write', async () => {
    let fieldWriteStarted = false;
    const resetAt = Math.floor(Date.now() / 1000) + 600;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'token-prewrite-invalidation' }), { status: 200 });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183 } }), {
          status: 200,
          headers: {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '99',
            'X-RateLimit-Reset': String(resetAt),
          },
        });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), {
          status: 200,
          headers: {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '98',
            'X-RateLimit-Reset': String(resetAt),
          },
        });
      }
      if (url.pathname === '/api/v2/team/999/task' && request.method === 'GET') {
        return new Response(JSON.stringify({
          tasks: [{
            id: 'task-field',
            name: 'Cached custom field task',
            date_updated: '1790000000000',
            status: { status: 'open' },
            list: { id: '123', name: 'Repairs' },
            space: { id: '789' },
            custom_fields: [{ id: 'field-1', name: 'State', type: 'short_text', value: 'old' }],
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/task/task-field' && request.method === 'GET') {
        return new Response(JSON.stringify({
          id: 'task-field',
          name: 'Cached custom field task',
          team_id: '999',
          list: { id: '123', name: 'Repairs' },
          space: { id: '789' },
          custom_fields: [{ id: 'field-1', name: 'State', type: 'short_text', value: 'old' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/list/123/field' && request.method === 'GET') {
        return new Response(JSON.stringify({
          fields: [{ id: 'field-1', name: 'State', type: 'short_text' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/task/task-field/field/field-1' && request.method === 'POST') {
        fieldWriteStarted = true;
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
        return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`Unexpected provider request: ${request.method} ${request.url}`);
    });

    await connect();
    expect((await search({ workspaceId: '999', query: 'cached custom field' })).status).toBe(200);
    expect(await indexSnapshot()).toEqual(expect.objectContaining({
      indexedTasks: 1,
      fullSyncComplete: true,
    }));

    const pendingWrite = internalCommand({
      operation: 'setCustomField',
      workspaceId: '999',
      taskId: 'task-field',
      fieldId: 'field-1',
      value: 'new',
    });

    for (let attempt = 0; attempt < 100 && !fieldWriteStarted; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
    expect(fieldWriteStarted).toBe(true);

    // The provider write is still in flight, but the pre-write snapshot must
    // already be unavailable and marked stale. A crash at this point therefore
    // cannot resurrect the old Custom Field value as "current" evidence.
    expect(await indexSnapshot()).toEqual(expect.objectContaining({
      indexedTasks: 0,
      lastRefreshAt: 0,
    }));

    // Simulate the exact race from the adversarial review: while ClickUp is
    // still processing the write, another search refreshes the old provider
    // representation and marks it fresh under the post-prewrite generation.
    const staleRefresh = await search({ workspaceId: '999', query: 'cached custom field' });
    expect(staleRefresh.status).toBe(200);
    expect(await indexSnapshot()).toEqual(expect.objectContaining({
      indexedTasks: 1,
      fullSyncComplete: true,
    }));

    expect((await pendingWrite).status).toBe(200);

    // The mutation outcome performs a second invalidation, so the snapshot
    // fetched during the write cannot survive as fresh evidence afterward.
    expect(await indexSnapshot()).toEqual(expect.objectContaining({
      indexedTasks: 0,
      lastRefreshAt: 0,
    }));
  });

  it('re-invalidates a stale refresh that completes while a Custom Field mutation is in flight', async () => {
    let fieldWriteStarted = false;
    let customFieldValue = 'old';
    let workspaceTaskCalls = 0;
    const resetAt = Math.floor(Date.now() / 1000) + 600;
    const rateHeaders = {
      'content-type': 'application/json',
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '90',
      'X-RateLimit-Reset': String(resetAt),
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'token-mutation-refresh-race' }), { status: 200 });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200, headers: rateHeaders });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), {
          status: 200,
          headers: rateHeaders,
        });
      }
      if (url.pathname === '/api/v2/team/999/task' && request.method === 'GET') {
        workspaceTaskCalls += 1;
        return new Response(JSON.stringify({
          tasks: [{
            id: 'task-race',
            name: 'Mutation refresh race',
            date_updated: customFieldValue === 'old' ? '1790000000000' : '1790000001000',
            status: { status: 'open' },
            list: { id: '123', name: 'Repairs' },
            space: { id: '789' },
            custom_fields: [{ id: 'field-1', name: 'State', type: 'short_text', value: customFieldValue }],
          }],
        }), { status: 200, headers: rateHeaders });
      }
      if (url.pathname === '/api/v2/task/task-race' && request.method === 'GET') {
        return new Response(JSON.stringify({
          id: 'task-race',
          name: 'Mutation refresh race',
          team_id: '999',
          list: { id: '123', name: 'Repairs' },
          space: { id: '789' },
          custom_fields: [{ id: 'field-1', name: 'State', type: 'short_text', value: customFieldValue }],
        }), { status: 200, headers: rateHeaders });
      }
      if (url.pathname === '/api/v2/list/123/field' && request.method === 'GET') {
        return new Response(JSON.stringify({
          fields: [{ id: 'field-1', name: 'State', type: 'short_text' }],
        }), { status: 200, headers: rateHeaders });
      }
      if (url.pathname === '/api/v2/task/task-race/field/field-1' && request.method === 'POST') {
        fieldWriteStarted = true;
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
        customFieldValue = 'new';
        return new Response(JSON.stringify({}), { status: 200, headers: rateHeaders });
      }

      throw new Error(`Unexpected provider request: ${request.method} ${request.url}`);
    });

    await connect();
    const warm = await materializedSearch({ workspaceId: '999', query: 'mutation refresh race' });
    expect(warm.status).toBe(200);
    expect((warm.payload.result.tasks[0]?.custom_fields as Array<Record<string, unknown>>)[0]?.value).toBe('old');

    const pendingWrite = internalCommand({
      operation: 'setCustomField',
      workspaceId: '999',
      taskId: 'task-race',
      fieldId: 'field-1',
      value: 'new',
    });
    for (let attempt = 0; attempt < 100 && !fieldWriteStarted; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
    expect(fieldWriteStarted).toBe(true);

    // The pre-write invalidation lets this search refresh while ClickUp still
    // exposes the old value. This is the exact interleaving the second
    // invalidation must neutralize.
    const during = await materializedSearch({ workspaceId: '999', query: 'mutation refresh race' });
    expect((during.payload.result.tasks[0]?.custom_fields as Array<Record<string, unknown>>)[0]?.value).toBe('old');
    expect(workspaceTaskCalls).toBeGreaterThanOrEqual(2);

    expect((await pendingWrite).status).toBe(200);
    expect(await indexSnapshot()).toEqual(expect.objectContaining({
      indexedTasks: 0,
      lastRefreshAt: 0,
    }));

    const after = await materializedSearch({ workspaceId: '999', query: 'mutation refresh race' });
    expect((after.payload.result.tasks[0]?.custom_fields as Array<Record<string, unknown>>)[0]?.value).toBe('new');
  });

  it('does not lose an older assignee match behind the 1,000-row search candidate ceiling', async () => {
    let taskCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'token-assignee-candidate-limit' }), { status: 200 });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({
          teams: [{
            id: '999',
            name: 'Neon Sales',
            members: [{ user: { id: 183, username: 'Gareth' } }, { user: { id: 456, username: 'Other' } }],
          }],
        }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team/999/task' && request.method === 'GET') {
        taskCalls += 1;
        const page = Number(url.searchParams.get('page') ?? '0');
        const count = page < 10 ? 100 : 2;
        const tasks = Array.from({ length: count }, (_, index) => {
          const ordinal = page * 100 + index;
          const isNeedle = page === 10 && index === 1;
          return {
            id: isNeedle ? 'old-assignee-needle' : `bulk-${ordinal}`,
            name: isNeedle ? 'Repair needle assigned to Gareth' : `Repair bulk task ${ordinal}`,
            // Keep the desired assignee match older than the first 1,000
            // candidates when ordered by updated_at DESC.
            date_updated: String(isNeedle ? 1_000 : 2_000_000 + ordinal),
            status: { status: 'open' },
            assignees: [{ id: isNeedle ? 183 : 456, username: isNeedle ? 'Gareth' : 'Other' }],
            list: { id: '123', name: 'Repairs' },
            space: { id: '789' },
          };
        });
        return new Response(JSON.stringify({ tasks }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected provider request: ${request.method} ${request.url}`);
    });

    await connect();

    // Cold index hydration is capped at five provider pages per search.
    expect((await search({ workspaceId: '999', query: 'repair', includeSubtasks: true, includeClosed: true })).status).toBe(200);
    expect((await indexSnapshot()).indexedTasks).toBe(500);

    expect((await search({ workspaceId: '999', query: 'repair', includeSubtasks: true, includeClosed: true })).status).toBe(200);
    expect((await indexSnapshot()).indexedTasks).toBe(1_000);

    expect((await search({ workspaceId: '999', query: 'repair', includeSubtasks: true, includeClosed: true })).status).toBe(200);
    expect(await indexSnapshot()).toEqual(expect.objectContaining({
      indexedTasks: 1_002,
      fullSyncComplete: true,
    }));

    const beforeFilteredCalls = taskCalls;
    const filtered = await search({
      workspaceId: '999',
      query: 'repair',
      includeSubtasks: true,
      includeClosed: true,
      assigneeIds: ['183'],
      limit: 20,
    });
    expect(filtered.status).toBe(200);
    expect((await taskSearchPayload(filtered)).result.tasks).toEqual([
      expect.objectContaining({ id: 'old-assignee-needle' }),
    ]);
    expect(taskCalls).toBe(beforeFilteredCalls);
  });

  it('rejects search for a Workspace outside the OAuth grant before provider egress', async () => {
    let taskCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/api/v2/oauth/token') return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
      if (url.pathname === '/api/v2/user') return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200 });
      if (url.pathname === '/api/v2/team') return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), { status: 200 });
      if (url.pathname.includes('/task')) taskCalls += 1;
      throw new Error(`Unexpected provider request: ${request.url}`);
    });

    await connect();
    const response = await search({ workspaceId: '998', query: 'repair' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'workspace_forbidden' }));
    expect(taskCalls).toBe(0);
  });

  it('rejects malformed semantic search arguments without escaping the Durable Object boundary', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/api/v2/oauth/token') return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
      if (url.pathname === '/api/v2/user') return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200 });
      if (url.pathname === '/api/v2/team') return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), { status: 200 });
      throw new Error(`Malformed semantic input must not reach ClickUp: ${request.url}`);
    });

    await connect();
    const response = await search({ workspaceId: 'not-authorized', query: 'repair' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'validation' }));
  });
});
