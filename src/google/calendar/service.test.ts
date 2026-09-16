import { describe, expect, it, vi } from 'vitest';
import { GoogleCalendarService } from './service';
import type { GoogleCapabilityKey, GoogleOAuthAuthority } from '../oauth/contracts';

function authority(fetcher: (input: RequestInfo | URL, init?: RequestInit, capability?: GoogleCapabilityKey) => Promise<Response>) {
  const capabilities: GoogleCapabilityKey[] = [];
  const oauth: GoogleOAuthAuthority = {
    authorize: async (capability) => {
      capabilities.push(capability);
      return { capability, fetch: (input, init) => fetcher(input, init, capability) };
    },
    getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
    disconnect: async () => undefined,
  };
  return { oauth, capabilities };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function event(id = 'event-1', extras: Record<string, unknown> = {}) {
  return {
    id,
    etag: `"etag-${id}"`,
    summary: 'Design review',
    start: { dateTime: '2026-09-03T10:00:00Z', timeZone: 'Africa/Johannesburg' },
    end: { dateTime: '2026-09-03T11:00:00Z', timeZone: 'Africa/Johannesburg' },
    ...extras,
  };
}

function urlOf(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

describe('GoogleCalendarService', () => {
  it('lists event pages with bounded filters, normalized summaries, and pagination', async () => {
    let captured: URL | undefined;
    const { oauth, capabilities } = authority(async (input) => {
      captured = urlOf(input);
      return json({ items: [event()], nextPageToken: 'next-page' });
    });
    const service = new GoogleCalendarService(oauth);

    await expect(service.listEventPage({
      calendarId: 'team@example.com',
      timeMin: '2026-09-01T00:00:00Z',
      timeMax: '2026-09-30T23:59:59Z',
      pageToken: 'page-1',
      maxResults: 25,
      query: 'review',
      timeZone: 'Africa/Johannesburg',
    })).resolves.toEqual({
      events: [{
        id: 'event-1', etag: '"etag-event-1"', summary: 'Design review',
        start: '2026-09-03T10:00:00Z', end: '2026-09-03T11:00:00Z',
        startTimeZone: 'Africa/Johannesburg', endTimeZone: 'Africa/Johannesburg',
      }],
      nextPageToken: 'next-page',
    });
    expect(capabilities).toEqual(['calendar.events.read']);
    expect(captured?.pathname).toContain('/calendars/team%40example.com/events');
    expect(captured?.searchParams.get('singleEvents')).toBe('true');
    expect(captured?.searchParams.get('orderBy')).toBe('startTime');
    expect(captured?.searchParams.get('pageToken')).toBe('page-1');
    expect(captured?.searchParams.get('maxResults')).toBe('25');
    expect(captured?.searchParams.get('q')).toBe('review');
    expect(captured?.searchParams.get('timeZone')).toBe('Africa/Johannesburg');
  });

  it('gets detailed event state including the ETag needed for safe mutations', async () => {
    const { oauth, capabilities } = authority(async () => json(event('event-detail', {
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=3'],
      attendees: [{ email: 'guest@example.com', responseStatus: 'accepted' }],
      organizer: { email: 'owner@example.com' },
      creator: { email: 'owner@example.com' },
      status: 'confirmed',
      htmlLink: 'https://calendar.google.com/event?eid=abc',
      eventType: 'default',
    })));
    const service = new GoogleCalendarService(oauth);
    const detail = await service.getEvent('primary', 'event-detail');

    expect(capabilities).toEqual(['calendar.events.read']);
    expect(detail.etag).toBe('"etag-event-detail"');
    expect(detail.recurrence).toEqual(['RRULE:FREQ=WEEKLY;COUNT=3']);
    expect(detail.attendees).toEqual([{ email: 'guest@example.com', responseStatus: 'accepted' }]);
    expect(detail.organizerEmail).toBe('owner@example.com');
  });

  it('discovers calendars with current bounded CalendarList filters', async () => {
    let captured: URL | undefined;
    const { oauth, capabilities } = authority(async (input) => {
      captured = urlOf(input);
      return json({ items: [{ id: 'primary@example.com', summary: 'Primary', primary: true, selected: true, accessRole: 'owner', timeZone: 'Africa/Johannesburg' }] });
    });
    const service = new GoogleCalendarService(oauth);
    const result = await service.listCalendars({ maxResults: 50, showHidden: true, minAccessRole: 'reader', showOwnOrganizationOnly: true });

    expect(capabilities).toEqual(['calendar.list.read']);
    expect(result.calendars[0]).toEqual(expect.objectContaining({ id: 'primary@example.com', primary: true, accessRole: 'owner' }));
    expect(captured?.searchParams.get('maxResults')).toBe('50');
    expect(captured?.searchParams.get('showHidden')).toBe('true');
    expect(captured?.searchParams.get('minAccessRole')).toBe('reader');
    expect(captured?.searchParams.get('showOwnOrganizationOnly')).toBe('true');
  });

  it('reads account settings through its own narrow capability', async () => {
    const { oauth, capabilities } = authority(async () => json({ items: [{ id: 'timezone', value: 'Africa/Johannesburg' }, { id: 'weekStart', value: '1' }] }));
    const service = new GoogleCalendarService(oauth);
    await expect(service.getSettings()).resolves.toEqual({ timezone: 'Africa/Johannesburg', weekStart: '1' });
    expect(capabilities).toEqual(['calendar.settings.read']);
  });

  it('queries free/busy without event-detail authority and caps explicit calendar ids', async () => {
    let body: unknown;
    const { oauth, capabilities } = authority(async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return json({
        timeMin: '2026-09-20T08:00:00Z',
        timeMax: '2026-09-20T17:00:00Z',
        calendars: { 'primary': { busy: [{ start: '2026-09-20T10:00:00Z', end: '2026-09-20T11:00:00Z' }] } },
      });
    });
    const service = new GoogleCalendarService(oauth);
    const result = await service.queryFreeBusy('2026-09-20T08:00:00Z', '2026-09-20T17:00:00Z', ['primary'], 'Africa/Johannesburg');

    expect(capabilities).toEqual(['calendar.freebusy.read']);
    expect(body).toEqual({ timeMin: '2026-09-20T08:00:00Z', timeMax: '2026-09-20T17:00:00Z', timeZone: 'Africa/Johannesburg', items: [{ id: 'primary' }] });
    expect(result.calendars[0]?.busy).toEqual([{ start: '2026-09-20T10:00:00Z', end: '2026-09-20T11:00:00Z' }]);
    await expect(service.queryFreeBusy('2026-09-20T08:00:00Z', '2026-09-20T17:00:00Z', Array.from({ length: 51 }, (_, index) => `c${index}`))).rejects.toThrow('too many entries');
  });

  it('creates recurring attendee events with timezone and explicit guest-update policy', async () => {
    let capturedUrl: URL | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const { oauth, capabilities } = authority(async (input, init) => {
      capturedUrl = urlOf(input);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json(event('created-event'));
    });
    const service = new GoogleCalendarService(oauth);

    await service.createSemanticEvent({
      summary: 'Weekly planning',
      start: '2026-09-21T09:00:00+02:00',
      end: '2026-09-21T10:00:00+02:00',
      timeZone: 'Africa/Johannesburg',
      attendees: ['guest@example.com'],
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4'],
      sendUpdates: 'all',
    });

    expect(capabilities).toEqual(['calendar.events.write']);
    expect(capturedUrl?.searchParams.get('sendUpdates')).toBe('all');
    expect(capturedBody).toEqual(expect.objectContaining({
      summary: 'Weekly planning',
      start: { dateTime: '2026-09-21T09:00:00+02:00', timeZone: 'Africa/Johannesburg' },
      end: { dateTime: '2026-09-21T10:00:00+02:00', timeZone: 'Africa/Johannesburg' },
      attendees: [{ email: 'guest@example.com' }],
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4'],
    }));
  });

  it('uses a deterministic Google-valid event id to recover ambiguous create retries', async () => {
    const requests: Array<{ url: URL; method: string; body?: Record<string, unknown> }> = [];
    const { oauth } = authority(async (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      requests.push({ url, method, ...(body ? { body } : {}) });
      if (method === 'POST') return json({ error: 'already exists' }, 409);
      return json(event(url.pathname.split('/').at(-1) ?? 'missing'));
    });
    const service = new GoogleCalendarService(oauth);

    const result = await service.createSemanticEvent({
      summary: 'Retry-safe meeting',
      start: '2026-09-22T09:00:00Z',
      end: '2026-09-22T10:00:00Z',
      idempotencyKey: 'gemini-call-123',
    });

    const generatedId = String(requests[0]?.body?.id ?? '');
    expect(generatedId).toMatch(/^elara[0-9a-f]{40}$/);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.method).toBe('GET');
    expect(requests[1]?.url.pathname).toContain(`/${generatedId}`);
    expect(result.id).toBe(generatedId);
  });

  it('patches and deletes only the ETag version the model actually read', async () => {
    const calls: Array<{ method: string; ifMatch: string | null; body?: unknown }> = [];
    const { oauth, capabilities } = authority(async (input, init) => {
      const request = new Request(input, init);
      calls.push({ method: request.method, ifMatch: request.headers.get('If-Match'), ...(request.method === 'PATCH' ? { body: await request.clone().json() } : {}) });
      return request.method === 'DELETE' ? new Response(null, { status: 204 }) : json(event('event-safe', { summary: 'Updated title' }));
    });
    const service = new GoogleCalendarService(oauth);

    await service.updateSemanticEvent({ eventId: 'event-safe', etag: '"etag-v1"', summary: 'Updated title', sendUpdates: 'externalOnly' });
    await service.deleteEvent('primary', 'event-safe', '"etag-v2"');

    expect(capabilities).toEqual(['calendar.events.write', 'calendar.events.write']);
    expect(calls[0]).toEqual(expect.objectContaining({ method: 'PATCH', ifMatch: '"etag-v1"', body: { summary: 'Updated title' } }));
    expect(calls[1]).toEqual(expect.objectContaining({ method: 'DELETE', ifMatch: '"etag-v2"' }));
  });

  it('surfaces ETag conflicts as a read-again requirement', async () => {
    const { oauth } = authority(async () => json({ error: 'precondition' }, 412));
    const service = new GoogleCalendarService(oauth);
    await expect(service.updateSemanticEvent({ eventId: 'event-1', etag: '"stale"', summary: 'Changed' })).rejects.toThrow('Read the event again');
  });

  it('rejects invalid recurrence, missing recurring timezone, and oversized inputs before authorization', async () => {
    const authorize = vi.fn();
    const service = new GoogleCalendarService({
      authorize,
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
      disconnect: async () => undefined,
    });

    await expect(service.createSemanticEvent({ summary: 'Bad recurrence', start: '2026-09-22T09:00:00Z', end: '2026-09-22T10:00:00Z', recurrence: ['DTSTART:20260922T090000Z'] })).rejects.toThrow('RRULE');
    await expect(service.createSemanticEvent({ summary: 'Needs zone', start: '2026-09-22T09:00:00Z', end: '2026-09-22T10:00:00Z', recurrence: ['RRULE:FREQ=DAILY;COUNT=2'] })).rejects.toThrow('explicit time zone');
    await expect(service.listEventPage({ calendarId: 'x'.repeat(501) })).rejects.toThrow('calendar ID is too long');
    expect(authorize).not.toHaveBeenCalled();
  });
});
