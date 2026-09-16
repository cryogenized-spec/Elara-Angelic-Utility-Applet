import { describe, expect, it, vi } from 'vitest';
import { GoogleCalendarService } from './service';
import { validateGoogleReadToolArguments } from '../tools/read-schemas';
import { validateSemanticToolArguments } from '../tools/semantic-schemas';
import type { GoogleOAuthAuthority } from '../oauth/contracts';

function serviceWithoutNetwork() {
  const authorize = vi.fn<GoogleOAuthAuthority['authorize']>();
  const service = new GoogleCalendarService({
    authorize,
    getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
    disconnect: async () => undefined,
  });
  return { service, authorize };
}

describe('Calendar date and timezone trust boundaries', () => {
  it('rejects non-IANA time zones in model-visible Calendar schemas', () => {
    expect(() => validateSemanticToolArguments('calendar.createEvent', {
      summary: 'Invalid zone',
      start: '2026-09-22T09:00:00',
      end: '2026-09-22T10:00:00',
      timeZone: 'not/a-zone',
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=2'],
    })).toThrow('valid IANA time zone');

    expect(() => validateGoogleReadToolArguments('calendar.listEvents', {
      timeZone: 'not/a-zone',
    })).toThrow('valid IANA time zone');
  });

  it('rejects non-IANA time zones at the service boundary before authorization', async () => {
    const { service, authorize } = serviceWithoutNetwork();

    await expect(service.createSemanticEvent({
      summary: 'Invalid zone',
      start: '2026-09-22T09:00:00',
      end: '2026-09-22T10:00:00',
      timeZone: 'not/a-zone',
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=2'],
    })).rejects.toThrow('valid IANA time zone');

    await expect(service.listEventPage({ timeZone: 'not/a-zone' })).rejects.toThrow('valid IANA time zone');
    expect(authorize).not.toHaveBeenCalled();
  });

  it('rejects impossible all-day and timed dates instead of normalizing them', async () => {
    expect(() => validateSemanticToolArguments('calendar.createEvent', {
      summary: 'Impossible day',
      start: '2026-02-30',
      end: '2026-03-01',
    })).toThrow('real YYYY-MM-DD date');

    expect(() => validateSemanticToolArguments('calendar.createEvent', {
      summary: 'Impossible timed day',
      start: '2026-02-30T09:00:00Z',
      end: '2026-03-01T10:00:00Z',
    })).toThrow('valid RFC 3339-style date-time');

    expect(() => validateGoogleReadToolArguments('calendar.queryFreeBusy', {
      timeMin: '2026-02-30T09:00:00Z',
      timeMax: '2026-03-01T10:00:00Z',
      calendarIds: ['primary'],
    })).toThrow('real RFC 3339 timestamps');

    const { service, authorize } = serviceWithoutNetwork();
    await expect(service.createSemanticEvent({
      summary: 'Impossible day',
      start: '2026-02-30',
      end: '2026-03-01',
    })).rejects.toThrow('real all-day');
    await expect(service.queryFreeBusy(
      '2026-02-30T09:00:00Z',
      '2026-03-01T10:00:00Z',
      ['primary'],
    )).rejects.toThrow('real RFC 3339');
    expect(authorize).not.toHaveBeenCalled();
  });

  it('accepts real leap-day dates and valid IANA zones', () => {
    expect(() => validateSemanticToolArguments('calendar.createEvent', {
      summary: 'Leap day',
      start: '2028-02-29T09:00:00',
      end: '2028-02-29T10:00:00',
      timeZone: 'Africa/Johannesburg',
    })).not.toThrow();

    expect(() => validateGoogleReadToolArguments('calendar.queryFreeBusy', {
      timeMin: '2028-02-29T09:00:00+02:00',
      timeMax: '2028-02-29T10:00:00+02:00',
      calendarIds: ['primary'],
      timeZone: 'Africa/Johannesburg',
    })).not.toThrow();
  });

  it('rejects mixed offset and timezone-relative event boundaries', async () => {
    const { service, authorize } = serviceWithoutNetwork();
    await expect(service.createSemanticEvent({
      summary: 'Mixed semantics',
      start: '2026-09-22T09:00:00+02:00',
      end: '2026-09-22T10:00:00',
      timeZone: 'Africa/Johannesburg',
    })).rejects.toThrow('both include UTC offsets or both rely on the explicit time zone');
    expect(authorize).not.toHaveBeenCalled();
  });
});
