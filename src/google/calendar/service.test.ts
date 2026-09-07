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

  it('creates an event only through the registered calendar write capability', async () => {
    let requestedCapability: string | undefined;
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const service = new GoogleCalendarService({
      ...oauth,
      authorize: async (capability) => ({
        capability,
        fetch: async (input, init) => {
          requestedCapability = capability;
          capturedUrl = String(input);
          capturedInit = init;
          return new Response(JSON.stringify({ id: 'event-created' }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
      }),
    });

    await expect(service.createEvent({
      calendarId: 'primary',
      event: {
        summary: 'Ship the pass',
        start: { dateTime: '2026-09-08T09:00:00Z' },
        end: { dateTime: '2026-09-08T09:30:00Z' },
      },
    })).resolves.toEqual({ id: 'event-created' });
    expect(requestedCapability).toBe('calendar.events.write');
    expect(capturedUrl).toContain('/calendar/v3/calendars/primary/events');
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      summary: 'Ship the pass',
      start: { dateTime: '2026-09-08T09:00:00Z' },
      end: { dateTime: '2026-09-08T09:30:00Z' },
    });
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
    await expect(service.createEvent({ calendarId: 'x'.repeat(501), event: { summary: 'test' } })).rejects.toThrow('calendar ID is too long');
    await expect(service.createEvent({ event: { summary: 'x'.repeat(1001) } })).rejects.toThrow('event summary is too long');
    expect(authorizeCalls).toBe(0);
  });
});
