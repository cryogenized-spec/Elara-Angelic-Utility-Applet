import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env, reset } from 'cloudflare:test';
import { deriveInstallationId, internalWakeMarker, newNonce, signWrite } from '../../src/autonomy/protocol';
import { TOKEN, bearerRead, signedWrite } from './helpers';

const ORIGIN = 'https://cryogenized-spec.github.io';
const REDIRECT_URI = `${ORIGIN}/clickup/oauth/callback`;
const TOKEN_ENDPOINT = 'https://api.clickup.com/api/v2/oauth/token';
const USER_ENDPOINT = 'https://api.clickup.com/api/v2/user';
const WORKSPACES_ENDPOINT = 'https://api.clickup.com/api/v2/team';

beforeEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function stub() {
  const installationId = await deriveInstallationId(TOKEN);
  return env.CLICKUP_OAUTH!.get(env.CLICKUP_OAUTH!.idFromName(installationId));
}

async function doFetch(request: Request): Promise<Response> {
  return (await stub()).fetch(request);
}

type Counters = { token: number; user: number; teams: number; task: number };

function mockProvider(options: { taskStatus?: number; taskRemaining?: number } = {}): Counters {
  const counters: Counters = { token: 0, user: 0, teams: 0, task: 0 };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);

    if (request.url === TOKEN_ENDPOINT && request.method === 'POST') {
      counters.token += 1;
      expect(await request.clone().json()).toEqual({
        client_id: 'test-clickup-client-id',
        client_secret: 'unit-test-clickup-client-secret-value',
        code: expect.any(String),
      });
      return new Response(JSON.stringify({ access_token: 'clickup-access-token-never-returned' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (request.url === USER_ENDPOINT && request.method === 'GET') {
      counters.user += 1;
      expect(request.headers.get('Authorization')).toBe('Bearer clickup-access-token-never-returned');
      return new Response(JSON.stringify({
        user: { id: 183, username: 'Gareth', email: 'gareth@example.com' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (request.url === WORKSPACES_ENDPOINT && request.method === 'GET') {
      counters.teams += 1;
      return new Response(JSON.stringify({
        teams: [{
          id: '999',
          name: 'Neon Sales',
          members: [{ user: { id: 183, username: 'Gareth', email: 'gareth@example.com' } }],
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (request.url.startsWith('https://api.clickup.com/api/v2/task/86task') && request.method === 'GET') {
      counters.task += 1;
      const status = options.taskStatus ?? 200;
      const headers = new Headers({
        'content-type': 'application/json',
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': String(options.taskRemaining ?? 99),
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
      });
      return new Response(status === 200
        ? JSON.stringify({ id: '86task', name: 'Repair S56' })
        : JSON.stringify({ ECODE: 'OAUTH_019', err: 'Token not found' }), { status, headers });
    }

    throw new Error(`Unexpected ClickUp provider request: ${request.method} ${request.url}`);
  });
  return counters;
}

async function start(): Promise<{ state: string; authorizationUrl: string }> {
  const body = JSON.stringify({ redirectUri: REDIRECT_URI });
  const response = await doFetch(await signedWrite('/clickup/oauth/start', body));
  expect(response.status).toBe(200);
  return await response.json() as { state: string; authorizationUrl: string };
}

async function exchange(state: string, code = 'one-time-code'): Promise<Response> {
  const body = JSON.stringify({ code, state, redirectUri: REDIRECT_URI });
  return doFetch(await signedWrite('/clickup/oauth/exchange', body));
}

async function internalCommand(command: unknown): Promise<Response> {
  return doFetch(new Request('https://clickup-oauth-vault/internal/clickup/command', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Elara-Internal': await internalWakeMarker(TOKEN),
    },
    body: JSON.stringify(command),
  }));
}

async function credentialSnapshot() {
  return (await stub() as DurableObjectStub & {
    credentialSnapshot(): Promise<{
      accessCipher: string;
      accessIv: string;
      userId: string;
      username: string | null;
      email: string | null;
      workspacesJson: string;
      updatedAt: number;
    } | null>;
  }).credentialSnapshot();
}

async function rateLimitSnapshot() {
  return (await stub() as DurableObjectStub & {
    rateLimitSnapshot(): Promise<{ limit: number | null; remaining: number | null; resetAt: number | null } | null>;
  }).rateLimitSnapshot();
}

describe('ClickUpOAuthVault', () => {
  it('creates a one-time official authorization URL and stores only encrypted access material after exchange', async () => {
    const provider = mockProvider();
    const begun = await start();
    const url = new URL(begun.authorizationUrl);
    expect(url.origin + url.pathname).toBe('https://app.clickup.com/api');
    expect(url.searchParams.get('client_id')).toBe('test-clickup-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe(begun.state);

    const result = await exchange(begun.state);
    expect(result.status).toBe(200);
    const body = await result.json() as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({
      connected: true,
      account: { id: '183', username: 'Gareth', email: 'gareth@example.com' },
    }));
    expect(JSON.stringify(body)).not.toContain('clickup-access-token-never-returned');
    expect(provider.token).toBe(1);
    expect(provider.user).toBe(1);
    expect(provider.teams).toBe(1);

    const snapshot = await credentialSnapshot();
    expect(snapshot?.accessCipher).toBeTruthy();
    expect(snapshot?.accessCipher).not.toContain('clickup-access-token-never-returned');
    expect(snapshot?.accessIv).toBeTruthy();
    expect(snapshot?.userId).toBe('183');

    const status = await doFetch(await bearerRead('/clickup/oauth/status'));
    expect(await status.json()).toEqual(expect.objectContaining({ connected: true }));
  });

  it('rejects OAuth state replay before another token exchange', async () => {
    const provider = mockProvider();
    const begun = await start();
    expect((await exchange(begun.state, 'first-code')).status).toBe(200);
    const replay = await exchange(begun.state, 'second-code');
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual(expect.objectContaining({ code: 'oauth_state' }));
    expect(provider.token).toBe(1);
  });

  it('rejects replay of a signed OAuth start request', async () => {
    const body = JSON.stringify({ redirectUri: REDIRECT_URI });
    const timestamp = Date.now();
    const nonce = newNonce();
    const signature = await signWrite(TOKEN, 'POST', '/clickup/oauth/start', timestamp, nonce, body);
    expect((await doFetch(await signedWrite('/clickup/oauth/start', body, { timestamp, nonce, signature }))).status).toBe(200);
    const replay = await doFetch(await signedWrite('/clickup/oauth/start', body, { timestamp, nonce, signature }));
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual(expect.objectContaining({ code: 'replayed-nonce' }));
  });

  it('requires the binding-internal marker for provider execution', async () => {
    const response = await doFetch(new Request('https://clickup-oauth-vault/internal/clickup/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'getTask', arguments: { taskId: '86task' } }),
    }));
    expect(response.status).toBe(401);
  });

  it('learns the provider rate window and blocks the next call locally when remaining reaches zero', async () => {
    const provider = mockProvider({ taskRemaining: 0 });
    const begun = await start();
    expect((await exchange(begun.state)).status).toBe(200);

    const first = await internalCommand({ operation: 'getTask', arguments: { taskId: '86task' } });
    expect(first.status).toBe(200);
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({ limit: 100, remaining: 0 }));

    const second = await internalCommand({ operation: 'getTask', arguments: { taskId: '86task' } });
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual(expect.objectContaining({ code: 'rate_limited' }));
    expect(provider.task).toBe(1);
  });

  it('deletes the durable grant when ClickUp reports a revoked token', async () => {
    mockProvider({ taskStatus: 401 });
    const begun = await start();
    expect((await exchange(begun.state)).status).toBe(200);
    expect(await credentialSnapshot()).not.toBeNull();

    const failed = await internalCommand({ operation: 'getTask', arguments: { taskId: '86task' } });
    expect(failed.status).toBe(401);
    expect(await credentialSnapshot()).toBeNull();

    const status = await doFetch(await bearerRead('/clickup/oauth/status'));
    expect(await status.json()).toEqual({ connected: false, workspaces: [] });
  });

  it('disconnects locally without pretending ClickUp revoked the provider grant', async () => {
    mockProvider();
    const begun = await start();
    expect((await exchange(begun.state)).status).toBe(200);

    const disconnected = await doFetch(await signedWrite('/clickup/oauth/disconnect', '{}'));
    expect(disconnected.status).toBe(200);
    expect(await disconnected.json()).toEqual({ disconnected: true, providerRevoked: false });
    expect(await credentialSnapshot()).toBeNull();
  });
});
