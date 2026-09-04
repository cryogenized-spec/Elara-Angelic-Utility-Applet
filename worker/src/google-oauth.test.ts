import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleGoogleOAuthRequest, type OAuthKV } from './google-oauth';

class MemoryKV implements OAuthKV {
  private readonly values = new Map<string, string>();
  async get(key: string, _type: 'text'): Promise<string | null> { return this.values.get(key) ?? null; }
  async put(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

const env = () => ({
  GOOGLE_OAUTH_KV: new MemoryKV(),
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://elara-gemini.cryogenized.workers.dev/api/google/oauth/callback',
  OAUTH_TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  APP_ORIGIN: 'https://cryogenized-spec.github.io/Elara-Angelic-Utility-Applet/',
  ALLOWED_ORIGINS: 'https://cryogenized-spec.github.io',
});

describe('protected Google OAuth Worker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an offline incremental authorization URL and a short-lived state cookie', async () => {
    const runtime = env();
    const request = new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/start?capability=calendar.events.read', {
      headers: { Origin: 'https://cryogenized-spec.github.io' },
    });

    const response = await handleGoogleOAuthRequest(request, runtime);
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
    const runtime = env();
    const request = new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/callback?state=attacker&code=code', {
      headers: { Cookie: 'elara_oauth_state=legitimate' },
    });

    const response = await handleGoogleOAuthRequest(request, runtime);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toContain('google=state_error');
  });

  it('exchanges the code, stores protected credentials, and establishes an HttpOnly session', async () => {
    const runtime = env();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-123', refresh_token: 'refresh-123', expires_in: 3600, scope: 'openid email profile https://www.googleapis.com/auth/calendar.events.readonly' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'google-sub-1', email: 'user@example.com', name: 'Example User' }), { status: 200 }));

    const start = await handleGoogleOAuthRequest(new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/start?capability=calendar.events.read', { headers: { Origin: 'https://cryogenized-spec.github.io' } }), runtime);
    const startBody = await start.json() as { authorizationUrl: string };
    const state = new URL(startBody.authorizationUrl).searchParams.get('state')!;
    const stateCookie = start.headers.get('Set-Cookie')!.split(';')[0];

    const callback = await handleGoogleOAuthRequest(new Request(`https://elara-gemini.cryogenized.workers.dev/api/google/oauth/callback?state=${encodeURIComponent(state)}&code=authorization-code`, { headers: { Cookie: stateCookie } }), runtime);
    const sessionCookie = callback.headers.get('Set-Cookie');

    expect(callback.status).toBe(303);
    expect(callback.headers.get('Location')).toBe('https://cryogenized-spec.github.io/Elara-Angelic-Utility-Applet/');
    expect(sessionCookie).toContain('__Host-elara_google_session=');
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=None');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns capability state without exposing stored tokens and proxies only an allowed Workspace target', async () => {
    const runtime = env();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-123', refresh_token: 'refresh-123', expires_in: 3600, scope: 'openid email profile https://www.googleapis.com/auth/calendar.events.readonly' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'google-sub-1', email: 'user@example.com', name: 'Example User' }), { status: 200 }));

    const start = await handleGoogleOAuthRequest(new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/start?capability=calendar.events.read', { headers: { Origin: 'https://cryogenized-spec.github.io' } }), runtime);
    const state = new URL((await start.json() as { authorizationUrl: string }).authorizationUrl).searchParams.get('state')!;
    const stateCookie = start.headers.get('Set-Cookie')!.split(';')[0];
    const callback = await handleGoogleOAuthRequest(new Request(`https://elara-gemini.cryogenized.workers.dev/api/google/oauth/callback?state=${encodeURIComponent(state)}&code=authorization-code`, { headers: { Cookie: stateCookie } }), runtime);
    const sessionCookie = callback.headers.get('Set-Cookie')!.split(';')[0];

    const status = await handleGoogleOAuthRequest(new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/status', { headers: { Origin: 'https://cryogenized-spec.github.io', Cookie: sessionCookie } }), runtime);
    const statusBody = await status.json() as Record<string, unknown>;
    expect(statusBody).toEqual(expect.objectContaining({ state: 'partially-authorized' }));
    expect(JSON.stringify(statusBody)).not.toContain('refresh-123');
    expect(JSON.stringify(statusBody)).not.toContain('access-123');

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const proxy = await handleGoogleOAuthRequest(new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/proxy', {
      method: 'GET',
      headers: {
        Origin: 'https://cryogenized-spec.github.io',
        Cookie: sessionCookie,
        'X-Elara-Google-Capability': 'calendar.events.read',
        'X-Elara-Google-Target': 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      },
    }), runtime);

    expect(proxy.status).toBe(200);
    const providerRequest = fetchMock.mock.calls[2]?.[0] as URL;
    expect(String(providerRequest)).toContain('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    const providerOptions = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(new Headers(providerOptions?.headers).get('Authorization')).toBe('Bearer access-123');
  });

  it('advertises the proxy target header during credentialed browser preflight', async () => {
    const runtime = env();
    const response = await handleGoogleOAuthRequest(new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/proxy', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://cryogenized-spec.github.io',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'content-type, x-elara-google-capability, x-elara-google-target',
      },
    }), runtime);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://cryogenized-spec.github.io');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-Elara-Google-Target');
  });

  it('rejects a Google target outside the capability allow-list before contacting the provider', async () => {
    const runtime = env();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const response = await handleGoogleOAuthRequest(new Request('https://elara-gemini.cryogenized.workers.dev/api/google/oauth/proxy', {
      method: 'GET',
      headers: {
        Origin: 'https://cryogenized-spec.github.io',
        Cookie: '__Host-elara_google_session=missing',
        'X-Elara-Google-Capability': 'calendar.events.read',
        'X-Elara-Google-Target': 'https://example.com/steal',
      },
    }), runtime);

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
