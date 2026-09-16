import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env, fetchMock, reset } from 'cloudflare:test';
import { deriveInstallationId, newNonce, signWrite } from '../../src/autonomy/protocol';
import { TOKEN, bearerRead, signedWrite } from './helpers';

const ORIGIN = 'https://cryogenized-spec.github.io';
const TOKEN_ORIGIN = 'https://oauth2.googleapis.com';
const USERINFO_ORIGIN = 'https://www.googleapis.com';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(async () => {
  await reset();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

async function stub() {
  const installationId = await deriveInstallationId(TOKEN);
  return env.GOOGLE_OAUTH!.get(env.GOOGLE_OAUTH!.idFromName(installationId));
}

async function doFetch(request: Request): Promise<Response> {
  return (await stub()).fetch(request);
}

function mockExchange() {
  fetchMock.get(TOKEN_ORIGIN)
    .intercept({ path: '/token', method: 'POST' })
    .reply(200, JSON.stringify({
      access_token: 'access-token-one',
      expires_in: 3600,
      refresh_token: 'refresh-token-must-never-be-returned',
      scope: 'https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar.events',
      token_type: 'Bearer',
    }), { headers: { 'content-type': 'application/json' } });
  fetchMock.get(USERINFO_ORIGIN)
    .intercept({ path: '/oauth2/v2/userinfo', method: 'GET' })
    .reply(200, JSON.stringify({ email: 'owner@example.com', name: 'Owner' }), { headers: { 'content-type': 'application/json' } });
}

describe('GoogleOAuthVault', () => {
  it('exchanges a code, stores only encrypted refresh material, and refreshes without browser interaction', async () => {
    mockExchange();
    const exchangeBody = JSON.stringify({ code: 'one-time-code', redirectUri: ORIGIN });
    const request = await signedWrite('/google/oauth/exchange', exchangeBody);
    request.headers.set('X-Requested-With', 'XmlHttpRequest');
    const exchange = await doFetch(request);
    expect(exchange.status).toBe(200);
    const exchangeJson = await exchange.json() as Record<string, unknown>;
    expect(exchangeJson.accessToken).toBe('access-token-one');
    expect(JSON.stringify(exchangeJson)).not.toContain('refresh-token-must-never-be-returned');

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

    fetchMock.get(TOKEN_ORIGIN)
      .intercept({ path: '/token', method: 'POST' })
      .reply(200, JSON.stringify({
        access_token: 'access-token-two',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar.events',
        token_type: 'Bearer',
      }), { headers: { 'content-type': 'application/json' } });

    const refreshed = await doFetch(await signedWrite('/google/oauth/token', '{}'));
    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toEqual(expect.objectContaining({ accessToken: 'access-token-two', connected: true }));
  });

  it('rejects replay of the same signed exchange before a second provider call can occur', async () => {
    mockExchange();
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
  });

  it('rejects redirect-origin mismatch and missing popup CSRF marker', async () => {
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
  });

  it('revokes best-effort and always removes the local durable grant', async () => {
    mockExchange();
    const body = JSON.stringify({ code: 'disconnect-code', redirectUri: ORIGIN });
    const request = await signedWrite('/google/oauth/exchange', body);
    request.headers.set('X-Requested-With', 'XmlHttpRequest');
    expect((await doFetch(request)).status).toBe(200);

    fetchMock.get(TOKEN_ORIGIN)
      .intercept({ path: '/revoke', method: 'POST' })
      .reply(200, '', { headers: { 'content-type': 'text/plain' } });

    const disconnect = await doFetch(await signedWrite('/google/oauth/disconnect', '{}'));
    expect(disconnect.status).toBe(200);
    expect(await disconnect.json()).toEqual({ disconnected: true, providerRevoked: true });

    const status = await doFetch(await bearerRead('/google/oauth/status'));
    expect(await status.json()).toEqual({ connected: false, scopes: [] });
  });
});
