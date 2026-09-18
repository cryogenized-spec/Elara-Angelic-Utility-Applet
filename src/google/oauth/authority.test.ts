import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./gis', () => ({
  requestGoogleAccessToken: vi.fn(),
  revokeGoogleAccessToken: vi.fn(),
}));

vi.mock('./code-flow', () => ({
  requestGoogleAuthorizationCode: vi.fn(),
}));

vi.mock('../../autonomy/cloud/pairing', () => ({
  loadPairing: vi.fn(() => null),
  resolvePairingToken: vi.fn(async () => ''),
}));

import { requestGoogleAccessToken, revokeGoogleAccessToken } from './gis';
import { requestGoogleAuthorizationCode } from './code-flow';
import { loadPairing, resolvePairingToken } from '../../autonomy/cloud/pairing';
import { googleOAuthAuthority } from './authority';
import { DRIVE_APP_FILE_SCOPE, DRIVE_LIBRARY_SCOPE } from './capability-policy';

const CALENDAR_READ_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const CALENDAR_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
const OPENID_SCOPE = 'openid';
const EXPECTED_SCOPE = (scope: string) => `${scope} ${EMAIL_SCOPE} ${OPENID_SCOPE}`;

const tokenMock = vi.mocked(requestGoogleAccessToken);
const revokeMock = vi.mocked(revokeGoogleAccessToken);
const codeMock = vi.mocked(requestGoogleAuthorizationCode);
const pairingMock = vi.mocked(loadPairing);
const pairingTokenMock = vi.mocked(resolvePairingToken);

const TEST_PAIRING = {
  workerUrl: 'https://worker.example',
  token: '',
  installationId: 'test-installation',
  workerVersion: 'test',
  schemaVersion: 1,
  pairedAt: 1,
  lastSyncedAt: null,
  lastSyncedContextHash: null,
  lastPulledRunsAt: 0,
  lastPulledRunsId: '',
  lastPulledEventsAt: 0,
  lastPulledEventsId: '',
};

function token(accessToken: string, scope: string, expiresIn = 3600) {
  return { access_token: accessToken, expires_in: expiresIn, scope };
}

function userinfoResponse(email = 'test@example.com') {
  return new Response(JSON.stringify({ email, name: 'Test User' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installUserinfoFetch(email = 'test@example.com') {
  globalThis.fetch = vi.fn().mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String((input as { url?: string })?.url ?? input);
    if (String(url).includes('userinfo') || String(url).includes('openidconnect')) {
      return userinfoResponse(email);
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
}

function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return input instanceof Request ? input.method : init?.method ?? 'GET';
}

describe('direct Google OAuth authority', () => {
  beforeEach(async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client.apps.googleusercontent.com');
    pairingMock.mockReturnValue(null);
    pairingTokenMock.mockResolvedValue('');
    localStorage.clear();
    tokenMock.mockReset();
    revokeMock.mockReset();
    codeMock.mockReset();
    vi.restoreAllMocks();
    pairingMock.mockReturnValue(null);
    pairingTokenMock.mockResolvedValue('');
    await googleOAuthAuthority.disconnect();
    installUserinfoFetch();
  });

  it('starts disconnected without local authorization metadata', async () => {
    await expect(googleOAuthAuthority.getStatus()).resolves.toEqual({
      state: 'disconnected',
      grantedCapabilities: [],
      enabledCapabilities: [],
      grantedProviderScopes: [],
    });
  });

  it('records GIS scopes and persists metadata without persisting the access token', async () => {
    tokenMock.mockResolvedValueOnce(token('secret-access-token', CALENDAR_READ_SCOPE));
    const authorized = await googleOAuthAuthority.authorize('calendar.events.read');

    expect(tokenMock).toHaveBeenCalledWith({
      clientId: 'test-client.apps.googleusercontent.com',
      scope: EXPECTED_SCOPE(CALENDAR_READ_SCOPE),
      prompt: '',
    });
    const stored = localStorage.getItem('elara.google.authorization.v2') ?? '';
    expect(stored).toContain('calendar.events.read');
    expect(stored).toContain('calendar.events.readonly');
    expect(stored).not.toContain('secret-access-token');
    const status = await googleOAuthAuthority.getStatus();
    expect(status.enabledCapabilities).toContain('calendar.events.read');
    expect(status.grantedCapabilities).toContain('calendar.events.read');
    expect(status.grantedProviderScopes).toContain(CALENDAR_READ_SCOPE);
    expect(status.account?.email).toBe('test@example.com');
    expect(authorized.capability).toBe('calendar.events.read');
  });

  it('infers sibling Drive/Docs/Sheets reads from drive.file without inferring writes', async () => {
    tokenMock.mockResolvedValueOnce(token('access-drive', DRIVE_APP_FILE_SCOPE));
    await googleOAuthAuthority.authorize('docs.read');
    const status = await googleOAuthAuthority.getStatus();
    expect(status.enabledCapabilities).toEqual(['docs.read']);
    expect(status.grantedCapabilities).toEqual(expect.arrayContaining(['docs.read', 'sheets.read', 'drive.files.app.read']));
    expect(status.grantedCapabilities).not.toContain('docs.write');
    expect(status.grantedCapabilities).not.toContain('sheets.write');
    expect(status.grantedCapabilities).not.toContain('drive.files.app.write');
    expect(status.state).toBe('partially-authorized');
  });

  it('migrates legacy Drive capability names from v2 storage', async () => {
    localStorage.setItem('elara.google.authorization.v2', JSON.stringify({
      version: 2,
      grantedCapabilities: ['drive.files.read', 'calendar.events.read'],
      grantedProviderScopes: [DRIVE_APP_FILE_SCOPE, CALENDAR_READ_SCOPE],
      updatedAt: new Date().toISOString(),
    }));
    const status = await googleOAuthAuthority.getStatus();
    expect(status.enabledCapabilities).toEqual(expect.arrayContaining(['drive.files.app.read', 'calendar.events.read']));
    expect(status.grantedCapabilities).toEqual(expect.arrayContaining(['drive.files.app.read', 'docs.read', 'sheets.read', 'calendar.events.read']));
  });

  it('attaches the short-lived access token directly to an approved Google API request', async () => {
    tokenMock.mockResolvedValueOnce(token('access-123', CALENDAR_READ_SCOPE));
    const authorized = await googleOAuthAuthority.authorize('calendar.events.read');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"items":[]}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await authorized.fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events');

    expect(response.status).toBe(200);
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toContain('/calendar/v3/calendars/primary/events');
    expect(request.headers.get('Authorization')).toBe('Bearer access-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('silently reacquires the browser token after a 401 and retries the same request body', async () => {
    tokenMock
      .mockResolvedValueOnce(token('access-old', CALENDAR_READ_SCOPE))
      .mockResolvedValueOnce(token('access-new', CALENDAR_READ_SCOPE));
    const authorized = await googleOAuthAuthority.authorize('calendar.events.read');
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String((input as { url?: string })?.url ?? input);
      if (String(url).includes('userinfo') || String(url).includes('openidconnect')) return userinfoResponse();
      callCount += 1;
      if (callCount === 1) return new Response('expired', { status: 401 });
      return new Response('ok', { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await authorized.fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: 'same body' }),
    });

    expect(response.status).toBe(200);
    expect(tokenMock).toHaveBeenLastCalledWith({
      clientId: 'test-client.apps.googleusercontent.com',
      scope: EXPECTED_SCOPE(CALENDAR_READ_SCOPE),
      prompt: 'none',
    });
  });

  it('rechecks caller authority immediately before a post-401 provider retry', async () => {
    tokenMock
      .mockResolvedValueOnce(token('access-old', CALENDAR_READ_SCOPE))
      .mockResolvedValueOnce(token('access-new', CALENDAR_READ_SCOPE));
    const authorized = await googleOAuthAuthority.authorize('calendar.events.read');
    let active = true;
    let apiCalls = 0;
    const fetchMock = vi.fn().mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes('userinfo') || url.includes('openidconnect')) return userinfoResponse();
      apiCalls += 1;
      if (apiCalls === 1) {
        active = false;
        return new Response('expired', { status: 401 });
      }
      return new Response('should-not-run', { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const assertActive = () => {
      if (!active) throw new DOMException('stale turn', 'AbortError');
    };

    await expect(authorized.fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: 'guarded' }) },
      assertActive,
    )).rejects.toMatchObject({ name: 'AbortError' });

    expect(apiCalls).toBe(1);
    expect(tokenMock).toHaveBeenLastCalledWith({
      clientId: 'test-client.apps.googleusercontent.com',
      scope: EXPECTED_SCOPE(CALENDAR_READ_SCOPE),
      prompt: 'none',
    });
  });

  it('uses the paired self-hosted Worker code flow and never stores durable credentials in browser storage', async () => {
    pairingMock.mockReturnValue(TEST_PAIRING);
    pairingTokenMock.mockResolvedValue('test-installation-secret');
    codeMock.mockResolvedValue({ code: 'one-time-code', scope: `${CALENDAR_READ_SCOPE} ${EMAIL_SCOPE}` });
    let connected = false;

    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = requestMethod(input, init);
      if (url === 'https://worker.example/google/oauth/status' && method === 'GET') {
        return new Response(JSON.stringify(connected
          ? { connected: true, scopes: [CALENDAR_READ_SCOPE, EMAIL_SCOPE], account: { email: 'durable@example.com', displayName: 'Durable User' }, updatedAt: 100 }
          : { connected: false, scopes: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://worker.example/google/oauth/exchange' && method === 'POST') {
        connected = true;
        const request = input instanceof Request ? input : new Request(url, init);
        expect(request.headers.get('X-Requested-With')).toBe('XmlHttpRequest');
        expect(request.headers.get('X-Elara-Signature')).toBeTruthy();
        expect(await request.json()).toEqual({ code: 'one-time-code', redirectUri: window.location.origin });
        return new Response(JSON.stringify({
          connected: true,
          accessToken: 'durable-access-token',
          expiresIn: 3600,
          scopes: [CALENDAR_READ_SCOPE, EMAIL_SCOPE],
          account: { email: 'durable@example.com', displayName: 'Durable User' },
          updatedAt: 100,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await googleOAuthAuthority.authorize('calendar.events.read');

    expect(codeMock).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'test-client.apps.googleusercontent.com',
      scope: EXPECTED_SCOPE(CALENDAR_READ_SCOPE),
    }));
    expect(tokenMock).not.toHaveBeenCalled();
    const persisted = localStorage.getItem('elara.google.authorization.v2') ?? '';
    expect(persisted).toContain('calendar.events.read');
    expect(persisted).toContain('durable@example.com');
    expect(persisted).not.toContain('durable-access-token');
    expect(persisted).not.toContain('test-installation-secret');
  });

  it('does not let paired provider scopes silently enable a local write capability', async () => {
    pairingMock.mockReturnValue(TEST_PAIRING);
    pairingTokenMock.mockResolvedValue('test-installation-secret');
    localStorage.setItem('elara.google.authorization.v2', JSON.stringify({
      version: 3,
      enabledCapabilities: ['calendar.events.read'],
      grantedProviderScopes: [CALENDAR_READ_SCOPE],
      account: { email: 'durable@example.com' },
      updatedAt: new Date().toISOString(),
    }));
    codeMock.mockResolvedValue({ code: 'explicit-write-consent-code', scope: `${CALENDAR_WRITE_SCOPE} ${EMAIL_SCOPE}` });
    let exchangeCalls = 0;
    let refreshCalls = 0;

    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = requestMethod(input, init);
      if (url === 'https://worker.example/google/oauth/status' && method === 'GET') {
        return new Response(JSON.stringify({
          connected: true,
          scopes: [CALENDAR_READ_SCOPE, CALENDAR_WRITE_SCOPE, EMAIL_SCOPE],
          account: { email: 'durable@example.com' },
          updatedAt: 250,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://worker.example/google/oauth/exchange' && method === 'POST') {
        exchangeCalls += 1;
        return new Response(JSON.stringify({
          connected: true,
          accessToken: 'write-consented-access-token',
          expiresIn: 3600,
          scopes: [CALENDAR_READ_SCOPE, CALENDAR_WRITE_SCOPE, EMAIL_SCOPE],
          account: { email: 'durable@example.com' },
          updatedAt: 251,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://worker.example/google/oauth/token' && method === 'POST') {
        refreshCalls += 1;
        return new Response(JSON.stringify({
          connected: true,
          accessToken: 'scope-only-refresh-token',
          expiresIn: 3600,
          scopes: [CALENDAR_READ_SCOPE, CALENDAR_WRITE_SCOPE, EMAIL_SCOPE],
          account: { email: 'durable@example.com' },
          updatedAt: 250,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;

    await googleOAuthAuthority.authorize('calendar.events.write');

    expect(codeMock).toHaveBeenCalledWith(expect.objectContaining({
      scope: EXPECTED_SCOPE(CALENDAR_WRITE_SCOPE),
    }));
    expect(exchangeCalls).toBe(1);
    expect(refreshCalls).toBe(0);
    const persisted = JSON.parse(localStorage.getItem('elara.google.authorization.v2') ?? '{}') as { enabledCapabilities?: string[] };
    expect(persisted.enabledCapabilities).toEqual(expect.arrayContaining(['calendar.events.read', 'calendar.events.write']));
  });

  it('refreshes a paired durable grant without opening GIS again after browser session loss', async () => {
    pairingMock.mockReturnValue(TEST_PAIRING);
    pairingTokenMock.mockResolvedValue('test-installation-secret');
    localStorage.setItem('elara.google.authorization.v2', JSON.stringify({
      version: 3,
      enabledCapabilities: ['calendar.events.read'],
      grantedProviderScopes: [CALENDAR_READ_SCOPE],
      account: { email: 'durable@example.com' },
      updatedAt: new Date().toISOString(),
    }));

    let refreshCalls = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = requestMethod(input, init);
      if (url === 'https://worker.example/google/oauth/status' && method === 'GET') {
        return new Response(JSON.stringify({ connected: true, scopes: [CALENDAR_READ_SCOPE], account: { email: 'durable@example.com' }, updatedAt: 200 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://worker.example/google/oauth/token' && method === 'POST') {
        refreshCalls += 1;
        return new Response(JSON.stringify({
          connected: true,
          accessToken: 'refreshed-durable-access-token',
          expiresIn: 3600,
          scopes: [CALENDAR_READ_SCOPE],
          account: { email: 'durable@example.com' },
          updatedAt: 200,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;

    await googleOAuthAuthority.authorize('calendar.events.read');

    expect(refreshCalls).toBe(1);
    expect(codeMock).not.toHaveBeenCalled();
    expect(tokenMock).not.toHaveBeenCalled();
  });

  it('invalidates an unexpired paired browser token when the authoritative vault revision changes', async () => {
    pairingMock.mockReturnValue(TEST_PAIRING);
    pairingTokenMock.mockResolvedValue('test-installation-secret');
    codeMock.mockResolvedValue({ code: 'initial-code', scope: `${CALENDAR_READ_SCOPE} ${EMAIL_SCOPE}` });
    let revision = 300;
    let account = 'account-a@example.com';
    let refreshCalls = 0;
    const apiTokens: string[] = [];

    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = requestMethod(input, init);
      if (url === 'https://worker.example/google/oauth/status' && method === 'GET') {
        return new Response(JSON.stringify({ connected: true, scopes: [CALENDAR_READ_SCOPE, EMAIL_SCOPE], account: { email: account }, updatedAt: revision }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://worker.example/google/oauth/exchange' && method === 'POST') {
        return new Response(JSON.stringify({
          connected: true,
          accessToken: 'access-account-a',
          expiresIn: 3600,
          scopes: [CALENDAR_READ_SCOPE, EMAIL_SCOPE],
          account: { email: account },
          updatedAt: revision,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://worker.example/google/oauth/token' && method === 'POST') {
        refreshCalls += 1;
        return new Response(JSON.stringify({
          connected: true,
          accessToken: 'access-account-b',
          expiresIn: 3600,
          scopes: [CALENDAR_READ_SCOPE, EMAIL_SCOPE],
          account: { email: account },
          updatedAt: revision,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.startsWith('https://www.googleapis.com/calendar/v3/') && method === 'GET') {
        const request = input instanceof Request ? input : new Request(url, init);
        apiTokens.push(request.headers.get('Authorization') ?? '');
        return new Response('{"items":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const authorized = await googleOAuthAuthority.authorize('calendar.events.read');
    refreshCalls = 0;
    revision = 301;
    account = 'account-b@example.com';

    const response = await authorized.fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events');

    expect(response.status).toBe(200);
    expect(refreshCalls).toBe(1);
    expect(apiTokens).toEqual(['Bearer access-account-b']);
    expect(apiTokens).not.toContain('Bearer access-account-a');
    expect((await googleOAuthAuthority.getStatus()).account?.email).toBe('account-b@example.com');
  });

  it('rejects non-Google API targets before network access', async () => {
    tokenMock.mockResolvedValueOnce(token('access-123', CALENDAR_READ_SCOPE));
    const authorized = await googleOAuthAuthority.authorize('calendar.events.read');
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(authorized.fetch('https://example.com/steal')).rejects.toThrow('outside the approved API boundary');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disconnects the local browser authorization state and revokes the active token', async () => {
    tokenMock.mockResolvedValueOnce(token('access-123', CALENDAR_READ_SCOPE));
    await googleOAuthAuthority.authorize('calendar.events.read');
    await googleOAuthAuthority.disconnect();

    expect(revokeMock).toHaveBeenCalledWith('access-123');
    await expect(googleOAuthAuthority.getStatus()).resolves.toEqual({
      state: 'disconnected',
      grantedCapabilities: [],
      enabledCapabilities: [],
      grantedProviderScopes: [],
    });
    expect(localStorage.getItem('elara.google.authorization.v2')).toBeNull();
  });

  it('replaces the stored provider-scope set with the current token response instead of accumulating history', async () => {
    tokenMock.mockResolvedValueOnce(token('access-drive', DRIVE_APP_FILE_SCOPE));
    await googleOAuthAuthority.authorize('drive.files.app.read');

    tokenMock.mockResolvedValueOnce(token('access-calendar', CALENDAR_READ_SCOPE));
    await googleOAuthAuthority.authorize('calendar.events.read');

    const status = await googleOAuthAuthority.getStatus();
    expect(status.grantedProviderScopes).toEqual([CALENDAR_READ_SCOPE]);
    expect(status.enabledCapabilities).toEqual(expect.arrayContaining(['drive.files.app.read', 'calendar.events.read']));
    expect(status.grantedCapabilities).not.toContain('drive.files.app.read');
    expect(status.grantedCapabilities).not.toContain('docs.read');
    expect(status.grantedCapabilities).not.toContain('sheets.read');
    expect(status.grantedCapabilities).toContain('calendar.events.read');
  });

  it('retains existing grants when Google omits the scope header, only asserting the requested scope', async () => {
    tokenMock.mockResolvedValueOnce(token('access-drive', DRIVE_APP_FILE_SCOPE));
    await googleOAuthAuthority.authorize('drive.files.app.read');

    tokenMock.mockResolvedValueOnce({ access_token: 'access-calendar', expires_in: 3600 });
    await googleOAuthAuthority.authorize('calendar.events.read');

    const status = await googleOAuthAuthority.getStatus();
    expect(status.grantedProviderScopes).toEqual(expect.arrayContaining([DRIVE_APP_FILE_SCOPE, CALENDAR_READ_SCOPE]));
    expect(status.grantedCapabilities).toContain('drive.files.app.read');
    expect(status.grantedCapabilities).toContain('calendar.events.read');
  });

  it('clears Drive grants when a fresh consent response returns Drive scopes without the old write-side grant', async () => {
    tokenMock.mockResolvedValueOnce(token('access-drive', DRIVE_APP_FILE_SCOPE));
    await googleOAuthAuthority.authorize('drive.files.app.read');
    tokenMock.mockResolvedValueOnce(token('access-calendar', CALENDAR_READ_SCOPE));
    await googleOAuthAuthority.authorize('calendar.events.read');

    tokenMock.mockResolvedValueOnce(token('access-drive-2', DRIVE_APP_FILE_SCOPE));
    await googleOAuthAuthority.authorize('drive.files.app.read');

    const status = await googleOAuthAuthority.getStatus();
    expect(status.grantedProviderScopes).toEqual([DRIVE_APP_FILE_SCOPE]);
    expect(status.grantedCapabilities).not.toContain('calendar.events.read');
    expect(status.grantedCapabilities).toContain('docs.read');
  });

  it('honors v2-era capability records without a scope manifest as granted, without sibling inference', async () => {
    localStorage.setItem('elara.google.authorization.v2', JSON.stringify({
      version: 2,
      grantedCapabilities: ['calendar.events.read', 'tasks.read', 'drive.files.app.read'],
      account: { email: 'test@example.com' },
      updatedAt: new Date().toISOString(),
    }));
    const status = await googleOAuthAuthority.getStatus();
    expect(status.enabledCapabilities).toEqual(expect.arrayContaining(['calendar.events.read', 'tasks.read', 'drive.files.app.read']));
    expect(status.grantedCapabilities).toEqual(expect.arrayContaining(['calendar.events.read', 'tasks.read', 'drive.files.app.read']));
    expect(status.state).toBe('partially-authorized');
    expect(status.grantedCapabilities).not.toContain('docs.read');
    expect(status.grantedCapabilities).not.toContain('sheets.read');
    expect(status.grantedProviderScopes).toEqual([]);
  });

  it('supersedes legacy capability evidence with the next token acquisition', async () => {
    localStorage.setItem('elara.google.authorization.v2', JSON.stringify({
      version: 2,
      grantedCapabilities: ['calendar.events.read', 'tasks.read', 'drive.files.app.read'],
      account: { email: 'test@example.com' },
      updatedAt: new Date().toISOString(),
    }));
    tokenMock.mockResolvedValueOnce(token('access-calendar', CALENDAR_READ_SCOPE));
    await googleOAuthAuthority.authorize('calendar.events.read');

    const status = await googleOAuthAuthority.getStatus();
    expect(status.grantedProviderScopes).toEqual([CALENDAR_READ_SCOPE]);
    expect(status.grantedCapabilities).toEqual(['calendar.events.read']);
    expect(status.grantedCapabilities).not.toContain('tasks.read');
    expect(status.grantedCapabilities).not.toContain('drive.files.app.read');
  });

  it('replacing scopes never manufactures a grant the new token does not carry', async () => {
    tokenMock.mockResolvedValueOnce(token('access-library', DRIVE_LIBRARY_SCOPE));
    await googleOAuthAuthority.authorize('drive.library.read');
    tokenMock.mockResolvedValueOnce(token('access-calendar', CALENDAR_READ_SCOPE));
    await googleOAuthAuthority.authorize('calendar.events.read');

    const status = await googleOAuthAuthority.getStatus();
    expect(status.grantedProviderScopes).toEqual([CALENDAR_READ_SCOPE]);
    expect(status.grantedCapabilities).toEqual(['calendar.events.read']);
    expect(status.state).toBe('partially-authorized');
  });

  it('writes account identity from userinfo after interactive browser authorization', async () => {
    tokenMock.mockResolvedValueOnce(token('access-123', CALENDAR_READ_SCOPE));
    await googleOAuthAuthority.authorize('calendar.events.read');
    const status = await googleOAuthAuthority.getStatus();
    expect(status.account?.email).toBe('test@example.com');
  });

  it('clears stale account when interactive browser userinfo fails', async () => {
    localStorage.setItem('elara.google.authorization.v2', JSON.stringify({
      version: 3,
      enabledCapabilities: ['calendar.events.read'],
      grantedProviderScopes: [CALENDAR_READ_SCOPE],
      account: { email: 'old@example.com' },
      needsReauthorization: true,
      updatedAt: new Date().toISOString(),
    }));
    tokenMock.mockResolvedValueOnce(token('access-new', CALENDAR_READ_SCOPE));
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 })) as unknown as typeof fetch;
    await googleOAuthAuthority.authorize('calendar.events.read');
    const status = await googleOAuthAuthority.getStatus();
    expect(status.account).toBeUndefined();
  });
});
