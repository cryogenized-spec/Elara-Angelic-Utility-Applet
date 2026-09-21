import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env, reset } from 'cloudflare:test';
import { deriveInstallationId, internalWakeMarker } from '../../src/autonomy/protocol';
import { TOKEN, signedWrite } from './helpers';

const ORIGIN = 'https://cryogenized-spec.github.io';
const REDIRECT_URI = `${ORIGIN}/clickup/oauth/callback`;

beforeEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

async function stub() {
  const installationId = await deriveInstallationId(TOKEN);
  return env.CLICKUP_OAUTH!.get(env.CLICKUP_OAUTH!.idFromName(installationId));
}

async function doFetch(request: Request): Promise<Response> {
  return (await stub()).fetch(request);
}

async function connect() {
  const startBody = JSON.stringify({ redirectUri: REDIRECT_URI });
  const started = await doFetch(await signedWrite('/clickup/oauth/start', startBody));
  expect(started.status).toBe(200);
  const { state } = await started.json() as { state: string };
  const exchangeBody = JSON.stringify({ code: 'one-time-code', state, redirectUri: REDIRECT_URI });
  const exchanged = await doFetch(await signedWrite('/clickup/oauth/exchange', exchangeBody));
  expect(exchanged.status).toBe(200);
}

async function search(argumentsValue: Record<string, unknown>) {
  return doFetch(new Request('https://clickup-oauth-vault/internal/clickup/command', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Elara-Internal': await internalWakeMarker(TOKEN),
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

async function indexSnapshot() {
  return (await stub() as DurableObjectStub & {
    taskIndexSnapshot(workspaceId: string): Promise<{
      fullSyncComplete: boolean;
      nextPage: number;
      lastRefreshAt: number;
      lastProviderUpdatedAt: number;
      indexedTasks: number;
      oldestIndexedAt?: number;
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
    const firstBody = await first.json() as Record<string, any>;
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
    expect((await withSubtasks.json() as Record<string, any>).result.tasks.map((task: Record<string, unknown>) => task.id)).toEqual([
      'task-repair',
      'task-subtask',
    ]);

    const withoutSubtasks = await search({ workspaceId: '999', query: 'repair', includeSubtasks: false });
    expect((await withoutSubtasks.json() as Record<string, any>).result.tasks.map((task: Record<string, unknown>) => task.id)).toEqual([
      'task-repair',
    ]);

    const withClosed = await search({ workspaceId: '999', query: 'repair', includeClosed: true });
    expect((await withClosed.json() as Record<string, any>).result.tasks.map((task: Record<string, unknown>) => task.id)).toContain('task-closed');

    await forceRefreshAt(0);
    const refreshed = await search({ workspaceId: '999', query: 'trigger' });
    const refreshedBody = await refreshed.json() as Record<string, any>;
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
    const response = await search({ workspaceId: 'not-authorized', query: 'repair' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'workspace_forbidden' }));
    expect(taskCalls).toBe(0);
  });
});
