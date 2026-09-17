import { describe, expect, it, vi } from 'vitest';
import { GoogleCalendarService } from './service';
import { validateSemanticToolArguments } from '../tools/semantic-schemas';
import type { GoogleOAuthAuthority } from '../oauth/contracts';

describe('Calendar recurring update timezone invariant', () => {
  const recurringTimedUpdate = {
    eventId: 'event-1',
    etag: '"etag-1"',
    start: '2026-09-22T09:00:00+02:00',
    end: '2026-09-22T10:00:00+02:00',
    recurrence: ['RRULE:FREQ=WEEKLY;COUNT=2'],
  } as const;

  it('rejects the unsafe shape at the model validation boundary', () => {
    expect(() => validateSemanticToolArguments('calendar.updateEvent', recurringTimedUpdate)).toThrow('explicit time zone');
  });

  it('rejects the same unsafe shape at the Calendar service boundary before authorization', async () => {
    const authorize = vi.fn<GoogleOAuthAuthority['authorize']>();
    const service = new GoogleCalendarService({
      authorize,
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
      disconnect: async () => undefined,
    });

    await expect(service.updateSemanticEvent(recurringTimedUpdate)).rejects.toThrow('explicit time zone');
    expect(authorize).not.toHaveBeenCalled();
  });

  it('carries an explicit timezone into both recurring event boundaries', async () => {
    let body: Record<string, unknown> | undefined;
    const service = new GoogleCalendarService({
      authorize: async (capability) => ({
        capability,
        fetch: async (_input, init) => {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return new Response(JSON.stringify({
            id: 'event-1',
            etag: '"etag-2"',
            summary: 'Recurring event',
            start: { dateTime: '2026-09-22T09:00:00+02:00', timeZone: 'Africa/Johannesburg' },
            end: { dateTime: '2026-09-22T10:00:00+02:00', timeZone: 'Africa/Johannesburg' },
            recurrence: ['RRULE:FREQ=WEEKLY;COUNT=2'],
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
      }),
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
      disconnect: async () => undefined,
    });

    await service.updateSemanticEvent({ ...recurringTimedUpdate, timeZone: 'Africa/Johannesburg' });

    expect(body).toEqual(expect.objectContaining({
      start: { dateTime: '2026-09-22T09:00:00+02:00', timeZone: 'Africa/Johannesburg' },
      end: { dateTime: '2026-09-22T10:00:00+02:00', timeZone: 'Africa/Johannesburg' },
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=2'],
    }));
  });
});
