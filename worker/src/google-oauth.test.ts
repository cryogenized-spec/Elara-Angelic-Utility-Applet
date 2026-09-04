import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleGoogleOAuthRequest, type GoogleOAuthEnv, type OAuthKV } from './google-oauth';

class MemoryKV implements OAuthKV {
  private readonly values = new Map<string, string>();
  async get(key: string, _type: 'text'): Promise<string | null> { return this.values.get(key) ?? null; }
  async put(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

const env = (): GoogleOAuthEnv => ({
  GOOGLE_OAUTH_KV: new MemoryKV(),
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://elara-gemini.cryogenized.workers.dev/api/google/oauth/callback',
  OAUTH_TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  APP_ORIGIN: 'https://cryogenized-spec.github.io/Elara-Angelic-Utility-Applet/',
  ALLOWED_ORIGINS: 'https://cryogenized-spec.github.io',
});

async function requireResponse(request: Request, runtime: GoogleOAuthEnv): Promise<Response> {
  const response = await handleGoogleOAuthRequest(request, runtime);
  if (!response) throw new Error('Expected the Google OAuth Worker route to handle this request.');
  return response;
}

async function establishCalendarSession(runtime: GoogleOAuthEnv, fetchMock: ReturnType<typeof vi.spyOn>): Promise<string> {
  fetchMock
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-123', refresh_token: 'refresh-123', expires_in: 3600, scope: 'openid email profile https://www.googleapis.com/auth/calendar.events.readonly' }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'google-sub-1', email: 'user@example.com', name: 'Example User' }), { status: 200 }));
  const start = await requireResponse(new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/start?capability=calendar.events.read', { headers: { Origin: 'https://cryogenized-spec.github.io' } }), runtime);
  const state = new URL((await start.json() as { authorizationUrl: string }).authorizationUrl).searchParams.get('state')!;
  const stateCookie = start.headers.get('Set-Cookie')!.split(';')[0];
  const callback = await requireResponse(new Request(`https://elara-gemini.cryogenized.workers.dev/api/google/oauth/callback?state=${encodeURIComponent(state)}&code=authorization-code`, { headers: { Cookie: stateCookie } }), runtime);
  return callback.headers.get('Set-Cookie')!.split(';')[0];
}

describe('protected Google OAuth Worker', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('creates an offline incremental authorization URL and a short-lived state cookie', async () => {
    const runtime = env();
    const response = await requireResponse(new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/start?capability=calendar.events.read', { headers: { Origin: 'https://cryogenized-spec.github.io' } }), runtime);
    const body = await response.json() as { authorizationUrl: string };
    const authorization = new URL(body.authorizationUrl);
    expect(response.status).toBe(200);
    expect(authorization.searchParams.get('response_type')).toBe('code');
    expect(authorization.searchParams.get('access_type')).toBe('offline');
    expect(authorization.searchParams.get('include_granted_scopes')).toBe('true');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar.events.readonly');
    expect(authorization.searchParams.get('scope')).toContain('openid');
    expect(response.headers.get('Set-Cookie')).toMatch(/^elara_oauth_state=[^;]+;/);
  });

  it('rejects an OAuth callback when the state cookie does not match', async () => {
    const response = await requireResponse(new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/callback?state=attacker&code=code', { headers: { Cookie: 'elara_oauth_state=legitimate' } }), env());
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toContain('google=state_error');
  });

  it('exchanges the code and establishes an HttpOnly session', async () => {
    const runtime = env();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const sessionCookie = await establishCalendarSession(runtime, fetchMock);
    expect(sessionCookie).toMatch(/^__Host-elara_google_session=/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const tokenRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new URLSearchParams(tokenRequest.body as URLSearchParams).get('grant_type')).toBe('authorization_code');
  });

  it('returns capability state without exposing stored tokens and proxies only an allowed Workspace target', async () => {
    const runtime = env();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const sessionCookie = await establishCalendarSession(runtime, fetchMock);
    const status = await requireResponse(new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/status', { headers: { Origin: 'https://cryogenized-spec.github.io', Cookie: sessionCookie } }), runtime);
    const statusBody = await status.json() as Record<string, unknown>;
    expect(statusBody).toEqual(expect.objectContaining({ state: 'partially-authorized' }));
    expect(JSON.stringify(statusBody)).not.toContain('refresh-123');
    expect(JSON.stringify(statusBody)).not.toContain('access-123');

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const proxy = await requireResponse(new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/proxy', {
      method: 'GET',
      headers: { Origin: 'https://cryogenized-spec.github.io', Cookie: sessionCookie, 'X-Elara-Google-Capability': 'calendar.events.read', 'X-Elara-Google-Target': 'https://www.googleapis.com/calendar/v3/calendars/primary/events' },
    }), runtime);
    expect(proxy.status).toBe(200);
    const providerRequest = fetchMock.mock.calls[2]?.[0] as URL;
    expect(String(providerRequest)).toContain('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    const providerOptions = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(new Headers(providerOptions?.headers).get('Authorization')).toBe('Bearer access-123');
  });

  it('advertises the proxy target header during credentialed browser preflight', async () => {
    const response = await requireResponse(new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/proxy', {
      method: 'OPTIONS',
      headers: { Origin: 'https://cryogenized-spec.github.io', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'content-type, x-elara-google-capability, x-elara-google-target' },
    }), env());
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://cryogenized-spec.github.io');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-Elara-Google-Target');
  });

  it('rejects a Google target outside the capability allow-list before contacting the provider', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const response = await requireResponse(new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/proxy', {
      method: 'GET',
      headers: { Origin: 'https://cryogenized-spec.github.io', Cookie: '__Host-elara_google_session=missing', 'X-Elara-Google-Capability': 'calendar.events.read', 'X-Elara-Google-Target': 'https://example.com/steal' },
    }), env());
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('revokes the provider credential and deletes the local session on disconnect', async () => {
    const runtime = env();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const sessionCookie = await establishCalendarSession(runtime, fetchMock);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const disconnect = await requireResponse(new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/disconnect', { method: 'POST', headers: { Origin: 'https://cryogenized-spec.github.io', Cookie: sessionCookie } }), runtime);
    expect(disconnect.status).toBe(200);
    expect(disconnect.headers.get('Set-Cookie')).toContain('__Host-elara_google_session=');
    const revokeRequest = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(new URLSearchParams(revokeRequest.body as URLSearchParams).get('token')).toBe('refresh-123');
    const status = await requireResponse(new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/status', { headers: { Origin: 'https://cryogenized-spec.github.io', Cookie: sessionCookie } }), runtime);
    expect(await status.json()).toEqual({ state: 'disconnected', grantedCapabilities: [] });
  });

  it('retries a provider 401 once with a refreshed access token', async () => {
    const runtime = env();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const sessionCookie = await establishCalendarSession(runtime, fetchMock);
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-456', expires_in: 3600, scope: 'openid email profile https://www.googleapis.com/auth/calendar.events.readonly' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const proxy = await requireResponse(new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/proxy', { method: 'GET', headers: { Origin: 'https://cryogenized-spec.github.io', Cookie: sessionCookie, 'X-Elara-Google-Capability': 'calendar.events.read', 'X-Elara-Google-Target': 'https://www.googleapis.com/calendar/v3/calendars/primary/events' } }), runtime);
    expect(proxy.status).toBe(200);
    const retriedProviderRequest = fetchMock.mock.calls[4]?.[1] as RequestInit;
    expect(new Headers(retriedProviderRequest?.headers).get('Authorization')).toBe('Bearer access-456');
  });
});
