import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./gis', () => ({
  requestGoogleAccessToken: vi.fn(),
  revokeGoogleAccessToken: vi.fn(),
}));

import { requestGoogleAccessToken, revokeGoogleAccessToken } from './gis';
import { googleOAuthAuthority } from './authority';
import { DRIVE_APP_FILE_SCOPE, DRIVE_LIBRARY_SCOPE } from './capability-policy';

const CALENDAR_READ_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
const OPENID_SCOPE = 'openid';
const EXPECTED_SCOPE = (scope: string) => `${scope} ${EMAIL_SCOPE} ${OPENID_SCOPE}`;

const tokenMock = vi.mocked(requestGoogleAccessToken);
const revokeMock = vi.mocked(revokeGoogleAccessToken);

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

describe('direct Google OAuth authority', () => {
  beforeEach(async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client.apps.googleusercontent.com');
    localStorage.clear();
    tokenMock.mockReset();
    revokeMock.mockReset();
    vi.restoreAllMocks();
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
    tokenMock.mockResolvedValueOnce(token('secret-access-token', 'https://www.googleapis.com/auth/calendar.events.readonly'));
    const authorized = await googleOAuthAuthority.authorize('calendar.events.read');

    expect(tokenMock).toHaveBeenCalledWith({
      clientId: 'test-client.apps.googleusercontent.com',
      scope: EXPECTED_SCOPE('https://www.googleapis.com/auth/calendar.events.readonly'),
      prompt: '',
    });
    const stored = localStorage.getItem('elara.google.authorization.v2') ?? '';
    expect(stored).toContain('calendar.events.read');
    expect(stored).toContain('calendar.events.readonly');
    expect(stored).not.toContain('secret-access-token');
    const status = await googleOAuthAuthority.getStatus();
    expect(status.enabledCapabilities).toContain('calendar.events.read');
    expect(status.grantedCapabilities).toContain('calendar.events.read');
    expect(status.grantedProviderScopes).toContain('https://www.googleapis.com/auth/calendar.events.readonly');
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
      grantedProviderScopes: [DRIVE_APP_FILE_SCOPE, 'https://www.googleapis.com/auth/calendar.events.readonly'],
      updatedAt: new Date().toISOString(),
    }));
    const status = await googleOAuthAuthority.getStatus();
    expect(status.enabledCapabilities).toEqual(expect.arrayContaining(['drive.files.app.read', 'calendar.events.read']));
    expect(status.grantedCapabilities).toEqual(expect.arrayContaining(['drive.files.app.read', 'docs.read', 'sheets.read', 'calendar.events.read']));
  });

  it('attaches the short-lived access token directly to an approved Google API request', async () => {
    tokenMock.mockResolvedValueOnce(token('access-123', 'https://www.googleapis.com/auth/calendar.events.readonly'));
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

  it('silently reacquires the token after a 401 and retries the same request body', async () => {
    tokenMock
      .mockResolvedValueOnce(token('access-old', 'https://www.googleapis.com/auth/calendar.events.readonly'))
      .mockResolvedValueOnce(token('access-new', 'https://www.googleapis.com/auth/calendar.events.readonly'));
    const authorized = await googleOAuthAuthority.authorize('calendar.events.read');
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String((input as { url?: string })?.url ?? input);
      if (String(url).includes('userinfo') || String(url).includes('openidconnect')) {
        return userinfoResponse();
      }
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
      scope: EXPECTED_SCOPE('https://www.googleapis.com/auth/calendar.events.readonly'),
      prompt: 'none',
    });
  });

  it('rejects non-Google API targets before network access', async () => {
    tokenMock.mockResolvedValueOnce(token('access-123', 'https://www.googleapis.com/auth/calendar.events.readonly'));
    const authorized = await googleOAuthAuthority.authorize('calendar.events.read');
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(authorized.fetch('https://example.com/steal')).rejects.toThrow('outside the approved API boundary');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disconnects the local authorization state and revokes the active token', async () => {
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

  it('writes account identity from userinfo after interactive authorization', async () => {
    tokenMock.mockResolvedValueOnce(token('access-123', CALENDAR_READ_SCOPE));
    await googleOAuthAuthority.authorize('calendar.events.read');
    const status = await googleOAuthAuthority.getStatus();
    expect(status.account?.email).toBe('test@example.com');
  });

  it('clears stale account when interactive userinfo fails', async () => {
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
