import { describe, expect, it, vi } from 'vitest';
import { GoogleCalendarService } from './service';
import { validateGoogleReadToolArguments } from '../tools/read-schemas';
import { validateSemanticToolArguments } from '../tools/semantic-schemas';
import type { GoogleOAuthAuthority } from '../oauth/contracts';

function disconnectedService() {
  const authorize = vi.fn<GoogleOAuthAuthority['authorize']>();
  const service = new GoogleCalendarService({
    authorize,
    getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
    disconnect: async () => undefined,
  });
  return { service, authorize };
}

describe('Calendar provider boundary hardening', () => {
  it('rejects wildcard and non-concrete ETags at model validation', () => {
    expect(() => validateSemanticToolArguments('calendar.updateEvent', {
      eventId: 'event-1', etag: '*', summary: 'Unsafe overwrite',
    })).toThrow('concrete strong provider ETag');
    expect(() => validateSemanticToolArguments('calendar.deleteEvent', {
      eventId: 'event-1', etag: '"one", "two"',
    })).toThrow('concrete strong provider ETag');
    expect(() => validateSemanticToolArguments('calendar.updateEvent', {
      eventId: 'event-1', etag: '"etag-1"', summary: 'Safe update',
    })).not.toThrow();
  });

  it('rejects wildcard ETags at the service boundary before authorization', async () => {
    const { service, authorize } = disconnectedService();

    await expect(service.updateSemanticEvent({
      eventId: 'event-1', etag: '*', summary: 'Unsafe overwrite',
    })).rejects.toThrow('concrete provider ETag');
    await expect(service.deleteEvent('primary', 'event-1', '*')).rejects.toThrow('concrete provider ETag');
    expect(authorize).not.toHaveBeenCalled();
  });

  it('requires explicit boundaries when adding or changing recurrence', async () => {
    const recurrenceOnly = {
      eventId: 'event-1',
      etag: '"etag-1"',
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=2'],
    } as const;

    expect(() => validateSemanticToolArguments('calendar.updateEvent', recurrenceOnly)).toThrow('explicit start and end boundaries');

    const { service, authorize } = disconnectedService();
    await expect(service.updateSemanticEvent(recurrenceOnly)).rejects.toThrow('explicit start and end boundaries');
    expect(authorize).not.toHaveBeenCalled();

    expect(() => validateSemanticToolArguments('calendar.updateEvent', {
      ...recurrenceOnly,
      start: '2026-09-22',
      end: '2026-09-23',
    })).not.toThrow();
  });

  it('requires an explicit timezone for offset-free event date-times', async () => {
    const offsetFreeCreate = {
      summary: 'Local planning',
      start: '2026-09-22T09:00:00',
      end: '2026-09-22T10:00:00',
    } as const;

    expect(() => validateSemanticToolArguments('calendar.createEvent', offsetFreeCreate)).toThrow('explicit time zone');
    expect(() => validateSemanticToolArguments('calendar.createEvent', {
      ...offsetFreeCreate,
      timeZone: 'Africa/Johannesburg',
    })).not.toThrow();

    const { service, authorize } = disconnectedService();
    await expect(service.createSemanticEvent(offsetFreeCreate)).rejects.toThrow('explicit time zone');
    await expect(service.updateSemanticEvent({
      eventId: 'event-1',
      etag: '"etag-1"',
      start: '2026-09-22T09:00:00',
      end: '2026-09-22T10:00:00',
    })).rejects.toThrow('explicit time zone');
    expect(authorize).not.toHaveBeenCalled();
  });

  it('requires offset-bearing RFC 3339 bounds for Calendar reads and free/busy', async () => {
    expect(() => validateGoogleReadToolArguments('calendar.listEvents', {
      timeMin: '2026-09-22T09:00:00',
    })).toThrow('explicit UTC offset');
    expect(() => validateGoogleReadToolArguments('calendar.queryFreeBusy', {
      timeMin: '2026-09-22T09:00:00',
      timeMax: '2026-09-22T10:00:00Z',
      calendarIds: ['primary'],
    })).toThrow('explicit UTC offset');

    const { service, authorize } = disconnectedService();
    await expect(service.listEventPage({ timeMin: '2026-09-22T09:00:00' })).rejects.toThrow('explicit UTC offset');
    await expect(service.queryFreeBusy(
      '2026-09-22T09:00:00',
      '2026-09-22T10:00:00Z',
      ['primary'],
    )).rejects.toThrow('explicit UTC offsets');
    expect(authorize).not.toHaveBeenCalled();
  });
});
