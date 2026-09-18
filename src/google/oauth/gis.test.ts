import { afterEach, describe, expect, it } from 'vitest';
import { requestGoogleAccessToken } from './gis';

type FakeCallback = (response: { access_token?: string; scope?: string; error?: string; error_description?: string }) => void;

function installFakeGoogle() {
  const clients: Array<{ scope: string; callback: FakeCallback; requested: number }> = [];
  const fake = {
    accounts: { oauth2: {
      initTokenClient: (config: { scope: string; callback: FakeCallback }) => {
        const client = { scope: config.scope, callback: config.callback, requested: 0 };
        clients.push(client);
        return { requestAccessToken: () => { client.requested += 1; } };
      },
      revoke: (_accessToken: string, callback: (response: unknown) => void) => callback({}),
    } },
  };
  Object.defineProperty(window, 'google', { value: fake, configurable: true });
  return clients;
}

const CALENDAR_READ_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

async function settle(): Promise<void> {
  // GIS script loader resolves through a promise chain; flush enough turns for
  // both the loader and initTokenClient to run.
  await Promise.resolve();
  await Promise.resolve();
}

describe('GIS single-flight token requests', () => {
  afterEach(() => {
    delete (window as { google?: unknown }).google;
  });

  it('deduplicates concurrent requests for the same scope onto one provider exchange', async () => {
    const clients = installFakeGoogle();

    const first = requestGoogleAccessToken({ clientId: 'client', scope: CALENDAR_READ_SCOPE, prompt: '' });
    const second = requestGoogleAccessToken({ clientId: 'client', scope: CALENDAR_READ_SCOPE, prompt: '' });
    await settle();

    expect(clients).toHaveLength(1);
    expect(clients[0]?.requested).toBe(1);
    clients[0]?.callback({ access_token: 'calendar-token', scope: CALENDAR_READ_SCOPE });

    const [a, b] = await Promise.all([first, second]);
    expect(a.access_token).toBe('calendar-token');
    expect(b.access_token).toBe('calendar-token');
  });

  it('keeps requests for different scopes on separate exchanges so each caller gets its own token', async () => {
    const clients = installFakeGoogle();

    const calendarRequest = requestGoogleAccessToken({ clientId: 'client', scope: CALENDAR_READ_SCOPE, prompt: '' });
    const gmailRequest = requestGoogleAccessToken({ clientId: 'client', scope: GMAIL_READ_SCOPE, prompt: '' });
    await settle();

    expect(clients).toHaveLength(2);
    expect(clients.map((client) => client.scope)).toEqual([CALENDAR_READ_SCOPE, GMAIL_READ_SCOPE]);

    clients[0]?.callback({ access_token: 'calendar-token', scope: CALENDAR_READ_SCOPE });
    clients[1]?.callback({ access_token: 'gmail-token', scope: GMAIL_READ_SCOPE });

    const [calendarResponse, gmailResponse] = await Promise.all([calendarRequest, gmailRequest]);
    expect(calendarResponse.access_token).toBe('calendar-token');
    expect(calendarResponse.scope).toBe(CALENDAR_READ_SCOPE);
    expect(gmailResponse.access_token).toBe('gmail-token');
    expect(gmailResponse.scope).toBe(GMAIL_READ_SCOPE);
  });

  it('never lets a silent prompt-none request ride an interactive consent popup', async () => {
    const clients = installFakeGoogle();

    const interactive = requestGoogleAccessToken({ clientId: 'client', scope: CALENDAR_READ_SCOPE, prompt: '' });
    const silent = requestGoogleAccessToken({ clientId: 'client', scope: CALENDAR_READ_SCOPE, prompt: 'none' });
    await settle();

    expect(clients).toHaveLength(2);
    clients[0]?.callback({ access_token: 'interactive-token', scope: CALENDAR_READ_SCOPE });
    clients[1]?.callback({ access_token: 'silent-token', scope: CALENDAR_READ_SCOPE });

    const [interactiveResponse, silentResponse] = await Promise.all([interactive, silent]);
    expect(interactiveResponse.access_token).toBe('interactive-token');
    expect(silentResponse.access_token).toBe('silent-token');
  });

  it('keys single-flight by scope, not by client, and clears each request after settlement', async () => {
    const clients = installFakeGoogle();

    const calendarA = requestGoogleAccessToken({ clientId: 'client', scope: CALENDAR_READ_SCOPE, prompt: '' });
    await settle();
    clients[0]?.callback({ access_token: 'first-calendar-token', scope: CALENDAR_READ_SCOPE });
    await calendarA;

    // The finished request must be cleared: a later request opens a fresh exchange.
    const calendarB = requestGoogleAccessToken({ clientId: 'client', scope: CALENDAR_READ_SCOPE, prompt: '' });
    await settle();
    expect(clients).toHaveLength(2);
    clients[1]?.callback({ access_token: 'second-calendar-token', scope: CALENDAR_READ_SCOPE });
    await expect(calendarB).resolves.toMatchObject({ access_token: 'second-calendar-token' });
  });

  it('rejects every caller sharing a failed exchange', async () => {
    const clients = installFakeGoogle();

    const first = requestGoogleAccessToken({ clientId: 'client', scope: CALENDAR_READ_SCOPE, prompt: 'none' });
    const second = requestGoogleAccessToken({ clientId: 'client', scope: CALENDAR_READ_SCOPE, prompt: 'none' });
    await settle();

    expect(clients).toHaveLength(1);
    clients[0]?.callback({ error: 'invalid_grant', error_description: 'Token is stale' });

    await expect(first).rejects.toThrow('Token is stale');
    await expect(second).rejects.toThrow('Token is stale');
  });
});
