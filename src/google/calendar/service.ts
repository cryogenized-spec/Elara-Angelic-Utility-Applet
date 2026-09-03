import type { AuthorizedGoogleRequest, GoogleOAuthAuthority } from '../oauth/contracts';

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

export class GoogleCalendarService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async listEvents(calendarId = 'primary', timeMin?: string, timeMax?: string): Promise<CalendarEventSummary[]> {
    const access = await this.oauth.authorize('calendar.events.read');
    const request = this.buildEventsRequest(access, calendarId, timeMin, timeMax);
    const response = await request.fetch(request.url);

    if (!response.ok) {
      throw new Error(`Google Calendar request failed (${response.status}).`);
    }

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
