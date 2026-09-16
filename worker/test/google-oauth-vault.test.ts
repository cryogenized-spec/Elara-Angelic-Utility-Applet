import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env, reset } from 'cloudflare:test';
import { deriveInstallationId, newNonce, signWrite } from '../../src/autonomy/protocol';
import { TOKEN, bearerRead, signedWrite } from './helpers';

const ORIGIN = 'https://cryogenized-spec.github.io';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';

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

function mockProvider(): ProviderMockCounters {
  const counters: ProviderMockCounters = { exchange: 0, refresh: 0, userinfo: 0, revoke: 0 };

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);

    if (request.url === TOKEN_ENDPOINT && request.method === 'POST') {
      const form = new URLSearchParams(await request.clone().text());
      const grantType = form.get('grant_type');
      if (grantType === 'authorization_code') {
        counters.exchange += 1;
        return new Response(JSON.stringify({
          access_token: 'access-token-one',
          expires_in: 3600,
          refresh_token: 'refresh-token-must-never-be-returned',
          scope: 'https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar.events',
          token_type: 'Bearer',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (grantType === 'refresh_token') {
        counters.refresh += 1;
        return new Response(JSON.stringify({
          access_token: 'access-token-two',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar.events',
          token_type: 'Bearer',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }

    if (request.url === USERINFO_ENDPOINT && request.method === 'GET') {
      counters.userinfo += 1;
      return new Response(JSON.stringify({ email: 'owner@example.com', name: 'Owner' }), {
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

describe('GoogleOAuthVault', () => {
  it('exchanges a code, stores only encrypted refresh material, and refreshes without browser interaction', async () => {
    const provider = mockProvider();
    const exchangeBody = JSON.stringify({ code: 'one-time-code', redirectUri: ORIGIN });
    const request = await signedWrite('/google/oauth/exchange', exchangeBody);
    request.headers.set('X-Requested-With', 'XmlHttpRequest');
    const exchange = await doFetch(request);
    expect(exchange.status).toBe(200);
    const exchangeJson = await exchange.json() as Record<string, unknown>;
    expect(exchangeJson.accessToken).toBe('access-token-one');
    expect(JSON.stringify(exchangeJson)).not.toContain('refresh-token-must-never-be-returned');
    expect(provider.exchange).toBe(1);
    expect(provider.userinfo).toBe(1);

    const snapshot = await (await stub() as DurableObjectStub & {
      credentialSnapshot(): Promise<{ refreshCipher: string; refreshIv: string; email: string | null } | null>;
    }).credentialSnapshot();
    expect(snapshot?.refreshCipher).toBeTruthy();
    expect(snapshot?.refreshCipher).not.toContain('refresh-token-must-never-be-returned');
    expect(snapshot?.refreshIv).toBeTruthy();
    expect(snapshot?.email).toBe('owner@example.com');

    const status = await doFetch(await bearerRead('/google/oauth/status'));
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual(expect.objectContaining({
      connected: true,
      account: { email: 'owner@example.com', displayName: 'Owner' },
    }));

    const refreshed = await doFetch(await signedWrite('/google/oauth/token', '{}'));
    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toEqual(expect.objectContaining({ accessToken: 'access-token-two', connected: true }));
    expect(provider.refresh).toBe(1);
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
    const body = JSON.stringify({ code: 'disconnect-code', redirectUri: ORIGIN });
    const request = await signedWrite('/google/oauth/exchange', body);
    request.headers.set('X-Requested-With', 'XmlHttpRequest');
    expect((await doFetch(request)).status).toBe(200);

    const disconnect = await doFetch(await signedWrite('/google/oauth/disconnect', '{}'));
    expect(disconnect.status).toBe(200);
    expect(await disconnect.json()).toEqual({ disconnected: true, providerRevoked: true });
    expect(provider.revoke).toBe(1);

    const status = await doFetch(await bearerRead('/google/oauth/status'));
    expect(await status.json()).toEqual({ connected: false, scopes: [] });
  });
});
