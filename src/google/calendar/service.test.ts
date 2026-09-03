import { describe, expect, it } from 'vitest';
import { GoogleCalendarService } from './service';
import type { GoogleOAuthAuthority } from '../oauth/contracts';

describe('GoogleCalendarService', () => {
  it('requires the registered calendar read capability and maps events', async () => {
    let requestedCapability: string | undefined;
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => {
        requestedCapability = capability;
        return {
          capability,
          fetch: async () => new Response(JSON.stringify({
            items: [{
              id: 'event-1',
              summary: 'Design review',
              start: { dateTime: '2026-09-03T10:00:00Z' },
              end: { dateTime: '2026-09-03T11:00:00Z' },
            }],
          }), { status: 200, headers: { 'content-type': 'application/json' } }),
        };
      },
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [] }),
      disconnect: async () => undefined,
    };

    const service = new GoogleCalendarService(oauth);
    await expect(service.listEvents()).resolves.toEqual([
      { id: 'event-1', summary: 'Design review', start: '2026-09-03T10:00:00Z', end: '2026-09-03T11:00:00Z' },
    ]);
    expect(requestedCapability).toBe('calendar.events.read');
  });
});
