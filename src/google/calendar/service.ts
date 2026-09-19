import type { AuthorizedGoogleRequest, GoogleOAuthAuthority } from '../oauth/contracts';
import { readBoundedProviderJson } from '../provider-json-boundary';

const MAX_PROVIDER_JSON_BYTES = 4 * 1024 * 1024;
const MAX_CALENDAR_ID_LENGTH = 500;
const MAX_TIME_PARAMETER_LENGTH = 128;
const MAX_EVENT_ID_LENGTH = 1024;
const MAX_ETAG_LENGTH = 1024;
const MAX_EVENT_SUMMARY_LENGTH = 1000;
const MAX_EVENT_LOCATION_LENGTH = 1000;
const MAX_EVENT_DESCRIPTION_LENGTH = 8000;
const MAX_PAGE_TOKEN_LENGTH = 2048;
const MAX_QUERY_LENGTH = 2000;
const MAX_TIME_ZONE_LENGTH = 200;
const MAX_RECURRENCE_RULE_LENGTH = 2000;
const MAX_RECURRENCE_RULES = 20;
const MAX_ATTENDEES = 50;
const MAX_FREEBUSY_CALENDARS = 50;
const MAX_EVENT_BODY_BYTES = 1_000_000;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 250;
const ALL_DAY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|[+-](\d{2}):(\d{2}))?$/i;
const CONCRETE_ETAG_PATTERN = /^"[^"]+"$/;

export type CalendarSendUpdates = 'all' | 'externalOnly';
export type CalendarMinAccessRole = 'freeBusyReader' | 'reader' | 'writerWithoutPrivateAccess' | 'writer' | 'owner';

export interface CalendarEventSummary {
  readonly trust: 'untrusted-external';
  readonly source: 'calendar';
  readonly id: string;
  readonly etag?: string;
  readonly summary: string;
  readonly start: string;
  readonly end: string;
  readonly startTimeZone?: string;
  readonly endTimeZone?: string;
  readonly status?: string;
  readonly htmlLink?: string;
  readonly recurringEventId?: string;
  readonly truncatedFields?: readonly string[];
}

export interface CalendarEventAttendee {
  readonly email: string;
  readonly responseStatus?: string;
  readonly self?: boolean;
  readonly organizer?: boolean;
  readonly optional?: boolean;
}

export interface CalendarEventDetail extends CalendarEventSummary {
  readonly location?: string;
  readonly description?: string;
  readonly recurrence?: readonly string[];
  readonly attendees?: readonly CalendarEventAttendee[];
  readonly organizerEmail?: string;
  readonly creatorEmail?: string;
  readonly eventType?: string;
  readonly transparency?: string;
  readonly visibility?: string;
}

export interface CalendarEventPage {
  readonly trust: 'untrusted-external';
  readonly source: 'calendar';
  readonly events: readonly CalendarEventSummary[];
  readonly nextPageToken?: string;
  readonly truncated?: boolean;
}

export interface CalendarListEntrySummary {
  readonly trust: 'untrusted-external';
  readonly source: 'calendar';
  readonly id: string;
  readonly summary: string;
  readonly primary: boolean;
  readonly selected: boolean;
  readonly accessRole?: string;
  readonly timeZone?: string;
  readonly backgroundColor?: string;
  readonly truncatedFields?: readonly string[];
}

export interface CalendarListPage {
  readonly trust: 'untrusted-external';
  readonly source: 'calendar';
  readonly calendars: readonly CalendarListEntrySummary[];
  readonly nextPageToken?: string;
  readonly truncated?: boolean;
}

export interface CalendarFreeBusyInterval {
  readonly start: string;
  readonly end: string;
}

export interface CalendarFreeBusyEntry {
  readonly calendarId: string;
  readonly busy: readonly CalendarFreeBusyInterval[];
  readonly errors?: readonly { readonly reason?: string; readonly domain?: string }[];
}

export interface CalendarFreeBusyResult {
  readonly trust: 'untrusted-external';
  readonly source: 'calendar';
  readonly timeMin: string;
  readonly timeMax: string;
  readonly calendars: readonly CalendarFreeBusyEntry[];
}

export interface CalendarEventCreateInput {
  readonly calendarId?: string;
  readonly event: Readonly<Record<string, unknown>>;
  readonly sendUpdates?: CalendarSendUpdates;
  readonly idempotencyKey?: string;
}

export interface CalendarEventSemanticInput {
  readonly calendarId?: string;
  readonly summary: string;
  readonly start: string;
  readonly end: string;
  readonly timeZone?: string;
  readonly location?: string;
  readonly description?: string;
  readonly attendees?: readonly string[];
  readonly recurrence?: readonly string[];
  readonly sendUpdates?: CalendarSendUpdates;
  readonly idempotencyKey?: string;
}

export interface CalendarEventSemanticUpdateInput {
  readonly calendarId?: string;
  readonly eventId: string;
  readonly etag: string;
  readonly summary?: string;
  readonly start?: string;
  readonly end?: string;
  readonly timeZone?: string;
  readonly location?: string;
  readonly description?: string;
  readonly attendees?: readonly string[];
  readonly recurrence?: readonly string[];
  readonly sendUpdates?: CalendarSendUpdates;
}

export interface CalendarEventListInput {
  readonly calendarId?: string;
  readonly timeMin?: string;
  readonly timeMax?: string;
  readonly pageToken?: string;
  readonly maxResults?: number;
  readonly query?: string;
  readonly timeZone?: string;
}

export interface CalendarListInput {
  readonly pageToken?: string;
  readonly maxResults?: number;
  readonly showHidden?: boolean;
  readonly minAccessRole?: CalendarMinAccessRole;
  readonly showOwnOrganizationOnly?: boolean;
}

interface CalendarApiEvent {
  id?: string;
  etag?: string;
  summary?: string;
  status?: string;
  htmlLink?: string;
  recurringEventId?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  description?: string;
  recurrence?: string[];
  attendees?: Array<{
    email?: string;
    responseStatus?: string;
    self?: boolean;
    organizer?: boolean;
    optional?: boolean;
  }>;
  organizer?: { email?: string };
  creator?: { email?: string };
  eventType?: string;
  transparency?: string;
  visibility?: string;
}

interface CalendarEventsResponse {
  nextPageToken?: string;
  items?: CalendarApiEvent[];
}

interface CalendarListResponse {
  nextPageToken?: string;
  items?: Array<{
    id?: string;
    summary?: string;
    primary?: boolean;
    selected?: boolean;
    accessRole?: string;
    timeZone?: string;
    backgroundColor?: string;
  }>;
}

interface CalendarSettingsResponse {
  items?: Array<{ id?: string; value?: string }>;
}

interface CalendarFreeBusyResponse {
  timeMin?: string;
  timeMax?: string;
  calendars?: Record<string, {
    busy?: Array<{ start?: string; end?: string }>;
    errors?: Array<{ reason?: string; domain?: string }>;
  }>;
}

function projectedProviderText(
  value: unknown,
  maxLength: number,
  field: string,
  truncated: Set<string>,
  trim = false,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = (trim ? value.trim() : value).split('\0').join('');
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    truncated.add(field);
    return normalized.slice(0, maxLength);
  }
  return normalized;
}

function projectedProviderId(value: unknown, maxLength: number, field: string, truncated: Set<string>): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    truncated.add(field);
    return undefined;
  }
  return normalized;
}

function projectedProviderHttpsUrl(value: unknown, maxLength: number, field: string, truncated: Set<string>): string | undefined {
  const candidate = projectedProviderText(value, maxLength, field, truncated, true);
  if (!candidate) return undefined;
  try {
    return new URL(candidate).protocol === 'https:' ? candidate : undefined;
  } catch {
    truncated.add(field);
    return undefined;
  }
}

function boundedText(value: string | undefined, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`Google Calendar ${field} is too long.`);
  return normalized || undefined;
}

function isValidIanaTimeZone(value: string): boolean {
  if (/^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function boundedTimeZone(value: string | undefined): string | undefined {
  const normalized = boundedText(value, 'time zone', MAX_TIME_ZONE_LENGTH);
  if (normalized !== undefined && !isValidIanaTimeZone(normalized)) {
    throw new Error('Google Calendar time zone must be a valid IANA time zone.');
  }
  return normalized;
}

function boundedPatchText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`Google Calendar ${field} is too long.`);
  return normalized;
}

function boundedPageSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) throw new Error(`Google Calendar maxResults must be between 1 and ${MAX_PAGE_SIZE}.`);
  return value;
}

function boundedStringArray(values: readonly string[] | undefined, field: string, maxItems: number, maxLength: number): readonly string[] | undefined {
  if (values === undefined) return undefined;
  if (values.length > maxItems) throw new Error(`Google Calendar ${field} has too many entries.`);
  return values.map((value) => {
    const normalized = boundedText(value, field, maxLength);
    if (!normalized) throw new Error(`Google Calendar ${field} contains an empty value.`);
    return normalized;
  });
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function hasValidDateParts(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function isAllDayDate(value: string): boolean {
  const match = ALL_DAY_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  return hasValidDateParts(Number(year), Number(month), Number(day));
}

function hasExplicitOffset(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
}

function isDateTime(value: string): boolean {
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  if (!hasValidDateParts(Number(year), Number(month), Number(day))) return false;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return false;
  return true;
}

function isOffsetDateTime(value: string): boolean {
  return isDateTime(value) && hasExplicitOffset(value);
}

function dateTimeMillis(value: string): number {
  return Date.parse(hasExplicitOffset(value) ? value : `${value}Z`);
}

function validateTimePair(start: string, end: string, timeZone?: string): void {
  const startAllDay = isAllDayDate(start);
  const endAllDay = isAllDayDate(end);
  const startTimed = isDateTime(start);
  const endTimed = isDateTime(end);
  if ((!startAllDay && !startTimed) || (!endAllDay && !endTimed) || startAllDay !== endAllDay) {
    throw new Error('Google Calendar start/end must both be valid RFC 3339 date-times or both be real all-day YYYY-MM-DD dates.');
  }
  if (startTimed && endTimed && hasExplicitOffset(start) !== hasExplicitOffset(end)) {
    throw new Error('Google Calendar timed start/end must both include UTC offsets or both rely on the explicit time zone.');
  }
  if ((startTimed && !hasExplicitOffset(start)) || (endTimed && !hasExplicitOffset(end))) {
    if (!timeZone) throw new Error('Google Calendar date-times without a UTC offset require an explicit time zone.');
  }
  const startMs = startAllDay ? Date.parse(`${start}T00:00:00Z`) : dateTimeMillis(start);
  const endMs = endAllDay ? Date.parse(`${end}T00:00:00Z`) : dateTimeMillis(end);
  if (endMs <= startMs) throw new Error('Google Calendar event end must be after start.');
}

function eventDateTime(value: string, timeZone?: string): Record<string, string> {
  if (isAllDayDate(value)) return { date: value };
  if (!isDateTime(value)) throw new Error('Google Calendar date-time is invalid.');
  if (!hasExplicitOffset(value) && !timeZone) throw new Error('Google Calendar date-times without a UTC offset require an explicit time zone.');
  return { dateTime: value, ...(timeZone ? { timeZone } : {}) };
}

function validateRecurrence(values: readonly string[] | undefined): readonly string[] | undefined {
  const safe = boundedStringArray(values, 'recurrence rule', MAX_RECURRENCE_RULES, MAX_RECURRENCE_RULE_LENGTH);
  if (!safe) return undefined;
  for (const rule of safe) {
    if (!/^(?:RRULE|EXRULE|RDATE|EXDATE):/i.test(rule)) {
      throw new Error('Google Calendar recurrence entries must begin with RRULE:, EXRULE:, RDATE:, or EXDATE:.');
    }
    if (/^(?:DTSTART|DTEND):/i.test(rule)) {
      throw new Error('Google Calendar recurrence must not contain DTSTART or DTEND; use the event start/end fields.');
    }
  }
  return safe;
}

function boundedEvent(event: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const id = typeof event.id === 'string' ? boundedText(event.id, 'event ID', MAX_EVENT_ID_LENGTH) : undefined;
  const summary = typeof event.summary === 'string' ? boundedText(event.summary, 'event summary', MAX_EVENT_SUMMARY_LENGTH) : undefined;
  const normalized = {
    ...event,
    ...(id !== undefined ? { id } : {}),
    ...(summary !== undefined ? { summary } : {}),
  };
  const body = JSON.stringify(normalized);
  if (new TextEncoder().encode(body).byteLength > MAX_EVENT_BODY_BYTES) throw new Error('Google Calendar event body is too large.');
  return normalized;
}

function normalizeEventSummary(event: CalendarApiEvent): CalendarEventSummary | null {
  const truncated = new Set<string>();
  const id = projectedProviderId(event.id, MAX_EVENT_ID_LENGTH, 'id', truncated);
  if (!id) return null;
  const etag = projectedProviderId(event.etag, MAX_ETAG_LENGTH, 'etag', truncated);
  const summary = projectedProviderText(event.summary, MAX_EVENT_SUMMARY_LENGTH, 'summary', truncated) ?? '(untitled)';
  const startValue = projectedProviderText(event.start?.dateTime ?? event.start?.date, MAX_TIME_PARAMETER_LENGTH, 'start', truncated) ?? '';
  const endValue = projectedProviderText(event.end?.dateTime ?? event.end?.date, MAX_TIME_PARAMETER_LENGTH, 'end', truncated) ?? '';
  const startTimeZone = projectedProviderText(event.start?.timeZone, MAX_TIME_ZONE_LENGTH, 'startTimeZone', truncated);
  const endTimeZone = projectedProviderText(event.end?.timeZone, MAX_TIME_ZONE_LENGTH, 'endTimeZone', truncated);
  const status = projectedProviderText(event.status, 128, 'status', truncated);
  const htmlLink = projectedProviderHttpsUrl(event.htmlLink, 2_000, 'htmlLink', truncated);
  const recurringEventId = projectedProviderId(event.recurringEventId, MAX_EVENT_ID_LENGTH, 'recurringEventId', truncated);
  return {
    trust: 'untrusted-external',
    source: 'calendar',
    id,
    ...(etag ? { etag } : {}),
    summary,
    start: startValue,
    end: endValue,
    ...(startTimeZone ? { startTimeZone } : {}),
    ...(endTimeZone ? { endTimeZone } : {}),
    ...(status ? { status } : {}),
    ...(htmlLink ? { htmlLink } : {}),
    ...(recurringEventId ? { recurringEventId } : {}),
    ...(truncated.size ? { truncatedFields: [...truncated].sort() } : {}),
  };
}

function normalizeEventDetail(event: CalendarApiEvent): CalendarEventDetail {
  const summary = normalizeEventSummary(event);
  if (!summary) throw new Error('Google Calendar returned an event without a usable ID.');
  const truncated = new Set(summary.truncatedFields ?? []);
  const rawAttendees = Array.isArray(event.attendees) ? event.attendees : [];
  if (rawAttendees.length > MAX_ATTENDEES) truncated.add('attendees');
  const attendees = rawAttendees.slice(0, MAX_ATTENDEES).flatMap((attendee) => {
    const email = projectedProviderText(attendee.email, 320, 'attendees.email', truncated, true);
    if (!email) return [];
    const responseStatus = projectedProviderText(attendee.responseStatus, 128, 'attendees.responseStatus', truncated, true);
    return [{
      email,
      ...(responseStatus ? { responseStatus } : {}),
      ...(attendee.self !== undefined ? { self: Boolean(attendee.self) } : {}),
      ...(attendee.organizer !== undefined ? { organizer: Boolean(attendee.organizer) } : {}),
      ...(attendee.optional !== undefined ? { optional: Boolean(attendee.optional) } : {}),
    }];
  });
  const rawRecurrence = Array.isArray(event.recurrence) ? event.recurrence : [];
  if (rawRecurrence.length > MAX_RECURRENCE_RULES) truncated.add('recurrence');
  const recurrence = rawRecurrence.slice(0, MAX_RECURRENCE_RULES).flatMap((rule) => {
    const value = projectedProviderText(rule, MAX_RECURRENCE_RULE_LENGTH, 'recurrence', truncated);
    return value ? [value] : [];
  });
  const location = projectedProviderText(event.location, MAX_EVENT_LOCATION_LENGTH, 'location', truncated);
  const description = projectedProviderText(event.description, MAX_EVENT_DESCRIPTION_LENGTH, 'description', truncated);
  const organizerEmail = projectedProviderText(event.organizer?.email, 320, 'organizerEmail', truncated, true);
  const creatorEmail = projectedProviderText(event.creator?.email, 320, 'creatorEmail', truncated, true);
  const eventType = projectedProviderText(event.eventType, 128, 'eventType', truncated, true);
  const transparency = projectedProviderText(event.transparency, 128, 'transparency', truncated, true);
  const visibility = projectedProviderText(event.visibility, 128, 'visibility', truncated, true);

  return {
    ...summary,
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
    ...(recurrence.length ? { recurrence } : {}),
    ...(attendees.length ? { attendees } : {}),
    ...(organizerEmail ? { organizerEmail } : {}),
    ...(creatorEmail ? { creatorEmail } : {}),
    ...(eventType ? { eventType } : {}),
    ...(transparency ? { transparency } : {}),
    ...(visibility ? { visibility } : {}),
    ...(truncated.size ? { truncatedFields: [...truncated].sort() } : {}),
  };
}

function withSendUpdates(url: URL, sendUpdates: CalendarSendUpdates | undefined): URL {
  if (sendUpdates) url.searchParams.set('sendUpdates', sendUpdates);
  return url;
}

async function calendarEventIdForCallId(callId: string): Promise<string> {
  const normalized = boundedText(callId, 'idempotency key', 2048);
  if (!normalized) throw new Error('Google Calendar idempotency key is empty.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`elara-calendar-event-v1\n${normalized}`));
  const hex = [...new Uint8Array(digest)].slice(0, 20).map((value) => value.toString(16).padStart(2, '0')).join('');
  return `elara${hex}`;
}

function conditionalHeaders(etag: string): Record<string, string> {
  const safeEtag = boundedText(etag, 'event ETag', MAX_ETAG_LENGTH);
  if (!safeEtag || !CONCRETE_ETAG_PATTERN.test(safeEtag)) {
    throw new Error('Google Calendar mutations require one concrete provider ETag. Read the event again before changing it.');
  }
  return { 'If-Match': safeEtag };
}

function throwMutationFailure(response: Response, action: string): never {
  if (response.status === 412) throw new Error(`Google Calendar ${action} was rejected because the event changed. Read the event again before retrying.`);
  throw new Error(`Google Calendar ${action} request failed (${response.status}).`);
}

export class GoogleCalendarService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async listEvents(calendarId = 'primary', timeMin?: string, timeMax?: string): Promise<CalendarEventSummary[]> {
    const page = await this.listEventPage({ calendarId, timeMin, timeMax });
    return [...page.events];
  }

  async listEventPage(input: CalendarEventListInput = {}): Promise<CalendarEventPage> {
    const safeCalendarId = boundedText(input.calendarId, 'calendar ID', MAX_CALENDAR_ID_LENGTH) ?? 'primary';
    const safeTimeMin = boundedText(input.timeMin, 'timeMin', MAX_TIME_PARAMETER_LENGTH);
    const safeTimeMax = boundedText(input.timeMax, 'timeMax', MAX_TIME_PARAMETER_LENGTH);
    const safePageToken = boundedText(input.pageToken, 'page token', MAX_PAGE_TOKEN_LENGTH);
    const safeQuery = boundedText(input.query, 'query', MAX_QUERY_LENGTH);
    const safeTimeZone = boundedTimeZone(input.timeZone);
    const maxResults = boundedPageSize(input.maxResults);
    if (safeTimeMin && !isOffsetDateTime(safeTimeMin)) throw new Error('Google Calendar timeMin must be a real RFC 3339 timestamp with an explicit UTC offset.');
    if (safeTimeMax && !isOffsetDateTime(safeTimeMax)) throw new Error('Google Calendar timeMax must be a real RFC 3339 timestamp with an explicit UTC offset.');
    if (safeTimeMin && safeTimeMax && Date.parse(safeTimeMax) <= Date.parse(safeTimeMin)) throw new Error('Google Calendar timeMax must be after timeMin.');
    const access = await this.oauth.authorize('calendar.events.read');
    const request = this.buildEventsRequest(access, safeCalendarId, safeTimeMin, safeTimeMax, safePageToken, maxResults, safeQuery, safeTimeZone);
    const response = await request.fetch(request.url);
    if (!response.ok) throw new Error(`Google Calendar request failed (${response.status}).`);

    const payload = await readBoundedProviderJson<CalendarEventsResponse>(response, { operation: 'Google Calendar events request', maxBytes: MAX_PROVIDER_JSON_BYTES });
    const events = (payload.items ?? []).map(normalizeEventSummary).filter((event): event is CalendarEventSummary => event !== null);
    return { events, ...(payload.nextPageToken ? { nextPageToken: payload.nextPageToken } : {}) };
  }

  async getEvent(calendarId = 'primary', eventId: string, timeZone?: string): Promise<CalendarEventDetail> {
    const safeCalendarId = boundedText(calendarId, 'calendar ID', MAX_CALENDAR_ID_LENGTH) ?? 'primary';
    const safeEventId = boundedText(eventId, 'event ID', MAX_EVENT_ID_LENGTH);
    const safeTimeZone = boundedTimeZone(timeZone);
    if (!safeEventId) throw new Error('Google Calendar event ID is required.');
    const access = await this.oauth.authorize('calendar.events.read');
    return this.getEventWithAccess(access, safeCalendarId, safeEventId, safeTimeZone);
  }

  async listCalendars(input: CalendarListInput = {}): Promise<CalendarListPage> {
    const safePageToken = boundedText(input.pageToken, 'page token', MAX_PAGE_TOKEN_LENGTH);
    const pageSize = boundedPageSize(input.maxResults);
    const access = await this.oauth.authorize('calendar.list.read');
    const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
    url.searchParams.set('maxResults', String(pageSize));
    if (safePageToken) url.searchParams.set('pageToken', safePageToken);
    if (input.showHidden !== undefined) url.searchParams.set('showHidden', String(input.showHidden));
    if (input.minAccessRole) url.searchParams.set('minAccessRole', input.minAccessRole);
    if (input.showOwnOrganizationOnly !== undefined) url.searchParams.set('showOwnOrganizationOnly', String(input.showOwnOrganizationOnly));
    const response = await access.fetch(url);
    if (!response.ok) throw new Error(`Google Calendar list request failed (${response.status}).`);
    const payload = await readBoundedProviderJson<CalendarListResponse>(response, { operation: 'Google Calendar list request', maxBytes: MAX_PROVIDER_JSON_BYTES });
    const calendars = (payload.items ?? [])
      .filter((entry): entry is typeof entry & { id: string } => Boolean(entry.id))
      .map((entry) => ({
        id: entry.id,
        summary: entry.summary ?? '(untitled calendar)',
        primary: entry.primary ?? false,
        selected: entry.selected ?? false,
        ...(entry.accessRole ? { accessRole: entry.accessRole } : {}),
        ...(entry.timeZone ? { timeZone: entry.timeZone } : {}),
        ...(entry.backgroundColor ? { backgroundColor: entry.backgroundColor } : {}),
      }));
    return { calendars, ...(payload.nextPageToken ? { nextPageToken: payload.nextPageToken } : {}) };
  }

  async getSettings(): Promise<Readonly<Record<string, string>>> {
    const access = await this.oauth.authorize('calendar.settings.read');
    const response = await access.fetch(new URL('https://www.googleapis.com/calendar/v3/users/me/settings'));
    if (!response.ok) throw new Error(`Google Calendar settings request failed (${response.status}).`);
    const payload = await readBoundedProviderJson<CalendarSettingsResponse>(response, { operation: 'Google Calendar settings request', maxBytes: MAX_PROVIDER_JSON_BYTES });
    const settings: Record<string, string> = {};
    for (const item of payload.items ?? []) if (item.id && item.value !== undefined) settings[item.id] = item.value;
    return settings;
  }

  async queryFreeBusy(timeMin: string, timeMax: string, calendarIds: readonly string[], timeZone?: string): Promise<CalendarFreeBusyResult> {
    const safeTimeMin = boundedText(timeMin, 'timeMin', MAX_TIME_PARAMETER_LENGTH);
    const safeTimeMax = boundedText(timeMax, 'timeMax', MAX_TIME_PARAMETER_LENGTH);
    const safeTimeZone = boundedTimeZone(timeZone);
    if (!safeTimeMin || !safeTimeMax || !isOffsetDateTime(safeTimeMin) || !isOffsetDateTime(safeTimeMax)) {
      throw new Error('Google Calendar free/busy requires real RFC 3339 timeMin and timeMax with explicit UTC offsets.');
    }
    if (Date.parse(safeTimeMax) <= Date.parse(safeTimeMin)) throw new Error('Google Calendar free/busy timeMax must be after timeMin.');
    const safeCalendarIds = boundedStringArray(calendarIds, 'calendar ID', MAX_FREEBUSY_CALENDARS, MAX_CALENDAR_ID_LENGTH) ?? [];
    if (safeCalendarIds.length === 0) throw new Error('Google Calendar free/busy requires at least one calendar.');
    const access = await this.oauth.authorize('calendar.freebusy.read');
    const response = await access.fetch(new URL('https://www.googleapis.com/calendar/v3/freeBusy'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeMin: safeTimeMin, timeMax: safeTimeMax, ...(safeTimeZone ? { timeZone: safeTimeZone } : {}), items: safeCalendarIds.map((id) => ({ id })) }),
    });
    if (!response.ok) throw new Error(`Google Calendar free/busy request failed (${response.status}).`);
    const payload = await readBoundedProviderJson<CalendarFreeBusyResponse>(response, { operation: 'Google Calendar free/busy request', maxBytes: MAX_PROVIDER_JSON_BYTES });
    return {
      timeMin: payload.timeMin ?? safeTimeMin,
      timeMax: payload.timeMax ?? safeTimeMax,
      calendars: Object.entries(payload.calendars ?? {}).map(([calendarId, entry]) => ({
        calendarId,
        busy: (entry.busy ?? [])
          .filter((interval): interval is { start: string; end: string } => Boolean(interval.start && interval.end))
          .map((interval) => ({ start: interval.start, end: interval.end })),
        ...(entry.errors?.length ? { errors: entry.errors } : {}),
      })),
    };
  }

  async createSemanticEvent(input: CalendarEventSemanticInput): Promise<CalendarEventDetail> {
    const safeSummary = boundedText(input.summary, 'event summary', MAX_EVENT_SUMMARY_LENGTH);
    const safeStart = boundedText(input.start, 'event start', MAX_TIME_PARAMETER_LENGTH);
    const safeEnd = boundedText(input.end, 'event end', MAX_TIME_PARAMETER_LENGTH);
    if (!safeSummary || !safeStart || !safeEnd) throw new Error('Google Calendar event summary, start, and end are required.');
    const safeTimeZone = boundedTimeZone(input.timeZone);
    validateTimePair(safeStart, safeEnd, safeTimeZone);
    const safeLocation = boundedText(input.location, 'location', MAX_EVENT_LOCATION_LENGTH);
    const safeDescription = boundedText(input.description, 'description', MAX_EVENT_DESCRIPTION_LENGTH);
    const safeAttendees = boundedStringArray(input.attendees, 'attendee', MAX_ATTENDEES, 320);
    const safeRecurrence = validateRecurrence(input.recurrence);
    if (safeRecurrence?.length && isDateTime(safeStart) && !safeTimeZone) throw new Error('Google Calendar recurring date-time events require an explicit time zone.');

    const event: Record<string, unknown> = {
      summary: safeSummary,
      start: eventDateTime(safeStart, safeTimeZone),
      end: eventDateTime(safeEnd, safeTimeZone),
    };
    if (safeLocation !== undefined) event.location = safeLocation;
    if (safeDescription !== undefined) event.description = safeDescription;
    if (safeAttendees?.length) event.attendees = safeAttendees.map((email) => ({ email }));
    if (safeRecurrence?.length) event.recurrence = [...safeRecurrence];
    return this.createEvent({ calendarId: input.calendarId, event, sendUpdates: input.sendUpdates, idempotencyKey: input.idempotencyKey });
  }

  async createEvent({ calendarId = 'primary', event, sendUpdates, idempotencyKey }: CalendarEventCreateInput): Promise<CalendarEventDetail> {
    const safeCalendarId = boundedText(calendarId, 'calendar ID', MAX_CALENDAR_ID_LENGTH) ?? 'primary';
    const generatedId = idempotencyKey ? await calendarEventIdForCallId(idempotencyKey) : undefined;
    const safeEvent = boundedEvent(generatedId && event.id === undefined ? { ...event, id: generatedId } : event);
    const access = await this.oauth.authorize('calendar.events.write');
    const url = withSendUpdates(new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(safeCalendarId)}/events`), sendUpdates);
    const response = await access.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(safeEvent) });
    if (response.status === 409 && generatedId) return this.getEventWithAccess(access, safeCalendarId, generatedId);
    if (!response.ok) throw new Error(`Google Calendar create request failed (${response.status}).`);
    return normalizeEventDetail(await readBoundedProviderJson<CalendarApiEvent>(response, { operation: 'Google Calendar event request', maxBytes: MAX_PROVIDER_JSON_BYTES }));
  }

  async updateSemanticEvent(input: CalendarEventSemanticUpdateInput): Promise<CalendarEventDetail> {
    const safeEventId = boundedText(input.eventId, 'event ID', MAX_EVENT_ID_LENGTH);
    if (!safeEventId) throw new Error('Google Calendar event ID is required.');
    const updatesStart = input.start !== undefined;
    const updatesEnd = input.end !== undefined;
    if (updatesStart !== updatesEnd) {
      throw new Error('Changing Google Calendar event timing requires both start and end boundaries.');
    }
    const safeTimeZone = boundedTimeZone(input.timeZone);
    const safeRecurrence = input.recurrence !== undefined ? validateRecurrence(input.recurrence) ?? [] : undefined;
    if (safeRecurrence?.length && (input.start === undefined || input.end === undefined)) {
      throw new Error('Google Calendar recurrence updates require explicit start and end boundaries.');
    }
    if (input.start !== undefined && input.end !== undefined) validateTimePair(input.start.trim(), input.end.trim(), safeTimeZone);
    if (safeRecurrence?.length && input.start !== undefined && input.end !== undefined) {
      const recurringTimedBoundary = isDateTime(input.start.trim()) || isDateTime(input.end.trim());
      if (recurringTimedBoundary && !safeTimeZone) throw new Error('Google Calendar recurring date-time updates require an explicit time zone.');
    }

    const patch: Record<string, unknown> = {};
    if (input.summary !== undefined) patch.summary = boundedPatchText(input.summary, 'event summary', MAX_EVENT_SUMMARY_LENGTH);
    if (input.start !== undefined) {
      const start = boundedText(input.start, 'event start', MAX_TIME_PARAMETER_LENGTH);
      if (!start) throw new Error('Google Calendar event start cannot be empty.');
      patch.start = eventDateTime(start, safeTimeZone);
    }
    if (input.end !== undefined) {
      const end = boundedText(input.end, 'event end', MAX_TIME_PARAMETER_LENGTH);
      if (!end) throw new Error('Google Calendar event end cannot be empty.');
      patch.end = eventDateTime(end, safeTimeZone);
    }
    if (input.location !== undefined) patch.location = boundedPatchText(input.location, 'location', MAX_EVENT_LOCATION_LENGTH);
    if (input.description !== undefined) patch.description = boundedPatchText(input.description, 'description', MAX_EVENT_DESCRIPTION_LENGTH);
    if (input.attendees !== undefined) patch.attendees = (boundedStringArray(input.attendees, 'attendee', MAX_ATTENDEES, 320) ?? []).map((email) => ({ email }));
    if (input.recurrence !== undefined) patch.recurrence = [...(safeRecurrence ?? [])];
    if (Object.keys(patch).length === 0) throw new Error('Google Calendar update requires at least one event change.');
    return this.updateEvent(input.calendarId, safeEventId, input.etag, patch, input.sendUpdates);
  }

  async updateEvent(calendarId = 'primary', eventId: string, etag: string, patch: Readonly<Record<string, unknown>>, sendUpdates?: CalendarSendUpdates): Promise<CalendarEventDetail> {
    const safeCalendarId = boundedText(calendarId, 'calendar ID', MAX_CALENDAR_ID_LENGTH) ?? 'primary';
    const safeEventId = boundedText(eventId, 'event ID', MAX_EVENT_ID_LENGTH);
    if (!safeEventId) throw new Error('Google Calendar event ID is required.');
    const safePatch = boundedEvent(patch);
    const headers = { 'content-type': 'application/json', ...conditionalHeaders(etag) };
    const access = await this.oauth.authorize('calendar.events.write');
    const url = withSendUpdates(new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(safeCalendarId)}/events/${encodeURIComponent(safeEventId)}`), sendUpdates);
    const response = await access.fetch(url, { method: 'PATCH', headers, body: JSON.stringify(safePatch) });
    if (!response.ok) throwMutationFailure(response, 'update');
    return normalizeEventDetail(await readBoundedProviderJson<CalendarApiEvent>(response, { operation: 'Google Calendar event request', maxBytes: MAX_PROVIDER_JSON_BYTES }));
  }

  async deleteEvent(calendarId = 'primary', eventId: string, etag: string, sendUpdates?: CalendarSendUpdates): Promise<{ deleted: true; calendarId: string; eventId: string }> {
    const safeCalendarId = boundedText(calendarId, 'calendar ID', MAX_CALENDAR_ID_LENGTH) ?? 'primary';
    const safeEventId = boundedText(eventId, 'event ID', MAX_EVENT_ID_LENGTH);
    if (!safeEventId) throw new Error('Google Calendar event ID is required.');
    const headers = conditionalHeaders(etag);
    const access = await this.oauth.authorize('calendar.events.write');
    const url = withSendUpdates(new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(safeCalendarId)}/events/${encodeURIComponent(safeEventId)}`), sendUpdates);
    const response = await access.fetch(url, { method: 'DELETE', headers });
    if (!response.ok) throwMutationFailure(response, 'delete');
    return { deleted: true, calendarId: safeCalendarId, eventId: safeEventId };
  }

  private async getEventWithAccess(access: AuthorizedGoogleRequest, calendarId: string, eventId: string, timeZone?: string): Promise<CalendarEventDetail> {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    if (timeZone) url.searchParams.set('timeZone', timeZone);
    const response = await access.fetch(url);
    if (!response.ok) throw new Error(`Google Calendar event request failed (${response.status}).`);
    return normalizeEventDetail(await readBoundedProviderJson<CalendarApiEvent>(response, { operation: 'Google Calendar event request', maxBytes: MAX_PROVIDER_JSON_BYTES }));
  }

  private buildEventsRequest(
    access: AuthorizedGoogleRequest,
    calendarId: string,
    timeMin?: string,
    timeMax?: string,
    pageToken?: string,
    maxResults = DEFAULT_PAGE_SIZE,
    query?: string,
    timeZone?: string,
  ): { url: URL; fetch: AuthorizedGoogleRequest['fetch'] } {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', String(maxResults));
    if (timeMin) url.searchParams.set('timeMin', timeMin);
    if (timeMax) url.searchParams.set('timeMax', timeMax);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    if (query) url.searchParams.set('q', query);
    if (timeZone) url.searchParams.set('timeZone', timeZone);
    return { url, fetch: access.fetch };
  }
}
