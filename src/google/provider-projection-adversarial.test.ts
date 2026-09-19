import { describe, expect, it } from 'vitest';
import type { GoogleOAuthAuthority } from './oauth/contracts';
import { readBoundedProviderJson } from './provider-json-boundary';
import { GoogleCalendarService } from './calendar/service';
import { GoogleTasksService } from './tasks/service';
import { GoogleDriveService } from './drive/service';
import { GoogleDocsService } from './docs/service';
import { GoogleSheetsService } from './sheets/service';

function oauthWith(responseFactory: () => Response): GoogleOAuthAuthority {
  return {
    authorize: async (capability) => ({ capability, fetch: async () => responseFactory() }),
    getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
    disconnect: async () => undefined,
  };
}

describe('Workspace provider payload boundary', () => {
  it('rejects declared and streamed JSON overflow before parsing', async () => {
    const declared = new Response('{}', { status: 200, headers: { 'content-length': '100' } });
    await expect(readBoundedProviderJson(declared, { operation: 'Test provider', maxBytes: 10 }))
      .rejects.toThrow(/byte limit/i);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":"1234'));
        controller.enqueue(new TextEncoder().encode('567890"}'));
        controller.close();
      },
    });
    const chunked = new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    await expect(readBoundedProviderJson(chunked, { operation: 'Test provider', maxBytes: 10 }))
      .rejects.toThrow(/byte limit/i);
  });

  it('marks Calendar provider projection truncation and keeps external provenance', async () => {
    const event = {
      id: 'evt-1',
      etag: '"etag-1"',
      summary: 's'.repeat(1_100),
      start: { dateTime: '2026-09-19T08:00:00+02:00' },
      end: { dateTime: '2026-09-19T09:00:00+02:00' },
      description: 'd'.repeat(9_000),
      recurrence: Array.from({ length: 25 }, (_, index) => `RRULE:FREQ=DAILY;COUNT=${index + 1}`),
      attendees: Array.from({ length: 60 }, (_, index) => ({ email: `person-${index}@example.com` })),
    };
    const service = new GoogleCalendarService(oauthWith(() => new Response(JSON.stringify(event), { status: 200 })));
    const result = await service.getEvent('primary', 'evt-1');
    expect(result.trust).toBe('untrusted-external');
    expect(result.source).toBe('calendar');
    expect(result.summary).toHaveLength(1_000);
    expect(result.description).toHaveLength(8_000);
    expect(result.attendees).toHaveLength(50);
    expect(result.recurrence).toHaveLength(20);
    expect(result.truncatedFields).toEqual(expect.arrayContaining(['summary', 'description', 'attendees', 'recurrence']));
  });

  it('bounds Calendar settings and free/busy provider overrun', async () => {
    const settingsPayload = {
      items: Array.from({ length: 101 }, (_, index) => ({ id: `setting-${index}`, value: 'v'.repeat(2_100) })),
    };
    const settingsService = new GoogleCalendarService(oauthWith(() => new Response(JSON.stringify(settingsPayload), { status: 200 })));
    const settings = await settingsService.getSettings();
    expect(settings.trust).toBe('untrusted-external');
    expect(settings.source).toBe('calendar');
    expect(Object.keys(settings.settings)).toHaveLength(100);
    expect(settings.settings['setting-0']).toHaveLength(2_000);
    expect(settings.truncated).toBe(true);

    const freeBusyPayload = {
      timeMin: '2026-09-19T08:00:00+02:00',
      timeMax: '2026-09-20T08:00:00+02:00',
      calendars: {
        primary: {
          busy: Array.from({ length: 201 }, () => ({ start: '2026-09-19T08:00:00+02:00', end: '2026-09-19T08:30:00+02:00' })),
          errors: Array.from({ length: 21 }, () => ({ reason: 'busy', domain: 'calendar' })),
        },
      },
    };
    const freeBusyService = new GoogleCalendarService(oauthWith(() => new Response(JSON.stringify(freeBusyPayload), { status: 200 })));
    const freeBusy = await freeBusyService.queryFreeBusy(
      '2026-09-19T08:00:00+02:00',
      '2026-09-20T08:00:00+02:00',
      ['primary'],
    );
    expect(freeBusy.calendars).toHaveLength(1);
    expect(freeBusy.calendars[0]?.busy).toHaveLength(200);
    expect(freeBusy.calendars[0]?.errors).toHaveLength(20);
    expect(freeBusy.calendars[0]?.truncated).toBe(true);
    expect(freeBusy.truncated).toBe(true);
  });

  it('bounds Tasks notes and links with visible truncation metadata', async () => {
    const task = {
      id: 'task-1',
      title: 't'.repeat(1_100),
      notes: 'n'.repeat(9_000),
      links: Array.from({ length: 25 }, (_, index) => ({ type: 'related', description: 'd'.repeat(2_500), link: `https://example.com/${index}` })),
    };
    const service = new GoogleTasksService(oauthWith(() => new Response(JSON.stringify(task), { status: 200 })));
    const result = await service.getTask('list-1', 'task-1');
    expect(result.trust).toBe('untrusted-external');
    expect(result.source).toBe('tasks');
    expect(result.title).toHaveLength(1_024);
    expect(result.notes).toHaveLength(8_192);
    expect(result.links).toHaveLength(20);
    expect(result.truncatedFields).toEqual(expect.arrayContaining(['title', 'notes', 'links', 'links.description']));
  });

  it('bounds Drive metadata without fabricating provider identities', async () => {
    const file = {
      id: 'file-1',
      name: 'n'.repeat(600),
      mimeType: 'text/plain',
      description: 'd'.repeat(2_500),
      parents: Array.from({ length: 25 }, (_, index) => `parent-${index}`),
      etag: '"etag-1"',
      capabilities: { canDownload: true },
    };
    const service = new GoogleDriveService(oauthWith(() => new Response(JSON.stringify(file), { status: 200 })));
    const result = await service.getFile('file-1');
    expect(result.trust).toBe('untrusted-external');
    expect(result.source).toBe('drive');
    expect(result.id).toBe('file-1');
    expect(result.name).toHaveLength(500);
    expect(result.description).toHaveLength(2_000);
    expect(result.parents).toHaveLength(20);
    expect(result.truncatedFields).toEqual(expect.arrayContaining(['name', 'description', 'parents']));
  });

  it('caps Docs semantic inspection independently of raw response size', async () => {
    const content = Array.from({ length: 501 }, (_, index) => ({
      startIndex: index * 10 + 1,
      endIndex: index * 10 + 10,
      paragraph: { elements: [{ textRun: { content: `${'x'.repeat(500)}\n` } }] },
    }));
    const payload = {
      documentId: 'doc-1',
      title: 'Large plan',
      revisionId: 'rev-1',
      tabs: [{
        tabProperties: { tabId: 'tab-1', title: 'Main' },
        documentTab: { body: { content } },
      }],
    };
    const service = new GoogleDocsService(oauthWith(() => new Response(JSON.stringify(payload), { status: 200 })));
    const result = await service.inspectDocument('doc-1');
    expect(result.trust).toBe('untrusted-external');
    expect(result.source).toBe('docs');
    expect(result.blocks.length).toBeLessThanOrEqual(500);
    expect(result.truncated).toBe(true);
    expect(result.truncationReasons).toEqual(expect.arrayContaining(['blocks', 'text']));
  });

  it('returns a bounded Sheets projection with explicit truncation instead of model amplification', async () => {
    const payload = {
      range: 'Sheet1!A1:A1001',
      majorDimension: 'ROWS',
      values: Array.from({ length: 1_001 }, () => ['x']),
    };
    const service = new GoogleSheetsService(oauthWith(() => new Response(JSON.stringify(payload), { status: 200 })));
    const result = await service.readRange('sheet-1', 'Sheet1!A1:A1001');
    expect(result.trust).toBe('untrusted-external');
    expect(result.source).toBe('sheets');
    expect(result.values).toHaveLength(1_000);
    expect(result.truncated).toBe(true);
    expect(result.truncationReasons).toContain('rows');
  });
});
