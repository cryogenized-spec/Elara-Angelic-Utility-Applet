import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { deriveInstallationId, internalWakeMarker } from '../../src/autonomy/protocol';
import { CLICKUP_GRANT_REVISION_HEADER } from '../../src/clickup/mcp-protocol';
import { TOKEN, resetClickUpTestState, signedWrite } from './helpers';

const ORIGIN = 'https://cryogenized-spec.github.io';
const REDIRECT_URI = `${ORIGIN}/clickup/oauth/callback`;
const WEBHOOK_ID = '7fa3ec74-69a8-4530-a251-8a13730bd204';
const WEBHOOK_SECRET = 'unit-test-clickup-webhook-secret';
let grantRevision = 0;

beforeEach(async () => {
  vi.restoreAllMocks();
  grantRevision = 0;
  await resetClickUpTestState();
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

async function harnessFetch(path: string): Promise<Response> {
  return doFetch(new Request(`https://clickup-oauth-vault${path}`));
}

async function webhookSnapshot(): Promise<Array<{ webhookId: string; workspaceId: string; updatedAt: number }>> {
  const response = await harnessFetch('/__test/clickup/webhooks');
  expect(response.status).toBe(200);
  return await response.json() as Array<{ webhookId: string; workspaceId: string; updatedAt: number }>;
}

async function credentialSnapshot(): Promise<{ userId: string; updatedAt: number } | null> {
  const response = await harnessFetch('/__test/clickup/credential');
  expect(response.status).toBe(200);
  const body = await response.json() as {
    userId: string;
    updatedAt: number;
  } | null;
  return body ? { userId: body.userId, updatedAt: body.updatedAt } : null;
}

async function indexSnapshot(): Promise<{
  fullSyncComplete: boolean;
  nextPage: number;
  lastRefreshAt: number;
  lastProviderUpdatedAt: number;
  indexedTasks: number;
  invalidationGeneration: number;
}> {
  const response = await harnessFetch('/__test/clickup/task-index?workspaceId=999');
  expect(response.status).toBe(200);
  return await response.json() as {
    fullSyncComplete: boolean;
    nextPage: number;
    lastRefreshAt: number;
    lastProviderUpdatedAt: number;
    indexedTasks: number;
    invalidationGeneration: number;
  };
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

  it('does not let a slow old disconnect delete a reconnect that completes during webhook cleanup', async () => {
    let oldDeleteStarted = false;
    let oldDeleteCalls = 0;
    let newWebhookCreates = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const auth = request.headers.get('Authorization') ?? '';

      if (url.pathname === '/api/v2/oauth/token') {
        const body = await request.clone().json() as { code?: string };
        return new Response(JSON.stringify({
          access_token: body.code === 'grant-b' ? 'token-b' : 'token-a',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/user') {
        const isB = auth.endsWith('token-b');
        return new Response(JSON.stringify({
          user: { id: isB ? 456 : 183, username: isB ? 'Replacement' : 'Original' },
        }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({
          teams: [{ id: '999', name: 'Neon Sales', members: [] }],
        }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team/999/webhook' && request.method === 'POST') {
        const isB = auth.endsWith('token-b');
        if (isB) newWebhookCreates += 1;
        return new Response(JSON.stringify({
          webhook: {
            id: isB ? 'webhook-b' : 'webhook-a',
            secret: isB ? 'secret-b' : WEBHOOK_SECRET,
          },
        }), { status: 200 });
      }
      if (url.pathname === '/api/v2/webhook/webhook-a' && request.method === 'DELETE') {
        oldDeleteCalls += 1;
        oldDeleteStarted = true;
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
        return new Response('{}', { status: 200 });
      }
      if (url.pathname === '/api/v2/webhook/webhook-b' && request.method === 'DELETE') {
        return new Response('{}', { status: 200 });
      }

      throw new Error(`Unexpected provider request: ${request.method} ${request.url}`);
    });

    expect((await connectThroughPublicWorker('grant-a')).status).toBe(200);
    expect((await credentialSnapshot())?.userId).toBe('183');
    expect(await webhookSnapshot()).toEqual([
      expect.objectContaining({ webhookId: 'webhook-a', workspaceId: '999' }),
    ]);

    const pendingDisconnect = SELF.fetch(await signedWrite('/clickup/oauth/disconnect', '{}'));
    for (let attempt = 0; attempt < 100 && !oldDeleteStarted; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
    expect(oldDeleteStarted).toBe(true);

    expect((await connectThroughPublicWorker('grant-b')).status).toBe(200);
    expect((await credentialSnapshot())?.userId).toBe('456');
    expect(await webhookSnapshot()).toEqual([
      expect.objectContaining({ webhookId: 'webhook-b', workspaceId: '999' }),
    ]);

    const disconnected = await pendingDisconnect;
    expect(disconnected.status).toBe(200);
    expect(oldDeleteCalls).toBe(1);
    expect(newWebhookCreates).toBe(1);
    expect((await credentialSnapshot())?.userId).toBe('456');
    expect(await webhookSnapshot()).toEqual([
      expect.objectContaining({ webhookId: 'webhook-b', workspaceId: '999' }),
    ]);
  });

  it('cleans up a webhook created by a superseded exchange after disconnect', async () => {
    let webhookCreateStarted = false;
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
        webhookCreateStarted = true;
        // Suspend in the provider request's own context; do not carry an I/O
        // continuation through a resolver invoked by another Worker request.
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
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
    for (let attempt = 0; attempt < 100 && !webhookCreateStarted; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
    expect(webhookCreateStarted).toBe(true);

    const disconnected = await SELF.fetch(await signedWrite('/clickup/oauth/disconnect', '{}'));
    expect(disconnected.status).toBe(200);
    expect(await credentialSnapshot()).toBeNull();
    expect(await webhookSnapshot()).toEqual([]);

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

  it('does not resurrect a task deleted by webhook while an older refresh page is in flight', async () => {
    let refreshStarted = false;
    let taskCalls = 0;

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
        taskCalls += 1;
        const incremental = url.searchParams.has('date_updated_gt');
        if (incremental) {
          refreshStarted = true;
          await new Promise<void>((resolve) => setTimeout(resolve, 200));
        }
        return new Response(JSON.stringify({
          tasks: [{
            id: 'task-repair',
            name: incremental ? 'STALE_PROVIDER_COPY' : 'Repair S56',
            date_updated: incremental ? '1790000005000' : '1790000000000',
            status: { status: 'open' },
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected provider request: ${request.url}`);
    });

    await connectThroughPublicWorker();
    expect((await internalSearch()).status).toBe(200);
    expect((await indexSnapshot()).indexedTasks).toBe(1);

    const staleResponse = await harnessFetch('/__test/clickup/task-index/refresh-at', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: '999', value: 0 }),
    });
    expect(staleResponse.status).toBe(200);

    const pendingRefresh = internalSearch();
    for (let attempt = 0; attempt < 100 && !refreshStarted; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
    expect(refreshStarted).toBe(true);

    const generationBeforeDelete = (await indexSnapshot()).invalidationGeneration;
    const payload = JSON.stringify({
      event: 'taskDeleted',
      task_id: 'task-repair',
      webhook_id: WEBHOOK_ID,
      history_items: [{ id: 'history-delete-race' }],
    });
    const webhook = await SELF.fetch('https://worker.example/clickup/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': await signWebhook(payload),
      },
      body: payload,
    });
    expect(webhook.status).toBe(200);
    expect((await indexSnapshot()).indexedTasks).toBe(0);
    expect((await indexSnapshot()).invalidationGeneration).toBeGreaterThan(generationBeforeDelete);

    const refresh = await pendingRefresh;
    expect([200, 409]).toContain(refresh.status);
    expect((await indexSnapshot()).indexedTasks).toBe(0);
    expect(JSON.stringify(await refresh.clone().json())).not.toContain('STALE_PROVIDER_COPY');
    expect(taskCalls).toBeGreaterThanOrEqual(2);
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
