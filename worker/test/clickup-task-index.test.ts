import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env, evictAllDurableObjects, reset } from 'cloudflare:test';
import { deriveInstallationId, internalWakeMarker } from '../../src/autonomy/protocol';
import { CLICKUP_GRANT_REVISION_HEADER } from '../../src/clickup/mcp-protocol';
import { TOKEN, signedWrite } from './helpers';

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

beforeEach(() => {
  vi.restoreAllMocks();
  grantRevision = 0;
});

afterEach(async () => {
  // Drain in-flight DO/RPC work while the provider mock is still available,
  // then clear persisted state. This avoids workerd tearing down a live
  // callback when the test file or isolated storage is destroyed.
  await evictAllDurableObjects();
  await reset();
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

async function search(argumentsValue: Record<string, unknown>) {
  return doFetch(new Request('https://clickup-oauth-vault/internal/clickup/command', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Elara-Internal': await internalWakeMarker(TOKEN),
      [CLICKUP_GRANT_REVISION_HEADER]: String(grantRevision),
    },
    body: JSON.stringify({ operation: 'searchTaskIndex', arguments: argumentsValue }),
  }));
}

async function forceRefreshAt(value: number) {
  return (await stub() as DurableObjectStub & {
    forceTaskIndexRefreshAt(workspaceId: string, value: number): Promise<void>;
  }).forceTaskIndexRefreshAt('999', value);
}

async function forceIndexedAt(value: number) {
  return (await stub() as DurableObjectStub & {
    forceTaskIndexIndexedAt(workspaceId: string, value: number): Promise<void>;
  }).forceTaskIndexIndexedAt('999', value);
}

async function taskJsonLength(taskId: string) {
  return (await stub() as DurableObjectStub & {
    taskJsonLength(workspaceId: string, taskId: string): Promise<number | null>;
  }).taskJsonLength('999', taskId);
}

async function indexSnapshot() {
  return (await stub() as DurableObjectStub & {
    taskIndexSnapshot(workspaceId: string): Promise<{
      fullSyncComplete: boolean;
      nextPage: number;
      lastRefreshAt: number;
      lastProviderUpdatedAt: number;
      indexedTasks: number;
      oldestIndexedAt?: number;
      incrementalSince?: number;
      incrementalNextPage?: number;
      incrementalMaxUpdatedAt?: number;
    }>;
  }).taskIndexSnapshot('999');
}

describe('ClickUp durable task index', () => {
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
