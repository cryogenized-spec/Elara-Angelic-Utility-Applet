import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SELF, env, reset, runInDurableObject } from 'cloudflare:test';
import { deriveInstallationId, internalWakeMarker } from '../../src/autonomy/protocol';
import { CLICKUP_GRANT_REVISION_HEADER } from '../../src/clickup/mcp-protocol';
import { TOKEN, signedWrite } from './helpers';

const ORIGIN = 'https://cryogenized-spec.github.io';
const REDIRECT_URI = `${ORIGIN}/clickup/oauth/callback`;
const WEBHOOK_ID = '7fa3ec74-69a8-4530-a251-8a13730bd204';
const WEBHOOK_SECRET = 'unit-test-clickup-webhook-secret';
let grantRevision = 0;

beforeEach(async () => {
  vi.restoreAllMocks();
  grantRevision = 0;
  await reset();
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

async function connectThroughPublicWorker(code = 'one-time-code') {
  const startBody = JSON.stringify({ redirectUri: REDIRECT_URI });
  const started = await SELF.fetch(await signedWrite('/clickup/oauth/start', startBody));
  expect(started.status).toBe(200);
  const { state } = await started.json() as { state: string };
  const exchangeBody = JSON.stringify({ code, state, redirectUri: REDIRECT_URI });
  const exchanged = await SELF.fetch(await signedWrite('/clickup/oauth/exchange', exchangeBody));
  if (exchanged.status === 200) {
    const status = await exchanged.clone().json() as { updatedAt?: number };
    grantRevision = status.updatedAt ?? 0;
    expect(grantRevision).toBeGreaterThan(0);
  }
  return exchanged;
}

async function internalSearch() {
  return doFetch(new Request('https://clickup-oauth-vault/internal/clickup/command', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Elara-Internal': await internalWakeMarker(TOKEN),
      [CLICKUP_GRANT_REVISION_HEADER]: String(grantRevision),
    },
    body: JSON.stringify({
      operation: 'searchTaskIndex',
      arguments: { workspaceId: '999', query: 'repair' },
    }),
  }));
}

async function webhookSnapshot() {
  return runInDurableObject(await stub(), async (_instance, state) => {
    return state.storage.sql.exec<{ webhook_id: string; workspace_id: string; updated_at: number }>(
      'SELECT webhook_id, workspace_id, updated_at FROM clickup_webhooks ORDER BY workspace_id ASC',
    ).toArray().map((row) => ({
      webhookId: row.webhook_id,
      workspaceId: row.workspace_id,
      updatedAt: row.updated_at,
    }));
  });
}

async function credentialSnapshot() {
  return runInDurableObject(await stub(), async (_instance, state) => {
    const row = state.storage.sql.exec<{ user_id: string; updated_at: number }>(
      'SELECT user_id, updated_at FROM clickup_oauth_credential WHERE slot = 1',
    ).toArray()[0];
    return row ? { userId: row.user_id, updatedAt: row.updated_at } : null;
  });
}

async function indexSnapshot() {
  return runInDurableObject(await stub(), async (_instance, state) => {
    const row = state.storage.sql.exec<{
      full_sync_complete: number;
      next_page: number;
      last_refresh_at: number;
      last_provider_updated_at: number;
    }>(
      'SELECT full_sync_complete, next_page, last_refresh_at, last_provider_updated_at FROM clickup_task_index_state WHERE workspace_id = ?',
      '999',
    ).toArray()[0];
    const indexedTasks = state.storage.sql.exec<{ count: number }>(
      'SELECT COUNT(*) AS count FROM clickup_task_index WHERE workspace_id = ?',
      '999',
    ).toArray()[0]?.count ?? 0;
    return {
      fullSyncComplete: row?.full_sync_complete === 1,
      nextPage: row?.next_page ?? 0,
      lastRefreshAt: row?.last_refresh_at ?? 0,
      lastProviderUpdatedAt: row?.last_provider_updated_at ?? 0,
      indexedTasks,
    };
  });
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

  it('keeps the old grant and webhook registration intact when a reconnect fails', async () => {
    let deleteCalls = 0;
    let tokenCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (url.pathname === '/api/v2/oauth/token') {
        tokenCalls += 1;
        const body = await request.clone().json() as { code?: string };
        if (body.code === 'bad-code') {
          return new Response(JSON.stringify({ ECODE: 'OAUTH_017', err: 'Bad code' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ access_token: 'provider-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183, username: 'Gareth' } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team/999/webhook' && request.method === 'POST') {
        return new Response(JSON.stringify({
          webhook: { id: WEBHOOK_ID, secret: WEBHOOK_SECRET },
        }), { status: 200 });
      }
      if (url.pathname === `/api/v2/webhook/${WEBHOOK_ID}` && request.method === 'DELETE') {
        deleteCalls += 1;
        return new Response('{}', { status: 200 });
      }
      throw new Error(`Unexpected provider request: ${request.method} ${request.url}`);
    });

    expect((await connectThroughPublicWorker()).status).toBe(200);
    const originalCredential = await credentialSnapshot();
    expect(await webhookSnapshot()).toEqual([
      expect.objectContaining({ webhookId: WEBHOOK_ID, workspaceId: '999' }),
    ]);

    const failedReconnect = await connectThroughPublicWorker('bad-code');
    expect(failedReconnect.status).toBe(400);
    expect(tokenCalls).toBe(2);
    expect(deleteCalls).toBe(0);
    expect(await credentialSnapshot()).toEqual(originalCredential);
    expect(await webhookSnapshot()).toEqual([
      expect.objectContaining({ webhookId: WEBHOOK_ID, workspaceId: '999' }),
    ]);
  });

  it('cleans up a webhook created by a superseded exchange after disconnect', async () => {
    let webhookCreateStarted!: () => void;
    let releaseWebhookCreate!: () => void;
    const webhookCreateStartedPromise = new Promise<void>((resolve) => { webhookCreateStarted = resolve; });
    const releaseWebhookCreatePromise = new Promise<void>((resolve) => { releaseWebhookCreate = resolve; });
    let deleteCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'provider-token' }), { status: 200 });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183, username: 'Gareth' } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Neon Sales', members: [] }] }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team/999/webhook' && request.method === 'POST') {
        webhookCreateStarted();
        await releaseWebhookCreatePromise;
        return new Response(JSON.stringify({
          webhook: { id: WEBHOOK_ID, secret: WEBHOOK_SECRET },
        }), { status: 200 });
      }
      if (url.pathname === `/api/v2/webhook/${WEBHOOK_ID}` && request.method === 'DELETE') {
        deleteCalls += 1;
        return new Response('{}', { status: 200 });
      }
      throw new Error(`Unexpected provider request: ${request.method} ${request.url}`);
    });

    const pendingExchange = connectThroughPublicWorker();
    await webhookCreateStartedPromise;

    const disconnected = await SELF.fetch(await signedWrite('/clickup/oauth/disconnect', '{}'));
    expect(disconnected.status).toBe(200);
    expect(await credentialSnapshot()).toBeNull();
    expect(await webhookSnapshot()).toEqual([]);

    releaseWebhookCreate();
    const exchangeResult = await pendingExchange;
    expect(exchangeResult.status).toBe(409);
    expect(await exchangeResult.json()).toEqual(expect.objectContaining({ code: 'oauth_superseded' }));
    expect(deleteCalls).toBe(1);
    expect(await credentialSnapshot()).toBeNull();
    expect(await webhookSnapshot()).toEqual([]);

    const orphanPayload = JSON.stringify({
      event: 'taskUpdated',
      task_id: 'task-repair',
      webhook_id: WEBHOOK_ID,
      history_items: [{ id: 'history-orphan' }],
    });
    const orphanDelivery = await SELF.fetch('https://worker.example/clickup/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': '0'.repeat(64),
      },
      body: orphanPayload,
    });
    expect(orphanDelivery.status).toBe(200);
    expect(await orphanDelivery.json()).toEqual({ accepted: true, ignored: true });
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
