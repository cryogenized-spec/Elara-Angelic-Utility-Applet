import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { deriveInstallationId, internalWakeMarker, newNonce, signWrite } from '../../src/autonomy/protocol';
import { CLICKUP_GRANT_REVISION_HEADER } from '../../src/clickup/mcp-protocol';
import { TOKEN, bearerRead, resetClickUpTestState, signedWrite } from './helpers';

const ORIGIN = 'https://cryogenized-spec.github.io';
const REDIRECT_URI = `${ORIGIN}/clickup/oauth/callback`;
const TOKEN_ENDPOINT = 'https://api.clickup.com/api/v2/oauth/token';
const USER_ENDPOINT = 'https://api.clickup.com/api/v2/user';
const WORKSPACES_ENDPOINT = 'https://api.clickup.com/api/v2/team';
const PERSONAL_TOKEN = 'pk_dummy';

beforeEach(async () => {
  vi.restoreAllMocks();
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

type Counters = { token: number; user: number; teams: number; task: number };

function mockProvider(options: { taskStatus?: number; taskRemaining?: number } = {}): Counters {
  const counters: Counters = { token: 0, user: 0, teams: 0, task: 0 };
  const resetAt = Math.floor(Date.now() / 1000) + 600;
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
        headers: {
          'content-type': 'application/json',
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': '99',
          'X-RateLimit-Reset': String(resetAt),
        },
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
        headers: {
          'content-type': 'application/json',
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': '98',
          'X-RateLimit-Reset': String(resetAt),
        },
      });
    }

    if (request.url.startsWith('https://api.clickup.com/api/v2/task/86task') && request.method === 'GET') {
      counters.task += 1;
      const status = options.taskStatus ?? 200;
      const headers = new Headers({
        'content-type': 'application/json',
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': String(options.taskRemaining ?? 99),
        'X-RateLimit-Reset': String(resetAt),
      });
      return new Response(status === 200
        ? JSON.stringify({ id: '86task', name: 'Repair S56', team_id: '999', list: { id: '123' }, space: { id: '789' } })
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

async function internalCommand(command: unknown, revision?: number): Promise<Response> {
  const currentRevision = revision ?? (await credentialSnapshot())?.updatedAt ?? 0;
  return doFetch(new Request('https://clickup-oauth-vault/internal/clickup/command', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Elara-Internal': await internalWakeMarker(TOKEN),
      [CLICKUP_GRANT_REVISION_HEADER]: String(currentRevision),
    },
    body: JSON.stringify(command),
  }));
}

async function harnessFetch(path: string): Promise<Response> {
  return doFetch(new Request(`https://clickup-oauth-vault${path}`));
}

async function credentialSnapshot(): Promise<{
  accessCipher: string;
  accessIv: string;
  userId: string;
  username: string | null;
  email: string | null;
  workspacesJson: string;
  updatedAt: number;
} | null> {
  const response = await harnessFetch('/__test/clickup/credential');
  expect(response.status).toBe(200);
  return await response.json() as {
    accessCipher: string;
    accessIv: string;
    userId: string;
    username: string | null;
    email: string | null;
    workspacesJson: string;
    updatedAt: number;
  } | null;
}

async function rateLimitSnapshot(): Promise<{
  limit: number | null;
  remaining: number | null;
  resetAt: number | null;
} | null> {
  const response = await harnessFetch('/__test/clickup/rate-limit');
  expect(response.status).toBe(200);
  return await response.json() as {
    limit: number | null;
    remaining: number | null;
    resetAt: number | null;
  } | null;
}

async function setRateLimitSnapshot(value: {
  limit: number | null;
  remaining: number | null;
  resetAt: number | null;
  unknownProbeInFlight?: boolean;
  updatedAt?: number;
}): Promise<void> {
  const response = await doFetch(new Request('https://clickup-oauth-vault/__test/clickup/rate-limit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  }));
  expect(response.status).toBe(200);
}

describe('ClickUp OAuth public boundary', () => {
  it('rejects oversized OAuth bodies before signature verification or vault buffering', async () => {
    const response = await SELF.fetch('https://worker.example/clickup/oauth/start', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: 'x'.repeat(20 * 1024),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'request_too_large' }));
  });
});

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
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({
      limit: 100,
      remaining: 98,
    }));
    const body = await result.json() as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({
      connected: true,
      account: { id: '183', username: 'Gareth', email: 'gareth@example.com' },
      workspaces: [{ id: '999', name: 'Neon Sales' }],
    }));
    expect(JSON.stringify(body)).not.toContain('members');
    expect(JSON.stringify(body)).not.toContain('clickup-access-token-never-returned');
    expect(provider.token).toBe(1);
    expect(provider.user).toBe(1);
    expect(provider.teams).toBe(1);

    const snapshot = await credentialSnapshot();
    expect(snapshot?.accessCipher).toBeTruthy();
    expect(snapshot?.accessCipher).not.toContain('clickup-access-token-never-returned');
    expect(snapshot?.accessIv).toBeTruthy();
    expect(snapshot?.userId).toBe('183');
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({ limit: 100, remaining: 98 }));

    const contextResponse = await internalCommand({
      operation: 'getWorkspaceAuthorizationContext',
      workspaceId: '999',
    });
    expect(contextResponse.status).toBe(200);
    expect(await contextResponse.json()).toEqual(expect.objectContaining({
      ok: true,
      result: expect.objectContaining({
        id: '999',
        name: 'Neon Sales',
        members: [expect.objectContaining({ id: '183', username: 'Gareth' })],
      }),
    }));
    expect(provider.teams).toBe(2);

    const status = await doFetch(await bearerRead('/clickup/oauth/status'));
    expect(await status.json()).toEqual(expect.objectContaining({ connected: true }));
  });

  it('preserves OAuth credential kind across vault encryption when token text collides with the former marker', async () => {
    const collisionToken = 'elara-clickup-personal-v1:collision-oauth-token';
    let teamCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url === TOKEN_ENDPOINT && request.method === 'POST') {
        return new Response(JSON.stringify({ access_token: collisionToken }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (request.url === USER_ENDPOINT && request.method === 'GET') {
        expect(request.headers.get('Authorization')).toBe(`Bearer ${collisionToken}`);
        return new Response(JSON.stringify({
          user: { id: 183, username: 'Gareth', email: 'gareth@example.com' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (request.url === WORKSPACES_ENDPOINT && request.method === 'GET') {
        teamCalls += 1;
        expect(request.headers.get('Authorization')).toBe(`Bearer ${collisionToken}`);
        return new Response(JSON.stringify({
          teams: [{
            id: '999',
            name: 'Neon Sales',
            members: [{ user: { id: 183, username: 'Gareth', email: 'gareth@example.com' } }],
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected collision-token provider request: ${request.method} ${request.url}`);
    });

    const begun = await start();
    expect((await exchange(begun.state, 'collision-code')).status).toBe(200);
    expect(teamCalls).toBe(1);

    // This second provider call occurs only after the credential has been
    // encrypted, persisted, decrypted and reconstructed by accessGrant().
    const context = await internalCommand({
      operation: 'getWorkspaceAuthorizationContext',
      workspaceId: '999',
    });
    expect(context.status).toBe(200);
    expect(teamCalls).toBe(2);

    const snapshot = await credentialSnapshot();
    expect(snapshot?.accessCipher).toBeTruthy();
    expect(snapshot?.accessCipher).not.toContain(collisionToken);
  });

  it('activates a configured personal API token entirely inside the Worker and stores only encrypted material', async () => {
    let userCalls = 0;
    let workspaceCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url === USER_ENDPOINT && request.method === 'GET') {
        userCalls += 1;
        expect(request.headers.get('Authorization')).toBe(PERSONAL_TOKEN);
        expect(request.headers.get('Authorization')).not.toContain('Bearer ');
        return new Response(JSON.stringify({
          user: { id: 183, username: 'Gareth', email: 'gareth@example.com' },
        }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '99',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 600),
          },
        });
      }
      if (request.url === WORKSPACES_ENDPOINT && request.method === 'GET') {
        workspaceCalls += 1;
        expect(request.headers.get('Authorization')).toBe(PERSONAL_TOKEN);
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
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 600),
          },
        });
      }
      throw new Error(`Unexpected ClickUp personal-token request: ${request.method} ${request.url}`);
    });

    const response = await doFetch(await signedWrite('/clickup/oauth/personal-token', '{}'));
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({
      connected: true,
      account: { id: '183', username: 'Gareth', email: 'gareth@example.com' },
      workspaces: [{ id: '999', name: 'Neon Sales' }],
      connectionMethods: { oauth: true, personalToken: true },
    }));
    expect(JSON.stringify(body)).not.toContain(PERSONAL_TOKEN);
    expect(userCalls).toBe(1);
    expect(workspaceCalls).toBe(1);

    const snapshot = await credentialSnapshot();
    expect(snapshot?.accessCipher).toBeTruthy();
    expect(snapshot?.accessCipher).not.toContain(PERSONAL_TOKEN);
    expect(snapshot?.accessIv).toBeTruthy();
    expect(snapshot?.userId).toBe('183');
  });

  it('invalidates a pending OAuth popup when the user chooses the configured personal token', async () => {
    let oauthTokenCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url === TOKEN_ENDPOINT) {
        oauthTokenCalls += 1;
        throw new Error('A stale OAuth state must be rejected before token exchange.');
      }
      if (request.url === USER_ENDPOINT && request.method === 'GET') {
        expect(request.headers.get('Authorization')).toBe(PERSONAL_TOKEN);
        return new Response(JSON.stringify({
          user: { id: 183, username: 'Gareth', email: 'gareth@example.com' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (request.url === WORKSPACES_ENDPOINT && request.method === 'GET') {
        expect(request.headers.get('Authorization')).toBe(PERSONAL_TOKEN);
        return new Response(JSON.stringify({
          teams: [{ id: '999', name: 'Neon Sales', members: [] }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected ClickUp request: ${request.method} ${request.url}`);
    });

    const pendingOAuth = await start();
    const personal = await doFetch(await signedWrite('/clickup/oauth/personal-token', '{}'));
    expect(personal.status).toBe(200);
    expect((await credentialSnapshot())?.userId).toBe('183');

    const staleOAuth = await exchange(pendingOAuth.state, 'stale-oauth-code');
    expect(staleOAuth.status).toBe(409);
    expect(await staleOAuth.json()).toEqual(expect.objectContaining({ code: 'oauth_state' }));
    expect(oauthTokenCalls).toBe(0);
    expect((await credentialSnapshot())?.userId).toBe('183');
  });


  it('rejects an older OAuth popup state after a newer Connect flow starts', async () => {
    const provider = mockProvider();
    const first = await start();
    const second = await start();

    const stale = await exchange(first.state, 'older-popup-code');
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual(expect.objectContaining({ code: 'oauth_state' }));
    expect(provider.token).toBe(0);

    const current = await exchange(second.state, 'newest-popup-code');
    expect(current.status).toBe(200);
    expect(provider.token).toBe(1);
  });

  it('supersedes an older OAuth exchange already waiting on ClickUp when a new Connect starts', async () => {
    let tokenCalls = 0;
    let firstTokenStarted = false;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const auth = request.headers.get('Authorization') ?? '';

      if (url.pathname === '/api/v2/oauth/token') {
        tokenCalls += 1;
        const sequence = tokenCalls;
        if (sequence === 1) {
          firstTokenStarted = true;
          await new Promise<void>((resolve) => setTimeout(resolve, 200));
        }
        return new Response(JSON.stringify({
          access_token: sequence === 1 ? 'older-token' : 'newest-token',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/user') {
        const newest = auth.endsWith('newest-token');
        return new Response(JSON.stringify({
          user: { id: newest ? 456 : 183, username: newest ? 'Newest' : 'Older' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({
          teams: [{ id: '999', name: 'Workspace', members: [] }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected provider request: ${request.method} ${request.url}`);
    });

    const older = await start();
    const pendingOlderExchange = exchange(older.state, 'older-code');
    for (let attempt = 0; attempt < 100 && !firstTokenStarted; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
    expect(firstTokenStarted).toBe(true);

    const newest = await start();
    const newestExchange = await exchange(newest.state, 'newest-code');
    expect(newestExchange.status).toBe(200);
    expect((await credentialSnapshot())?.userId).toBe('456');

    const staleResult = await pendingOlderExchange;
    expect(staleResult.status).toBe(409);
    expect(await staleResult.json()).toEqual(expect.objectContaining({ code: 'oauth_superseded' }));
    expect((await credentialSnapshot())?.userId).toBe('456');
    expect(tokenCalls).toBe(2);
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
      body: JSON.stringify({ operation: 'getTask', arguments: { workspaceId: '999', taskId: '86task' } }),
    }));
    expect(response.status).toBe(401);
  });

  it('fails malformed semantic commands as validation errors before provider egress', async () => {
    const provider = mockProvider();
    const begun = await start();
    expect((await exchange(begun.state)).status).toBe(200);

    const response = await internalCommand({ operation: 'getTask', arguments: { taskId: '' } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'validation' }));
    expect(provider.task).toBe(0);
  });

  it('rejects an ungranted Workspace before provider egress', async () => {
    const provider = mockProvider();
    const begun = await start();
    expect((await exchange(begun.state)).status).toBe(200);

    const response = await internalCommand({ operation: 'listSpaces', workspaceId: '998' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'workspace_forbidden' }));
    expect(provider.task).toBe(0);
  });

  it('admits only one provider probe while the ClickUp rate budget is still unknown', async () => {
    let spaceCalls = 0;
    let firstStarted = false;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (request.url === TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ access_token: 'token-unknown-rate' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (request.url === USER_ENDPOINT) {
        return new Response(JSON.stringify({ user: { id: 183 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (request.url === WORKSPACES_ENDPOINT) {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Workspace', members: [] }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.pathname === '/api/v2/team/999/space' && request.method === 'GET') {
        spaceCalls += 1;
        firstStarted = true;
        await new Promise<void>((resolve) => setTimeout(resolve, 150));
        return new Response(JSON.stringify({ spaces: [] }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '99',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
          },
        });
      }

      throw new Error(`Unexpected ClickUp provider request: ${request.method} ${request.url}`);
    });

    const begun = await start();
    expect((await exchange(begun.state)).status).toBe(200);
    const revision = (await credentialSnapshot())?.updatedAt ?? 0;
    expect(await rateLimitSnapshot()).toBeNull();

    const first = internalCommand({ operation: 'listSpaces', workspaceId: '999' }, revision);
    for (let attempt = 0; attempt < 100 && !firstStarted; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
    expect(firstStarted).toBe(true);

    const second = await internalCommand({ operation: 'listSpaces', workspaceId: '999' }, revision);
    expect(second.status).toBe(429);
    expect(spaceCalls).toBe(1);

    expect((await first).status).toBe(200);
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({
      limit: 100,
      remaining: 99,
    }));

    const third = await internalCommand({ operation: 'listSpaces', workspaceId: '999' }, revision);
    expect(third.status).toBe(200);
    expect(spaceCalls).toBe(2);
  });

  it('recovers an abandoned unknown-rate probe after one full provider window', async () => {
    const provider = mockProvider();
    const begun = await start();
    expect((await exchange(begun.state)).status).toBe(200);
    const revision = (await credentialSnapshot())?.updatedAt ?? 0;

    await setRateLimitSnapshot({
      limit: null,
      remaining: null,
      resetAt: null,
      unknownProbeInFlight: true,
      updatedAt: Date.now() - 61_000,
    });

    const recovered = await internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '999', taskId: '86task' },
    }, revision);

    expect(recovered.status).toBe(200);
    expect(provider.task).toBe(1);
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({
      limit: 100,
      remaining: 99,
    }));
  });

  it('learns the provider rate window and blocks the next call locally when remaining reaches zero', async () => {
    const provider = mockProvider({ taskRemaining: 0 });
    const begun = await start();
    expect((await exchange(begun.state)).status).toBe(200);

    const first = await internalCommand({ operation: 'getTask', arguments: { workspaceId: '999', taskId: '86task' } });
    expect(first.status).toBe(200);
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({ limit: 100, remaining: 0 }));

    const second = await internalCommand({ operation: 'getTask', arguments: { workspaceId: '999', taskId: '86task' } });
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual(expect.objectContaining({ code: 'rate_limited' }));
    expect(provider.task).toBe(1);
  });

  it('keeps post-reset concurrent requests inside a provisional replenished budget', async () => {
    let taskCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url === TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ access_token: 'token-reset-reservations' }), { status: 200 });
      }
      if (request.url === USER_ENDPOINT) {
        return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200 });
      }
      if (request.url === WORKSPACES_ENDPOINT) {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Workspace', members: [] }] }), { status: 200 });
      }
      if (request.url.startsWith('https://api.clickup.com/api/v2/task/86task')) {
        taskCalls += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        return new Response(JSON.stringify({
          id: '86task',
          name: 'Repair S56',
          team_id: '999',
          list: { id: '123' },
          space: { id: '789' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected ClickUp provider request: ${request.method} ${request.url}`);
    });

    const begun = await start();
    expect((await exchange(begun.state)).status).toBe(200);
    const revision = (await credentialSnapshot())?.updatedAt ?? 0;

    await setRateLimitSnapshot({
      limit: 3,
      remaining: 0,
      resetAt: Math.floor(Date.now() / 1000) - 1,
    });

    const responses = await Promise.all(Array.from({ length: 4 }, () => internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '999', taskId: '86task' },
    }, revision)));

    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 200, 200, 429]);
    expect(taskCalls).toBe(3);
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({
      limit: 3,
      remaining: 0,
    }));
    expect((await rateLimitSnapshot())?.resetAt ?? 0).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('deletes the durable grant when ClickUp reports a revoked token', async () => {
    mockProvider({ taskStatus: 401 });
    const begun = await start();
    expect((await exchange(begun.state)).status).toBe(200);
    expect(await credentialSnapshot()).not.toBeNull();

    const failed = await internalCommand({ operation: 'getTask', arguments: { workspaceId: '999', taskId: '86task' } });
    expect(failed.status).toBe(401);
    expect(await credentialSnapshot()).toBeNull();

    const status = await doFetch(await bearerRead('/clickup/oauth/status'));
    expect(await status.json()).toEqual({
      connected: false,
      workspaces: [],
      connectionMethods: { oauth: true, personalToken: true },
    });
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

  it('does not let an in-flight OAuth exchange resurrect a grant after disconnect', async () => {
    let tokenFetchStarted = false;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url === TOKEN_ENDPOINT) {
        tokenFetchStarted = true;
        // Keep the provider request in flight using a timer owned by the same
        // request context. Cross-context promise resolvers are illegal in workerd.
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
        return new Response(JSON.stringify({ access_token: 'late-token' }), { status: 200 });
      }
      if (request.url === USER_ENDPOINT) {
        return new Response(JSON.stringify({ user: { id: 183, username: 'Late' } }), { status: 200 });
      }
      if (request.url === WORKSPACES_ENDPOINT) {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Workspace', members: [] }] }), { status: 200 });
      }
      throw new Error(`Unexpected ClickUp provider request: ${request.method} ${request.url}`);
    });

    const begun = await start();
    const pendingExchange = exchange(begun.state, 'slow-code');
    for (let attempt = 0; attempt < 100 && !tokenFetchStarted; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
    expect(tokenFetchStarted).toBe(true);

    const disconnected = await doFetch(await signedWrite('/clickup/oauth/disconnect', '{}'));
    expect(disconnected.status).toBe(200);

    const lateExchange = await pendingExchange;
    expect(lateExchange.status).toBe(409);
    expect(await lateExchange.json()).toEqual(expect.objectContaining({ code: 'oauth_superseded' }));
    expect(await credentialSnapshot()).toBeNull();
  });

  it('does not let a delayed old-token failure delete or rate-limit a newer grant', async () => {
    let oldTaskStarted = false;
    const resetAt = Math.floor(Date.now() / 1000) + 600;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url === TOKEN_ENDPOINT && request.method === 'POST') {
        const body = await request.clone().json() as { code?: string };
        return new Response(JSON.stringify({
          access_token: body.code === 'new-code' ? 'token-b' : 'token-a',
        }), { status: 200 });
      }
      if (request.url === USER_ENDPOINT) {
        const current = request.headers.get('Authorization')?.endsWith('token-b') ? '456' : '183';
        return new Response(JSON.stringify({ user: { id: Number(current), username: `user-${current}` } }), {
          status: 200,
          headers: {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '99',
            'X-RateLimit-Reset': String(resetAt),
          },
        });
      }
      if (request.url === WORKSPACES_ENDPOINT) {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Workspace', members: [] }] }), {
          status: 200,
          headers: {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': request.headers.get('Authorization')?.endsWith('token-b') ? '88' : '98',
            'X-RateLimit-Reset': String(resetAt),
          },
        });
      }
      if (request.url.startsWith('https://api.clickup.com/api/v2/task/86task')) {
        expect(request.headers.get('Authorization')).toBe('Bearer token-a');
        oldTaskStarted = true;
        // Keep token A in flight without exporting a resolver across workerd
        // request contexts. The replacement OAuth exchange completes during
        // this delay, then the stale 401 is allowed to arrive.
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
        return new Response(JSON.stringify({ ECODE: 'OAUTH_019', err: 'Old token revoked' }), {
          status: 401,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(resetAt),
          },
        });
      }
      throw new Error(`Unexpected ClickUp provider request: ${request.method} ${request.url}`);
    });

    const first = await start();
    expect((await exchange(first.state, 'first-code')).status).toBe(200);
    const firstRevision = (await credentialSnapshot())?.updatedAt ?? 0;

    const oldRequest = internalCommand(
      { operation: 'getTask', arguments: { workspaceId: '999', taskId: '86task' } },
      firstRevision,
    );
    for (let attempt = 0; attempt < 100 && !oldTaskStarted; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
    expect(oldTaskStarted).toBe(true);

    const second = await start();
    expect((await exchange(second.state, 'new-code')).status).toBe(200);
    const newSnapshot = await credentialSnapshot();
    expect(newSnapshot?.userId).toBe('456');
    const newRevision = newSnapshot?.updatedAt ?? 0;
    expect(newRevision).toBeGreaterThan(firstRevision);

    const obsolete = await oldRequest;
    // Do not consume the stale request body after crossing Durable Object
    // request contexts; workerd forbids carrying I/O body streams between
    // contexts. The 409 plus the surviving new grant/rate state below is the
    // security invariant this race is intended to prove.
    expect(obsolete.status).toBe(409);

    const surviving = await credentialSnapshot();
    expect(surviving?.userId).toBe('456');
    expect(surviving?.updatedAt).toBe(newRevision);
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({ remaining: 88 }));
  });

  it('blocks a provider-readable task from Workspace B when only Workspace A is admitted', async () => {
    let taskBReads = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'token-a' }), { status: 200 });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183, username: 'Gareth' } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Workspace A', members: [] }] }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team/999/space' && request.method === 'GET') {
        return new Response(JSON.stringify({
          spaces: [{ id: 'space-a', name: 'A Space' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/task/task-b') {
        taskBReads += 1;
        return new Response(JSON.stringify({
          id: 'task-b',
          name: 'SECRET B TASK',
          markdown_description: 'B-only confidential content',
          team_id: '998',
          list: { id: 'list-b' },
          space: { id: 'space-b' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected ClickUp provider request: ${request.method} ${request.url}`);
    });

    const begun = await start();
    expect((await exchange(begun.state)).status).toBe(200);
    const response = await internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '999', taskId: 'task-b' },
    });

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain('resource_workspace_mismatch');
    expect(body).not.toContain('SECRET B TASK');
    expect(body).not.toContain('confidential');
    expect(taskBReads).toBe(1);
  });

  it('blocks a provider-readable Folder from Workspace B when hierarchy is scoped to Workspace A', async () => {
    let folderReads = 0;
    let spaceLists = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/api/v2/oauth/token') {
        return new Response(JSON.stringify({ access_token: 'token-a' }), { status: 200 });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team') {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Workspace A', members: [] }] }), { status: 200 });
      }
      if (url.pathname === '/api/v2/folder/456') {
        folderReads += 1;
        return new Response(JSON.stringify({
          id: '456',
          name: 'SECRET B FOLDER',
          space: { id: '222' },
          lists: [{ id: 'list-b', name: 'B list' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/api/v2/team/999/space') {
        spaceLists += 1;
        return new Response(JSON.stringify({
          spaces: [{ id: '111', name: 'A Space' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected ClickUp provider request: ${request.method} ${request.url}`);
    });

    const begun = await start();
    expect((await exchange(begun.state)).status).toBe(200);
    const response = await internalCommand({
      operation: 'getFolder',
      workspaceId: '999',
      folderId: '456',
      includeSubfolders: true,
    });

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain('resource_workspace_mismatch');
    expect(body).not.toContain('SECRET B FOLDER');
    expect(body).not.toContain('B list');
    expect(folderReads).toBe(1);
    expect(spaceLists).toBeGreaterThan(0);
  });

  it('cannot reuse a removed Workspace B resource after reconnect authorizes only Workspace A', async () => {
    let tokenSequence = 0;
    let taskBReads = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/api/v2/oauth/token') {
        tokenSequence += 1;
        return new Response(JSON.stringify({ access_token: tokenSequence === 1 ? 'token-ab' : 'token-a' }), { status: 200 });
      }
      if (url.pathname === '/api/v2/user') {
        return new Response(JSON.stringify({ user: { id: 183 } }), { status: 200 });
      }
      if (url.pathname === '/api/v2/team') {
        const both = request.headers.get('Authorization')?.endsWith('token-ab');
        return new Response(JSON.stringify({
          teams: both
            ? [{ id: '999', name: 'Workspace A', members: [] }, { id: '998', name: 'Workspace B', members: [] }]
            : [{ id: '999', name: 'Workspace A', members: [] }],
        }), { status: 200 });
      }
      if (url.pathname === '/api/v2/task/task-b') {
        taskBReads += 1;
        return new Response(JSON.stringify({ id: 'task-b', name: 'SECRET B', team_id: '998' }), { status: 200 });
      }
      throw new Error(`Unexpected ClickUp provider request: ${request.method} ${request.url}`);
    });

    const first = await start();
    expect((await exchange(first.state, 'grant-ab')).status).toBe(200);
    expect((await credentialSnapshot())?.workspacesJson).toContain('"998"');

    const second = await start();
    expect((await exchange(second.state, 'grant-a')).status).toBe(200);
    expect((await credentialSnapshot())?.workspacesJson).not.toContain('"998"');

    const response = await internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '998', taskId: 'task-b' },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'workspace_forbidden' }));
    expect(taskBReads).toBe(0);
  });

  it('does not raise the local rate budget when concurrent provider responses arrive out of order', async () => {
    let taskCalls = 0;
    let firstStarted = false;
    const resetAt = Math.floor(Date.now() / 1000) + 600;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url === TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ access_token: 'token-rate' }), { status: 200 });
      }
      if (request.url === USER_ENDPOINT) {
        return new Response(JSON.stringify({ user: { id: 183 } }), {
          status: 200,
          headers: {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '99',
            'X-RateLimit-Reset': String(resetAt),
          },
        });
      }
      if (request.url === WORKSPACES_ENDPOINT) {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Workspace', members: [] }] }), {
          status: 200,
          headers: {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '98',
            'X-RateLimit-Reset': String(resetAt),
          },
        });
      }
      if (request.url.startsWith('https://api.clickup.com/api/v2/task/86task')) {
        taskCalls += 1;
        const sequence = taskCalls;
        if (sequence === 1) firstStarted = true;
        // Force response #2 (remaining=8) to settle before response #1
        // (remaining=9), without exporting promise resolvers across contexts.
        await new Promise<void>((resolve) => setTimeout(resolve, sequence === 1 ? 200 : 20));
        return new Response(JSON.stringify({ id: '86task', name: 'Repair S56', team_id: '999', list: { id: '123' }, space: { id: '789' } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': sequence === 1 ? '9' : '8',
            'X-RateLimit-Reset': String(resetAt),
          },
        });
      }
      throw new Error(`Unexpected ClickUp provider request: ${request.method} ${request.url}`);
    });

    const begun = await start();
    expect((await exchange(begun.state)).status).toBe(200);
    const revision = (await credentialSnapshot())?.updatedAt ?? 0;

    const firstRequest = internalCommand({ operation: 'getTask', arguments: { workspaceId: '999', taskId: '86task' } }, revision);
    for (let attempt = 0; attempt < 100 && !firstStarted; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
    expect(firstStarted).toBe(true);

    const secondRequest = internalCommand({ operation: 'getTask', arguments: { workspaceId: '999', taskId: '86task' } }, revision);
    expect((await secondRequest).status).toBe(200);
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({ remaining: 8 }));

    expect((await firstRequest).status).toBe(200);
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({
      remaining: 8,
      resetAt,
    }));
  });

  it('ignores a delayed response from the previous rate window after the provider window rolls over', async () => {
    let taskCalls = 0;
    let firstStarted = false;
    const firstResetAt = Math.floor(Date.now() / 1000) + 600;
    const secondResetAt = firstResetAt + 60;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url === TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ access_token: 'token-rate-rollover-race' }), { status: 200 });
      }
      if (request.url === USER_ENDPOINT) {
        return new Response(JSON.stringify({ user: { id: 183 } }), {
          status: 200,
          headers: {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '99',
            'X-RateLimit-Reset': String(firstResetAt),
          },
        });
      }
      if (request.url === WORKSPACES_ENDPOINT) {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Workspace', members: [] }] }), {
          status: 200,
          headers: {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '98',
            'X-RateLimit-Reset': String(firstResetAt),
          },
        });
      }
      if (request.url.startsWith('https://api.clickup.com/api/v2/task/86task')) {
        taskCalls += 1;
        const sequence = taskCalls;
        if (sequence === 1) firstStarted = true;
        await new Promise<void>((resolve) => setTimeout(resolve, sequence === 1 ? 200 : 20));
        return new Response(JSON.stringify({
          id: '86task',
          name: 'Repair S56',
          team_id: '999',
          list: { id: '123' },
          space: { id: '789' },
        }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': sequence === 1 ? '0' : '99',
            'X-RateLimit-Reset': String(sequence === 1 ? firstResetAt : secondResetAt),
          },
        });
      }
      throw new Error(`Unexpected ClickUp provider request: ${request.method} ${request.url}`);
    });

    const begun = await start();
    expect((await exchange(begun.state)).status).toBe(200);
    const revision = (await credentialSnapshot())?.updatedAt ?? 0;

    const oldWindowRequest = internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '999', taskId: '86task' },
    }, revision);
    for (let attempt = 0; attempt < 100 && !firstStarted; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
    expect(firstStarted).toBe(true);

    const newWindowRequest = internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '999', taskId: '86task' },
    }, revision);
    expect((await newWindowRequest).status).toBe(200);
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({
      // Two provider calls were already reserved locally from the current
      // budget (98 -> 97 -> 96). A newer provider window may advance the reset
      // horizon, but it must not replenish those in-flight reservations.
      remaining: 96,
      resetAt: secondResetAt,
    }));

    expect((await oldWindowRequest).status).toBe(200);
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({
      remaining: 96,
      resetAt: secondResetAt,
    }));
  });

  it('does not replenish remaining from small reset-horizon jitter inside the same minute window', async () => {
    let taskCalls = 0;
    const resetAt = Math.floor(Date.now() / 1000) + 600;
    const jitteredResetAt = resetAt + 5;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url === TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ access_token: 'token-window-jitter' }), { status: 200 });
      }
      if (request.url === USER_ENDPOINT) {
        return new Response(JSON.stringify({ user: { id: 183 } }), {
          status: 200,
          headers: {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '99',
            'X-RateLimit-Reset': String(resetAt),
          },
        });
      }
      if (request.url === WORKSPACES_ENDPOINT) {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Workspace', members: [] }] }), {
          status: 200,
          headers: {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '98',
            'X-RateLimit-Reset': String(resetAt),
          },
        });
      }
      if (request.url.startsWith('https://api.clickup.com/api/v2/task/86task')) {
        taskCalls += 1;
        return new Response(JSON.stringify({
          id: '86task',
          name: 'Repair S56',
          team_id: '999',
          list: { id: '123' },
          space: { id: '789' },
        }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': taskCalls === 1 ? '9' : '99',
            'X-RateLimit-Reset': String(taskCalls === 1 ? resetAt : jitteredResetAt),
          },
        });
      }
      throw new Error(`Unexpected ClickUp provider request: ${request.method} ${request.url}`);
    });

    const begun = await start();
    expect((await exchange(begun.state)).status).toBe(200);
    const revision = (await credentialSnapshot())?.updatedAt ?? 0;

    expect((await internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '999', taskId: '86task' },
    }, revision)).status).toBe(200);
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({
      remaining: 9,
      resetAt,
    }));

    expect((await internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '999', taskId: '86task' },
    }, revision)).status).toBe(200);
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({
      remaining: 8,
      resetAt,
    }));
  });

  it('preserves concurrent reservations when a response advances the provider window', async () => {
    let taskCalls = 0;
    let firstStarted = false;
    let secondStarted = false;
    let thirdStarted = false;
    const firstResetAt = Math.floor(Date.now() / 1000) + 600;
    const secondResetAt = firstResetAt + 60;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url === TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ access_token: 'token-window-reservations' }), { status: 200 });
      }
      if (request.url === USER_ENDPOINT) {
        return new Response(JSON.stringify({ user: { id: 183 } }), {
          status: 200,
          headers: {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '99',
            'X-RateLimit-Reset': String(firstResetAt),
          },
        });
      }
      if (request.url === WORKSPACES_ENDPOINT) {
        return new Response(JSON.stringify({ teams: [{ id: '999', name: 'Workspace', members: [] }] }), {
          status: 200,
          headers: {
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '98',
            'X-RateLimit-Reset': String(firstResetAt),
          },
        });
      }
      if (request.url.startsWith('https://api.clickup.com/api/v2/task/86task')) {
        taskCalls += 1;
        const sequence = taskCalls;
        if (sequence === 1) firstStarted = true;
        if (sequence === 2) secondStarted = true;
        if (sequence === 3) thirdStarted = true;
        await new Promise<void>((resolve) => setTimeout(resolve, sequence === 2 ? 220 : sequence === 1 ? 80 : 20));
        return new Response(JSON.stringify({
          id: '86task',
          name: 'Repair S56',
          team_id: '999',
          list: { id: '123' },
          space: { id: '789' },
        }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'X-RateLimit-Limit': '3',
            'X-RateLimit-Remaining': sequence === 1 ? '2' : sequence === 2 ? '1' : '0',
            'X-RateLimit-Reset': String(secondResetAt),
          },
        });
      }
      throw new Error(`Unexpected ClickUp provider request: ${request.method} ${request.url}`);
    });

    const begun = await start();
    expect((await exchange(begun.state)).status).toBe(200);
    const revision = (await credentialSnapshot())?.updatedAt ?? 0;
    await setRateLimitSnapshot({ limit: 3, remaining: 3, resetAt: firstResetAt });

    const first = internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '999', taskId: '86task' },
    }, revision);
    for (let attempt = 0; attempt < 100 && !firstStarted; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
    expect(firstStarted).toBe(true);

    const second = internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '999', taskId: '86task' },
    }, revision);
    for (let attempt = 0; attempt < 100 && !secondStarted; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
    expect(secondStarted).toBe(true);
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({ remaining: 1 }));

    expect((await first).status).toBe(200);
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({
      limit: 3,
      remaining: 1,
      resetAt: secondResetAt,
    }));

    const third = internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '999', taskId: '86task' },
    }, revision);
    // Starting an async command does not guarantee its local quota reservation
    // has happened before the next command begins. Wait for provider egress so
    // this test deterministically proves that the *next* caller is the one
    // blocked after the third reservation consumes the last slot.
    for (let attempt = 0; attempt < 100 && !thirdStarted; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
    expect(thirdStarted).toBe(true);

    const fourth = await internalCommand({
      operation: 'getTask',
      arguments: { workspaceId: '999', taskId: '86task' },
    }, revision);

    expect(fourth.status).toBe(429);
    expect((await third).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(taskCalls).toBe(3);
    expect(await rateLimitSnapshot()).toEqual(expect.objectContaining({
      remaining: 0,
      resetAt: secondResetAt,
    }));
  });
});
