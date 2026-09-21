import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SELF, env, reset } from 'cloudflare:test';
import { deriveInstallationId, internalWakeMarker } from '../../src/autonomy/protocol';
import { TOKEN, signedWrite } from './helpers';

const ORIGIN = 'https://cryogenized-spec.github.io';
const REDIRECT_URI = `${ORIGIN}/clickup/oauth/callback`;
const WEBHOOK_ID = '7fa3ec74-69a8-4530-a251-8a13730bd204';
const WEBHOOK_SECRET = 'unit-test-clickup-webhook-secret';

beforeEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

async function stub() {
  const installationId = await deriveInstallationId(TOKEN);
  return env.CLICKUP_OAUTH!.get(env.CLICKUP_OAUTH!.idFromName(installationId));
}

async function connectThroughPublicWorker() {
  const startBody = JSON.stringify({ redirectUri: REDIRECT_URI });
  const started = await SELF.fetch(await signedWrite('/clickup/oauth/start', startBody));
  expect(started.status).toBe(200);
  const { state } = await started.json() as { state: string };
  const exchangeBody = JSON.stringify({ code: 'one-time-code', state, redirectUri: REDIRECT_URI });
  const exchanged = await SELF.fetch(await signedWrite('/clickup/oauth/exchange', exchangeBody));
  expect(exchanged.status).toBe(200);
}

async function internalSearch() {
  return (await stub()).fetch(new Request('https://clickup-oauth-vault/internal/clickup/command', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Elara-Internal': await internalWakeMarker(TOKEN),
    },
    body: JSON.stringify({
      operation: 'searchTaskIndex',
      arguments: { workspaceId: '999', query: 'repair' },
    }),
  }));
}

async function indexSnapshot() {
  return (await stub() as DurableObjectStub & {
    taskIndexSnapshot(workspaceId: string): Promise<{
      fullSyncComplete: boolean;
      nextPage: number;
      lastRefreshAt: number;
      lastProviderUpdatedAt: number;
      indexedTasks: number;
    }>;
  }).taskIndexSnapshot('999');
}

async function signWebhook(body: string, secret = WEBHOOK_SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('ClickUp signed webhook cache invalidation', () => {
  it('registers a Worker-derived callback and uses signed task events only as cache invalidation signals', async () => {
    let webhookCreateCalls = 0;
    let taskListCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'provider-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183, username: 'Gareth' } }), {
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
          teams: [{ id: '999', name: 'Neon Sales', members: [] }],
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
      if (url.pathname === '/api/v2/team/999/webhook' && request.method === 'POST') {
        webhookCreateCalls += 1;
        expect(request.headers.get('Authorization')).toBe('Bearer provider-token');
        expect(await request.clone().json()).toEqual(expect.objectContaining({
          endpoint: 'https://worker.example/clickup/webhook',
          events: expect.arrayContaining(['taskCreated', 'taskUpdated', 'taskDeleted', 'taskMoved']),
        }));
        return new Response(JSON.stringify({
          webhook: {
            id: WEBHOOK_ID,
            endpoint: 'https://worker.example/clickup/webhook',
            secret: WEBHOOK_SECRET,
          },
        }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '97',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
          },
        });
      }
      if (url.pathname === '/api/v2/team/999/task' && request.method === 'GET') {
        taskListCalls += 1;
        return new Response(JSON.stringify({
          tasks: [{
            id: 'task-repair',
            name: 'Repair S56',
            markdown_description: 'Inspect trigger pin.',
            date_updated: '1790000000000',
            archived: false,
            status: { status: 'open', type: 'custom' },
            assignees: [],
            list: { id: '123', name: 'Repairs' },
            folder: { id: '456', name: 'Workshop' },
            space: { id: '789' },
          }],
        }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '96',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
          },
        });
      }

      throw new Error(`Unexpected provider request: ${request.method} ${request.url}`);
    });

    await connectThroughPublicWorker();
    expect(webhookCreateCalls).toBe(1);

    const warmed = await internalSearch();
    expect(warmed.status).toBe(200);
    expect(taskListCalls).toBe(1);
    const before = await indexSnapshot();
    expect(before.indexedTasks).toBe(1);
    expect(before.lastRefreshAt).toBeGreaterThan(0);

    const payload = JSON.stringify({
      event: 'taskUpdated',
      task_id: 'task-repair',
      webhook_id: WEBHOOK_ID,
      history_items: [{ id: 'history-1', date: '1790000005000', field: 'name' }],
    });
    const response = await SELF.fetch('https://worker.example/clickup/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': await signWebhook(payload),
      },
      body: payload,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    expect((await indexSnapshot()).lastRefreshAt).toBe(0);

    const replay = await SELF.fetch('https://worker.example/clickup/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': await signWebhook(payload),
      },
      body: payload,
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ accepted: true, duplicate: true });
  });

  it('rejects bad signatures without mutating index freshness', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/api/v2/oauth/token') return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
      if (url.pathname === '/api/v2/user') return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200 });
      if (url.pathname === '/api/v2/team') return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), { status: 200 });
      if (url.pathname === '/api/v2/team/999/webhook') {
        return new Response(JSON.stringify({ webhook: { id: WEBHOOK_ID, secret: WEBHOOK_SECRET } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team/999/task') {
        return new Response(JSON.stringify({ tasks: [] }), { status: 200 });
      }
      throw new Error(`Unexpected provider request: ${request.url}`);
    });

    await connectThroughPublicWorker();
    await internalSearch();
    const before = await indexSnapshot();

    const payload = JSON.stringify({
      event: 'taskUpdated',
      task_id: 'task-repair',
      webhook_id: WEBHOOK_ID,
      history_items: [{ id: 'history-bad' }],
    });
    const response = await SELF.fetch('https://worker.example/clickup/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': await signWebhook(payload, 'wrong-secret'),
      },
      body: payload,
    });

    expect(response.status).toBe(401);
    expect((await indexSnapshot()).lastRefreshAt).toBe(before.lastRefreshAt);
  });

  it('evicts a deleted task immediately without trusting webhook task content', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/api/v2/oauth/token') return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
      if (url.pathname === '/api/v2/user') return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200 });
      if (url.pathname === '/api/v2/team') return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), { status: 200 });
      if (url.pathname === '/api/v2/team/999/webhook') {
        return new Response(JSON.stringify({ webhook: { id: WEBHOOK_ID, secret: WEBHOOK_SECRET } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team/999/task') {
        return new Response(JSON.stringify({
          tasks: [{ id: 'task-repair', name: 'Repair S56', date_updated: '1790000000000', status: { status: 'open' } }],
        }), { status: 200 });
      }
      throw new Error(`Unexpected provider request: ${request.url}`);
    });

    await connectThroughPublicWorker();
    await internalSearch();
    expect((await indexSnapshot()).indexedTasks).toBe(1);

    const payload = JSON.stringify({
      event: 'taskDeleted',
      task_id: 'task-repair',
      webhook_id: WEBHOOK_ID,
    });
    const response = await SELF.fetch('https://worker.example/clickup/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': await signWebhook(payload),
      },
      body: payload,
    });

    expect(response.status).toBe(200);
    expect((await indexSnapshot()).indexedTasks).toBe(0);
  });
});
