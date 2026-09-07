import { describe, expect, it } from 'vitest';
import { GoogleCalendarService } from './service';
import type { GoogleOAuthAuthority } from '../oauth/contracts';

describe('GoogleCalendarService', () => {
  const oauth: GoogleOAuthAuthority = {
    authorize: async (capability) => ({
      capability,
      fetch: async () => new Response(JSON.stringify({
        items: [{
          id: 'event-1',
          summary: 'Design review',
          start: { dateTime: '2026-09-03T10:00:00Z' },
          end: { dateTime: '2026-09-03T11:00:00Z' },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    }),
    getStatus: async () => ({ state: 'connected', grantedCapabilities: [] }),
    disconnect: async () => undefined,
  };

  it('requires the registered calendar read capability and maps events', async () => {
    let requestedCapability: string | undefined;
    const access = await oauth.authorize('calendar.events.read');
    requestedCapability = access.capability;
    const service = new GoogleCalendarService({ ...oauth, authorize: async (capability) => ({ capability, fetch: access.fetch }) });

    await expect(service.listEvents()).resolves.toEqual([
      { id: 'event-1', summary: 'Design review', start: '2026-09-03T10:00:00Z', end: '2026-09-03T11:00:00Z' },
    ]);
    expect(requestedCapability).toBe('calendar.events.read');
  });

  it('rejects oversized Calendar inputs before authorization', async () => {
    let authorizeCalls = 0;
    const service = new GoogleCalendarService({
      ...oauth,
      authorize: async (capability) => {
        authorizeCalls += 1;
        return oauth.authorize(capability);
      },
    });

    await expect(service.listEvents('x'.repeat(501))).rejects.toThrow('calendar ID is too long');
    await expect(service.listEvents('primary', 'x'.repeat(101))).rejects.toThrow('timeMin is too long');
    expect(authorizeCalls).toBe(0);
  });
});
