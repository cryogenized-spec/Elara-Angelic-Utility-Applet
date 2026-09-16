import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env, reset } from 'cloudflare:test';
import { deriveInstallationId, newNonce, signWrite } from '../../src/autonomy/protocol';
import { TOKEN, bearerRead, signedWrite } from './helpers';

const ORIGIN = 'https://cryogenized-spec.github.io';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const PROVIDER_SCOPES = 'https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar.events';

beforeEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function stub() {
  const installationId = await deriveInstallationId(TOKEN);
  return env.GOOGLE_OAUTH!.get(env.GOOGLE_OAUTH!.idFromName(installationId));
}

async function doFetch(request: Request): Promise<Response> {
  return (await stub()).fetch(request);
}

type ProviderMockCounters = {
  exchange: number;
  refresh: number;
  userinfo: number;
  revoke: number;
};

type ExchangeFixture = {
  accessToken: string;
  refreshToken?: string;
  subject: string;
  email: string;
  name?: string;
};

const DEFAULT_EXCHANGE: ExchangeFixture = {
  accessToken: 'access-token-one',
  refreshToken: 'refresh-token-must-never-be-returned',
  subject: 'google-subject-owner',
  email: 'owner@example.com',
  name: 'Owner',
};

function mockProvider(fixtures: readonly ExchangeFixture[] = [DEFAULT_EXCHANGE]): ProviderMockCounters {
  const counters: ProviderMockCounters = { exchange: 0, refresh: 0, userinfo: 0, revoke: 0 };

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);

    if (request.url === TOKEN_ENDPOINT && request.method === 'POST') {
      const form = new URLSearchParams(await request.clone().text());
      const grantType = form.get('grant_type');
      if (grantType === 'authorization_code') {
        const fixture = fixtures[Math.min(counters.exchange, fixtures.length - 1)]!;
        counters.exchange += 1;
        return new Response(JSON.stringify({
          access_token: fixture.accessToken,
          expires_in: 3600,
          ...(fixture.refreshToken ? { refresh_token: fixture.refreshToken } : {}),
          scope: PROVIDER_SCOPES,
          token_type: 'Bearer',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (grantType === 'refresh_token') {
        counters.refresh += 1;
        return new Response(JSON.stringify({
          access_token: 'access-token-refreshed',
          expires_in: 3600,
          scope: PROVIDER_SCOPES,
          token_type: 'Bearer',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }

    if (request.url === USERINFO_ENDPOINT && request.method === 'GET') {
      counters.userinfo += 1;
      const authorization = request.headers.get('Authorization') ?? '';
      const fixture = fixtures.find((candidate) => authorization === `Bearer ${candidate.accessToken}`);
      if (!fixture) return new Response('', { status: 401 });
      return new Response(JSON.stringify({
        sub: fixture.subject,
        email: fixture.email,
        ...(fixture.name ? { name: fixture.name } : {}),
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (request.url === REVOKE_ENDPOINT && request.method === 'POST') {
      counters.revoke += 1;
      return new Response('', { status: 200, headers: { 'content-type': 'text/plain' } });
    }

    throw new Error(`Unexpected Google OAuth provider request: ${request.method} ${request.url}`);
  });

  return counters;
}

async function exchange(code: string): Promise<Response> {
  const body = JSON.stringify({ code, redirectUri: ORIGIN });
  const request = await signedWrite('/google/oauth/exchange', body);
  request.headers.set('X-Requested-With', 'XmlHttpRequest');
  return doFetch(request);
}

type CredentialSnapshot = {
  refreshCipher: string;
  refreshIv: string;
  subject: string | null;
  email: string | null;
};

async function credentialSnapshot(): Promise<CredentialSnapshot | null> {
  return (await stub() as DurableObjectStub & {
    credentialSnapshot(): Promise<CredentialSnapshot | null>;
  }).credentialSnapshot();
}

describe('GoogleOAuthVault', () => {
  it('exchanges a code, stores only encrypted refresh material, and refreshes without browser interaction', async () => {
    const provider = mockProvider();
    const result = await exchange('one-time-code');
    expect(result.status).toBe(200);
    const exchangeJson = await result.json() as Record<string, unknown>;
    expect(exchangeJson.accessToken).toBe('access-token-one');
    expect(JSON.stringify(exchangeJson)).not.toContain('refresh-token-must-never-be-returned');
    expect(provider.exchange).toBe(1);
    expect(provider.userinfo).toBe(1);

    const snapshot = await credentialSnapshot();
    expect(snapshot?.refreshCipher).toBeTruthy();
    expect(snapshot?.refreshCipher).not.toContain('refresh-token-must-never-be-returned');
    expect(snapshot?.refreshIv).toBeTruthy();
    expect(snapshot?.subject).toBe('google-subject-owner');
    expect(snapshot?.email).toBe('owner@example.com');

    const status = await doFetch(await bearerRead('/google/oauth/status'));
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual(expect.objectContaining({
      connected: true,
      account: { email: 'owner@example.com', displayName: 'Owner' },
    }));

    const refreshed = await doFetch(await signedWrite('/google/oauth/token', '{}'));
    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toEqual(expect.objectContaining({ accessToken: 'access-token-refreshed', connected: true }));
    expect(provider.refresh).toBe(1);
  });

  it('reuses an existing encrypted refresh token only when the stable Google subject matches', async () => {
    mockProvider([
      DEFAULT_EXCHANGE,
      {
        accessToken: 'access-token-same-account',
        subject: DEFAULT_EXCHANGE.subject,
        email: 'renamed-owner@example.com',
        name: 'Renamed Owner',
      },
    ]);
    expect((await exchange('first-code')).status).toBe(200);
    const before = await credentialSnapshot();
    expect(before).not.toBeNull();

    const second = await exchange('same-account-code-without-refresh');
    expect(second.status).toBe(200);
    const after = await credentialSnapshot();
    expect(after?.refreshCipher).toBe(before?.refreshCipher);
    expect(after?.refreshIv).toBe(before?.refreshIv);
    expect(after?.subject).toBe(DEFAULT_EXCHANGE.subject);
    expect(after?.email).toBe('renamed-owner@example.com');

    const refreshed = await doFetch(await signedWrite('/google/oauth/token', '{}'));
    expect(refreshed.status).toBe(200);
  });

  it('rejects refresh-token reuse across Google accounts and deletes the unsafe local credential', async () => {
    const provider = mockProvider([
      DEFAULT_EXCHANGE,
      {
        accessToken: 'access-token-other-account',
        subject: 'google-subject-other',
        email: 'other@example.com',
        name: 'Other Owner',
      },
    ]);
    expect((await exchange('first-code')).status).toBe(200);
    expect(await credentialSnapshot()).not.toBeNull();

    const switched = await exchange('other-account-code-without-refresh');
    expect(switched.status).toBe(409);
    expect(await switched.json()).toEqual(expect.objectContaining({ code: 'reauthorization_required' }));
    expect(provider.exchange).toBe(2);
    expect(provider.userinfo).toBe(2);
    expect(await credentialSnapshot()).toBeNull();

    const status = await doFetch(await bearerRead('/google/oauth/status'));
    expect(await status.json()).toEqual({ connected: false, scopes: [] });
  });

  it('turns provider invalid_grant into explicit reauthorization and deletes the revoked durable grant', async () => {
    mockProvider();
    expect((await exchange('revoked-grant-code')).status).toBe(200);
    expect(await credentialSnapshot()).not.toBeNull();

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'invalid_grant',
      error_description: 'Token has been expired or revoked.',
    }), { status: 400, headers: { 'content-type': 'application/json' } }));

    const refreshed = await doFetch(await signedWrite('/google/oauth/token', '{}'));
    expect(refreshed.status).toBe(409);
    expect(await refreshed.json()).toEqual(expect.objectContaining({ code: 'reauthorization_required' }));
    expect(await credentialSnapshot()).toBeNull();

    const status = await doFetch(await bearerRead('/google/oauth/status'));
    expect(await status.json()).toEqual({ connected: false, scopes: [] });
  });

  it('rejects replay of the same signed exchange before a second provider call can occur', async () => {
    const provider = mockProvider();
    const body = JSON.stringify({ code: 'single-use-code', redirectUri: ORIGIN });
    const timestamp = Date.now();
    const nonce = newNonce();
    const signature = await signWrite(TOKEN, 'POST', '/google/oauth/exchange', timestamp, nonce, body);

    const first = await signedWrite('/google/oauth/exchange', body, { timestamp, nonce, signature });
    first.headers.set('X-Requested-With', 'XmlHttpRequest');
    expect((await doFetch(first)).status).toBe(200);

    const replay = await signedWrite('/google/oauth/exchange', body, { timestamp, nonce, signature });
    replay.headers.set('X-Requested-With', 'XmlHttpRequest');
    const rejected = await doFetch(replay);
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual(expect.objectContaining({ code: 'replayed-nonce' }));
    expect(provider.exchange).toBe(1);
  });

  it('rejects redirect-origin mismatch and missing popup CSRF marker', async () => {
    const providerFetch = vi.spyOn(globalThis, 'fetch');

    const missingMarker = await doFetch(await signedWrite('/google/oauth/exchange', JSON.stringify({
      code: 'code',
      redirectUri: ORIGIN,
    })));
    expect(missingMarker.status).toBe(403);

    const mismatchRequest = await signedWrite('/google/oauth/exchange', JSON.stringify({
      code: 'code',
      redirectUri: 'https://evil.example',
    }));
    mismatchRequest.headers.set('X-Requested-With', 'XmlHttpRequest');
    const mismatch = await doFetch(mismatchRequest);
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual(expect.objectContaining({ code: 'redirect_uri' }));
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('revokes best-effort and always removes the local durable grant', async () => {
    const provider = mockProvider();
    expect((await exchange('disconnect-code')).status).toBe(200);

    const disconnect = await doFetch(await signedWrite('/google/oauth/disconnect', '{}'));
    expect(disconnect.status).toBe(200);
    expect(await disconnect.json()).toEqual({ disconnected: true, providerRevoked: true });
    expect(provider.revoke).toBe(1);

    const status = await doFetch(await bearerRead('/google/oauth/status'));
    expect(await status.json()).toEqual({ connected: false, scopes: [] });
  });
});
