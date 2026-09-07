import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./gis', () => ({
  requestGoogleAccessToken: vi.fn(),
  revokeGoogleAccessToken: vi.fn(),
}));

import { requestGoogleAccessToken, revokeGoogleAccessToken } from './gis';
import { googleOAuthAuthority } from './authority';

const tokenMock = vi.mocked(requestGoogleAccessToken);
const revokeMock = vi.mocked(revokeGoogleAccessToken);

function token(accessToken: string, expiresIn = 3600) {
  return { access_token: accessToken, expires_in: expiresIn, scope: 'https://www.googleapis.com/auth/calendar.events.readonly' };
}

describe('direct Google OAuth authority', () => {
  beforeEach(async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client.apps.googleusercontent.com');
    localStorage.clear();
    tokenMock.mockReset();
    revokeMock.mockReset();
    vi.restoreAllMocks();
    await googleOAuthAuthority.disconnect();
  });

  it('starts disconnected without local authorization metadata', async () => {
    await expect(googleOAuthAuthority.getStatus()).resolves.toEqual({ state: 'disconnected', grantedCapabilities: [] });
  });

  it('requests only the capability scope and persists metadata without persisting the access token', async () => {
    tokenMock.mockResolvedValueOnce(token('secret-access-token'));
    const authorized = await googleOAuthAuthority.authorize('calendar.events.read');

    expect(tokenMock).toHaveBeenCalledWith({
      clientId: 'test-client.apps.googleusercontent.com',
      scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
      prompt: '',
    });
    const stored = localStorage.getItem('elara.google.authorization.v2') ?? '';
    expect(stored).toContain('calendar.events.read');
    expect(stored).not.toContain('secret-access-token');
    expect((await googleOAuthAuthority.getStatus()).grantedCapabilities).toContain('calendar.events.read');
    expect(authorized.capability).toBe('calendar.events.read');
  });

  it('attaches the short-lived access token directly to an approved Google API request', async () => {
    tokenMock.mockResolvedValueOnce(token('access-123'));
    const authorized = await googleOAuthAuthority.authorize('calendar.events.read');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"items":[]}', { status: 200 }));

    const response = await authorized.fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events');

    expect(response.status).toBe(200);
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toContain('/calendar/v3/calendars/primary/events');
    expect(request.headers.get('Authorization')).toBe('Bearer access-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('silently reacquires the token after a 401 and retries the same request body', async () => {
    tokenMock
      .mockResolvedValueOnce(token('access-old'))
      .mockResolvedValueOnce(token('access-new'));
    const authorized = await googleOAuthAuthority.authorize('calendar.events.read');
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const response = await authorized.fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: 'same body' }),
    });

    expect(response.status).toBe(200);
    expect(tokenMock).toHaveBeenLastCalledWith({
      clientId: 'test-client.apps.googleusercontent.com',
      scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
      prompt: 'none',
    });
    const first = fetchMock.mock.calls[0]?.[0] as Request;
    const second = fetchMock.mock.calls[1]?.[0] as Request;
    expect(first.headers.get('Authorization')).toBe('Bearer access-old');
    expect(second.headers.get('Authorization')).toBe('Bearer access-new');
    expect(await second.text()).toBe(JSON.stringify({ summary: 'same body' }));
  });

  it('rejects non-Google API targets before network access', async () => {
    tokenMock.mockResolvedValueOnce(token('access-123'));
    const authorized = await googleOAuthAuthority.authorize('calendar.events.read');
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(authorized.fetch('https://example.com/steal')).rejects.toThrow('outside the approved API boundary');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disconnects the local authorization state and revokes the active token', async () => {
    tokenMock.mockResolvedValueOnce(token('access-123'));
    await googleOAuthAuthority.authorize('calendar.events.read');
    await googleOAuthAuthority.disconnect();

    expect(revokeMock).toHaveBeenCalledWith('access-123');
    await expect(googleOAuthAuthority.getStatus()).resolves.toEqual({ state: 'disconnected', grantedCapabilities: [] });
    expect(localStorage.getItem('elara.google.authorization.v2')).toBeNull();
  });
});
