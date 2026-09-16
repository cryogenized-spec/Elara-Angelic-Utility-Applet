import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listCalendars: vi.fn(),
  listEventPage: vi.fn(),
  getEvent: vi.fn(),
  getSettings: vi.fn(),
  queryFreeBusy: vi.fn(),
  createSemanticEvent: vi.fn(),
  updateSemanticEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));

vi.mock('../calendar/service', () => ({
  GoogleCalendarService: class {
    listCalendars = mocks.listCalendars;
    listEventPage = mocks.listEventPage;
    getEvent = mocks.getEvent;
    getSettings = mocks.getSettings;
    queryFreeBusy = mocks.queryFreeBusy;
    createSemanticEvent = mocks.createSemanticEvent;
    updateSemanticEvent = mocks.updateSemanticEvent;
    deleteEvent = mocks.deleteEvent;
  },
}));

import { googleToolRegistry } from './registry';
import { googleServiceToolHandlers } from './service-handlers';
import { validateGoogleReadToolArguments } from './read-schemas';
import { validateSemanticToolArguments } from './semantic-schemas';
import { confirmationRequestForCall, type GoogleToolExecutionContext } from './executor';

function context(tool: GoogleToolExecutionContext['tool'], arguments_: Record<string, unknown>, callId?: string): GoogleToolExecutionContext {
  const descriptor = googleToolRegistry.find((entry) => entry.name === tool);
  if (!descriptor) throw new Error(`Missing descriptor for ${tool}`);
  return {
    tool,
    descriptor,
    capability: descriptor.capability as GoogleToolExecutionContext['capability'],
    risk: descriptor.risk,
    arguments: arguments_,
    ...(callId ? { callId } : {}),
  };
}

describe('Calendar parity tool boundary', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it('registers reads, writes, and destructive delete against the intended capabilities', () => {
    expect(googleToolRegistry.find((tool) => tool.name === 'calendar.listCalendars')).toEqual(expect.objectContaining({ risk: 'read', capability: 'calendar.list.read' }));
    expect(googleToolRegistry.find((tool) => tool.name === 'calendar.queryFreeBusy')).toEqual(expect.objectContaining({ risk: 'read', capability: 'calendar.freebusy.read' }));
    expect(googleToolRegistry.find((tool) => tool.name === 'calendar.updateEvent')).toEqual(expect.objectContaining({ risk: 'write', capability: 'calendar.events.write' }));
    expect(googleToolRegistry.find((tool) => tool.name === 'calendar.deleteEvent')).toEqual(expect.objectContaining({ risk: 'destructive', capability: 'calendar.events.write' }));
  });

  it('rejects unsafe or incomplete Calendar model arguments', () => {
    expect(() => validateSemanticToolArguments('calendar.updateEvent', { eventId: 'event-1', etag: '"v1"' })).toThrow('at least one event field change');
    expect(() => validateSemanticToolArguments('calendar.updateEvent', { eventId: 'event-1', etag: '"v1"', summary: 'New', sendUpdates: 'none' })).toThrow();
    expect(() => validateSemanticToolArguments('calendar.deleteEvent', { eventId: 'event-1' })).toThrow();
    expect(() => validateGoogleReadToolArguments('calendar.queryFreeBusy', {
      timeMin: '2026-09-20T08:00:00Z',
      timeMax: '2026-09-20T17:00:00Z',
      calendarIds: Array.from({ length: 51 }, (_, index) => `calendar-${index}`),
    })).toThrow();
    expect(() => validateGoogleReadToolArguments('calendar.listCalendars', { maxResults: 251 })).toThrow();
  });

  it('carries Gemini call identity into retry-safe Calendar creation', async () => {
    mocks.createSemanticEvent.mockResolvedValue({ id: 'created' });
    const handler = googleServiceToolHandlers['calendar.createEvent'];
    expect(handler).toBeTypeOf('function');
    await handler!(context('calendar.createEvent', {
      summary: 'Planning',
      start: '2026-09-20T08:00:00Z',
      end: '2026-09-20T09:00:00Z',
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=2'],
      sendUpdates: 'all',
    }, 'call-calendar-create-7'));

    expect(mocks.createSemanticEvent).toHaveBeenCalledWith(expect.objectContaining({
      summary: 'Planning',
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=2'],
      sendUpdates: 'all',
      idempotencyKey: 'call-calendar-create-7',
    }));
  });

  it('passes ETags and exact mutation intent through update and delete handlers', async () => {
    mocks.updateSemanticEvent.mockResolvedValue({ id: 'event-1' });
    mocks.deleteEvent.mockResolvedValue({ deleted: true });

    await googleServiceToolHandlers['calendar.updateEvent']!(context('calendar.updateEvent', {
      eventId: 'event-1', etag: '"etag-1"', summary: 'Changed', attendees: [], sendUpdates: 'externalOnly',
    }));
    await googleServiceToolHandlers['calendar.deleteEvent']!(context('calendar.deleteEvent', {
      calendarId: 'primary', eventId: 'event-1', etag: '"etag-2"',
    }));

    expect(mocks.updateSemanticEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'event-1', etag: '"etag-1"', summary: 'Changed', attendees: [], sendUpdates: 'externalOnly' }));
    expect(mocks.deleteEvent).toHaveBeenCalledWith('primary', 'event-1', '"etag-2"', undefined);
  });

  it('wires Calendar discovery, detail, settings, and free/busy reads to the service', async () => {
    mocks.listCalendars.mockResolvedValue({ calendars: [] });
    mocks.getEvent.mockResolvedValue({ id: 'event-1' });
    mocks.getSettings.mockResolvedValue({ timezone: 'Africa/Johannesburg' });
    mocks.queryFreeBusy.mockResolvedValue({ calendars: [] });

    await googleServiceToolHandlers['calendar.listCalendars']!(context('calendar.listCalendars', { showOwnOrganizationOnly: true }));
    await googleServiceToolHandlers['calendar.getEvent']!(context('calendar.getEvent', { eventId: 'event-1' }));
    await googleServiceToolHandlers['calendar.getSettings']!(context('calendar.getSettings', {}));
    await googleServiceToolHandlers['calendar.queryFreeBusy']!(context('calendar.queryFreeBusy', {
      timeMin: '2026-09-20T08:00:00Z', timeMax: '2026-09-20T17:00:00Z', calendarIds: ['primary'],
    }));

    expect(mocks.listCalendars).toHaveBeenCalledWith(expect.objectContaining({ showOwnOrganizationOnly: true }));
    expect(mocks.getEvent).toHaveBeenCalledWith(undefined, 'event-1', undefined);
    expect(mocks.getSettings).toHaveBeenCalledOnce();
    expect(mocks.queryFreeBusy).toHaveBeenCalledWith('2026-09-20T08:00:00Z', '2026-09-20T17:00:00Z', ['primary'], undefined);
  });

  it('generates explicit confirmations for create, update, and destructive delete', () => {
    const create = confirmationRequestForCall({ tool: 'calendar.createEvent', arguments: { summary: 'Planning', start: '2026-09-20T08:00:00Z', end: '2026-09-20T09:00:00Z', sendUpdates: 'all' } });
    const update = confirmationRequestForCall({ tool: 'calendar.updateEvent', arguments: { eventId: 'event-1', etag: '"v1"', summary: 'Changed' } });
    const remove = confirmationRequestForCall({ tool: 'calendar.deleteEvent', arguments: { eventId: 'event-1', etag: '"v2"' } });

    expect(create).not.toBeNull();
    expect(update).not.toBeNull();
    expect(remove).not.toBeNull();
    expect(create?.risk).toBe('write');
    expect(create?.resourceSummary).toContain('send guest updates');
    expect(update?.risk).toBe('write');
    expect(update?.resourceSummary).toContain('using the version just read');
    expect(remove?.risk).toBe('destructive');
    expect(remove?.resourceSummary).toContain('Delete Calendar event event-1');
  });
});
