import type { AuthorizedGoogleRequest, GoogleOAuthAuthority } from '../oauth/contracts';

const MAX_CALENDAR_ID_LENGTH = 500;
const MAX_TIME_PARAMETER_LENGTH = 100;

export interface CalendarEventSummary {
  id: string;
  summary: string;
  start: string;
  end: string;
}

interface CalendarEventsResponse {
  items?: Array<{
    id?: string;
    summary?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  }>;
}

function boundedText(value: string | undefined, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`Google Calendar ${field} is too long.`);
  return normalized || undefined;
}

export class GoogleCalendarService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async listEvents(calendarId = 'primary', timeMin?: string, timeMax?: string): Promise<CalendarEventSummary[]> {
    const safeCalendarId = boundedText(calendarId, 'calendar ID', MAX_CALENDAR_ID_LENGTH) ?? 'primary';
    const safeTimeMin = boundedText(timeMin, 'timeMin', MAX_TIME_PARAMETER_LENGTH);
    const safeTimeMax = boundedText(timeMax, 'timeMax', MAX_TIME_PARAMETER_LENGTH);
    const access = await this.oauth.authorize('calendar.events.read');
    const request = this.buildEventsRequest(access, safeCalendarId, safeTimeMin, safeTimeMax);
    const response = await request.fetch(request.url);

    if (!response.ok) throw new Error(`Google Calendar request failed (${response.status}).`);

    const payload = (await response.json()) as CalendarEventsResponse;
    return (payload.items ?? [])
      .filter((event): event is Required<Pick<typeof event, 'id'>> & typeof event => Boolean(event.id))
      .map((event) => ({
        id: event.id,
        summary: event.summary ?? '(untitled)',
        start: event.start?.dateTime ?? event.start?.date ?? '',
        end: event.end?.dateTime ?? event.end?.date ?? '',
      }));
  }

  private buildEventsRequest(
    access: AuthorizedGoogleRequest,
    calendarId: string,
    timeMin?: string,
    timeMax?: string,
  ): { url: URL; fetch: AuthorizedGoogleRequest['fetch'] } {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    if (timeMin) url.searchParams.set('timeMin', timeMin);
    if (timeMax) url.searchParams.set('timeMax', timeMax);
    return { url, fetch: access.fetch };
  }
}
