import { describe, expect, it, vi } from 'vitest';
import { GoogleDriveService, driveQueryWithTrashBoundary } from './service';
import { DRIVE_LIMITS } from './limits';
import type { GoogleOAuthAuthority } from '../oauth/contracts';

function makeOAuth(handler: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>): GoogleOAuthAuthority {
  return {
    authorize: async (capability) => ({ capability, fetch: handler }),
    getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
    disconnect: async () => undefined,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function mediaResponse(bytes: number[], headers: Record<string, string> = { 'content-type': 'text/plain' }): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-length': String(bytes.length), ...headers } });
}

const FILE_METADATA = {
  id: 'file-1',
  name: 'Plan',
  mimeType: 'text/plain',
  modifiedTime: '2026-09-04T00:00:00Z',
  createdTime: '2026-09-01T00:00:00Z',
  webViewLink: 'https://drive.google.com/file/d/file-1/view',
  parents: ['root'],
  size: '3',
  starred: true,
  description: 'Quarterly plan',
  trashed: false,
  etag: '"etag-1"',
  capabilities: { canDownload: true },
};

describe('GoogleDriveService', () => {
  it('keeps read and write capabilities separate', async () => {
    const calls: string[] = [];
    const oauth = makeOAuth(async (url, init) => {
      calls.push(`${init?.method ?? 'GET'}:${String(url)}`);
      return jsonResponse({ id: 'file-1', name: 'Plan', mimeType: 'text/plain' });
    });
    const service = new GoogleDriveService(oauth);
    await expect(service.getFile('file-1')).resolves.toMatchObject({ id: 'file-1' });
    await expect(service.updateFile('file-1', '"etag-1"', { name: 'Updated' })).resolves.toMatchObject({ name: 'Plan' });
    expect(calls[0]).toContain('/files/file-1?fields=');
    expect(calls[1]).toContain('PATCH:');
  });

  it('rechecks elected-turn authority immediately before a provider write', async () => {
    let active = true;
    const providerFetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit, beforeProviderFetch?: () => void) => {
      active = false;
      beforeProviderFetch?.();
      return jsonResponse(FILE_METADATA);
    });
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => ({ capability, fetch: providerFetch }),
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
      disconnect: async () => undefined,
    };
    const service = new GoogleDriveService(oauth);

    await expect(service.createFile({ name: 'Plan' }, { isGenerationActive: () => active }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it('sends one concrete strong ETag as the conditional-write precondition', async () => {
    const calls: Array<{ method?: string; ifMatch?: string; body?: string }> = [];
    const oauth = makeOAuth(async (_url, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ method: init?.method, ifMatch: headers?.['If-Match'], body: typeof init?.body === 'string' ? init.body : undefined });
      return jsonResponse(FILE_METADATA);
    });
    const service = new GoogleDriveService(oauth);

    await service.updateFile('file-1', '"etag-1"', { name: 'Renamed' });
    await service.moveFile('file-1', '"etag-1"', 'folder-2', 'folder-1');
    await service.trashFile('file-1', '"etag-1"');

    expect(calls.map((call) => call.ifMatch)).toEqual(['"etag-1"', '"etag-1"', '"etag-1"']);
    expect(calls.map((call) => call.method)).toEqual(['PATCH', 'PATCH', 'PATCH']);
    expect(calls[2].body).toBe(JSON.stringify({ trashed: true }));
  });

  it('rejects weak, wildcard, multi-value and empty ETags at the service boundary', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(FILE_METADATA));
    const oauth = makeOAuth(fetchSpy);
    const service = new GoogleDriveService(oauth);

    for (const invalid of ['W/"etag-1"', '*', '', '   ', '"one", "two"', 'etag-1']) {
      await expect(service.updateFile('file-1', invalid, { name: 'Renamed' })).rejects.toThrow(/concrete provider ETag/);
      await expect(service.moveFile('file-1', invalid, 'folder-2')).rejects.toThrow(/concrete provider ETag/);
      await expect(service.trashFile('file-1', invalid)).rejects.toThrow(/concrete provider ETag/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('turns a rejected conditional write into a read-again failure', async () => {
    const oauth = makeOAuth(async () => new Response('{}', { status: 412, headers: { 'content-type': 'application/json' } }));
    const service = new GoogleDriveService(oauth);

    await expect(service.updateFile('file-1', '"etag-1"', { name: 'Renamed' })).rejects.toThrow('Read the file again before retrying.');
    await expect(service.moveFile('file-1', '"etag-1"', 'folder-2')).rejects.toThrow('Read the file again before retrying.');
    await expect(service.trashFile('file-1', '"etag-1"')).rejects.toThrow('Read the file again before retrying.');
  });

  it('projects provider identity and user metadata in every read', async () => {
    const calls: string[] = [];
    const oauth = makeOAuth(async (url) => {
      const stringUrl = String(url);
      calls.push(stringUrl);
      return stringUrl.includes('/files?') ? jsonResponse({ files: [FILE_METADATA] }) : jsonResponse(FILE_METADATA);
    });
    const service = new GoogleDriveService(oauth);

    await expect(service.getFile('file-1')).resolves.toMatchObject({
      id: 'file-1',
      etag: '"etag-1"',
      size: 3,
      starred: true,
      description: 'Quarterly plan',
      createdTime: '2026-09-01T00:00:00Z',
      trashed: false,
      canDownload: true,
    });

    const list = await service.listFiles({ query: "name contains 'Plan'" });
    expect(list.files[0]).toMatchObject({ etag: '"etag-1"', size: 3, trashed: false });
    for (const field of ['etag', 'size', 'starred', 'description', 'createdTime', 'trashed']) {
      expect(calls[0], `getFile must project ${field}`).toContain(field);
      expect(calls[1], `listFiles must project ${field}`).toContain(field);
    }
  });

  it('reports an unparseable provider size as unknown instead of guessing', async () => {
    const oauth = makeOAuth(async () => jsonResponse({ ...FILE_METADATA, size: 'not-a-number' }));
    const summary = await new GoogleDriveService(oauth).getFile('file-1');
    expect(summary.size).toBeUndefined();
  });

  it('uses Drive list fields and pagination safely', async () => {
    const calls: string[] = [];
    const oauth = makeOAuth(async (url) => {
      const stringUrl = String(url);
      calls.push(stringUrl);
      return jsonResponse({
        files: [{ id: 'file-1', name: 'Plan', mimeType: 'text/plain', modifiedTime: '2026-09-04T00:00:00Z', parents: ['root'], capabilities: { canDownload: true } }],
        nextPageToken: 'next-2',
      });
    });
    const result = await new GoogleDriveService(oauth).listFiles({ query: "name contains 'Plan'", pageToken: 'next-1', pageSize: 500 });
    expect(result.files[0]).toMatchObject({ id: 'file-1', canDownload: true, parents: ['root'] });
    expect(result.nextPageToken).toBe('next-2');
    expect(calls[0]).toContain('pageSize=100');
    expect(calls[0]).toContain('pageToken=next-1');
    expect(calls[0]).toContain('spaces=drive');
  });

  it('excludes trashed files by default and only widens on explicit opt-in', async () => {
    const queries: Array<string | null> = [];
    const oauth = makeOAuth(async (url) => {
      queries.push(new URL(String(url)).searchParams.get('q'));
      return jsonResponse({ files: [] });
    });
    const service = new GoogleDriveService(oauth);

    await service.listFiles();
    await service.listFiles({ query: "name contains 'Plan'" });
    await service.listFiles({ query: "name contains 'Plan'", showTrashed: true });
    await service.listFiles({ query: "trashed = true" });
    await service.searchLibrary({ query: "fullText contains 'invoice'" });

    expect(queries[0]).toBe('trashed = false');
    expect(queries[1]).toBe("name contains 'Plan' and trashed = false");
    expect(queries[2]).toBe("name contains 'Plan'");
    expect(queries[3]).toBe('trashed = true');
    expect(queries[4]).toBe("fullText contains 'invoice' and trashed = false");
  });

  it('bounds free-form query and page-token parameters at the service boundary', () => {
    expect(driveQueryWithTrashBoundary('x'.repeat(DRIVE_LIMITS.maxQueryLength), false)).toHaveLength(DRIVE_LIMITS.maxQueryLength + ' and trashed = false'.length);
    expect(() => driveQueryWithTrashBoundary('x'.repeat(DRIVE_LIMITS.maxQueryLength + 1), false)).toThrow(/too long/);
  });

  it('rejects an oversized page token before any provider request', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ files: [] }));
    const oauth = makeOAuth(fetchSpy);
    await expect(new GoogleDriveService(oauth).listFiles({ pageToken: 'x'.repeat(DRIVE_LIMITS.maxPageTokenLength + 1) })).rejects.toThrow(/too long/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches metadata before downloading and refuses non-downloadable files', async () => {
    const calls: string[] = [];
    const oauth = makeOAuth(async (url) => {
      calls.push(String(url));
      return jsonResponse({ id: 'file-1', name: 'Locked', mimeType: 'application/pdf', capabilities: { canDownload: false } });
    });
    await expect(new GoogleDriveService(oauth).downloadFile('file-1')).rejects.toThrow('cannot be downloaded');
    expect(calls).toHaveLength(1);
  });

  it('refuses Google Docs editors files that need export instead of a media read', async () => {
    const calls: string[] = [];
    const oauth = makeOAuth(async (url) => {
      calls.push(String(url));
      return jsonResponse({ id: 'doc-1', name: 'Notes', mimeType: 'application/vnd.google-apps.document', capabilities: { canDownload: true } });
    });
    await expect(new GoogleDriveService(oauth).downloadFile('doc-1')).rejects.toThrow('cannot be downloaded directly');
    expect(calls).toHaveLength(1);
  });

  it('refuses a declared size beyond the transfer ceiling before the media read', async () => {
    const calls: string[] = [];
    const oauth = makeOAuth(async (url) => {
      calls.push(String(url));
      return jsonResponse({ ...FILE_METADATA, size: String(DRIVE_LIMITS.maxTransferBytes + 1) });
    });
    await expect(new GoogleDriveService(oauth).downloadFile('file-1')).rejects.toThrow('transfer limit');
    expect(calls).toHaveLength(1);
  });

  it('downloads bounded blob content through alt=media', async () => {
    const calls: string[] = [];
    const oauth = makeOAuth(async (url) => {
      const stringUrl = String(url);
      calls.push(stringUrl);
      if (stringUrl.includes('?fields=')) return jsonResponse(FILE_METADATA);
      return mediaResponse([65, 66, 67]);
    });
    const download = await new GoogleDriveService(oauth).downloadFile('file-1', { maxBytes: 10 });
    expect([...download.bytes]).toEqual([65, 66, 67]);
    expect(download.mimeType).toBe('text/plain');
    expect(download.size).toBe(3);
    expect(download.metadata).toMatchObject({ id: 'file-1', etag: '"etag-1"' });
    expect(calls[1]).toContain('alt=media');
  });

  it('refuses a media response whose declared content length exceeds the ceiling', async () => {
    const oauth = makeOAuth(async (url) => {
      const stringUrl = String(url);
      if (stringUrl.includes('?fields=')) return jsonResponse({ ...FILE_METADATA, size: undefined });
      return mediaResponse(Array.from({ length: 32 }, () => 65));
    });
    await expect(new GoogleDriveService(oauth).downloadFile('file-1', { maxBytes: 8 })).rejects.toThrow('transfer limit');
  });

  it('stops reading a chunked body the moment it crosses the ceiling', async () => {
    let cancelled = false;
    const oauth = makeOAuth(async (url) => {
      const stringUrl = String(url);
      if (stringUrl.includes('?fields=')) return jsonResponse({ ...FILE_METADATA, size: undefined });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // The provider keeps sending past the ceiling: the service must stop
          // reading instead of buffering the rest of the body.
          controller.enqueue(new Uint8Array(6));
          controller.enqueue(new Uint8Array(6));
          controller.enqueue(new Uint8Array(6));
        },
        cancel() { cancelled = true; },
      });
      // No declared length, so the ceiling can only be enforced by reading.
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/plain' } });
    });

    await expect(new GoogleDriveService(oauth).downloadFile('file-1', { maxBytes: 8 })).rejects.toThrow('transfer limit');
    expect(cancelled).toBe(true);
  });

  it('never starts a transfer for an already-aborted signal', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(FILE_METADATA));
    const oauth = makeOAuth(fetchSpy);
    const controller = new AbortController();
    controller.abort();
    await expect(new GoogleDriveService(oauth).downloadFile('file-1', { signal: controller.signal })).rejects.toThrow(/cancelled/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('exports Workspace content through files.export', async () => {
    const calls: string[] = [];
    const oauth = makeOAuth(async (url) => {
      const stringUrl = String(url);
      calls.push(stringUrl);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/pdf' } });
    });
    const content = await new GoogleDriveService(oauth).exportFile('doc-1', 'application/pdf');
    expect(content.mimeType).toBe('application/pdf');
    expect([...content.bytes]).toEqual([1, 2, 3]);
    expect(calls[0]).toContain('/files/doc-1/export?mimeType=application%2Fpdf');
  });

  it('keeps move operations on the Drive update endpoint', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const oauth = makeOAuth(async (url, init) => {
      calls.push({ url: String(url), method: init?.method });
      return jsonResponse({ id: 'file-1', name: 'Plan', mimeType: 'text/plain', parents: ['folder-2'] });
    });
    const service = new GoogleDriveService(oauth);
    const result = await service.moveFile('file-1', '"etag-1"', 'folder-2', 'folder-1');
    expect(result.parents).toEqual(['folder-2']);
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toContain('addParents=folder-2');
    expect(calls[0].url).toContain('removeParents=folder-1');

    // Omitting the previous parent keeps the existing one: Drive files may have
    // several parents, so this is an add rather than a move.
    await service.moveFile('file-1', '"etag-1"', 'folder-3');
    expect(calls[1].url).toContain('addParents=folder-3');
    expect(calls[1].url).not.toContain('removeParents');
  });

  it('never permanently deletes a file', async () => {
    const methods: string[] = [];
    const oauth = makeOAuth(async (url, init) => {
      methods.push(`${init?.method ?? 'GET'}:${String(url)}`);
      return jsonResponse(FILE_METADATA);
    });
    await new GoogleDriveService(oauth).trashFile('file-1', '"etag-1"');
    expect(methods.every((entry) => !entry.startsWith('DELETE'))).toBe(true);
  });

  it('keeps trashing out of the ordinary metadata update patch', async () => {
    const calls: string[] = [];
    const oauth = makeOAuth(async (url, init) => {
      calls.push(typeof init?.body === 'string' ? init.body : '');
      return jsonResponse(FILE_METADATA);
    });
    const service = new GoogleDriveService(oauth);
    // TypeScript already rejects `trashed` in this patch; this pins the runtime
    // body so a widened internal caller cannot smuggle it through.
    await service.updateFile('file-1', '"etag-1"', { name: 'Renamed', description: undefined, starred: true } as { name?: string; description?: string; starred?: boolean });
    expect(calls[0]).not.toContain('trashed');
  });

  it('does not leak file payloads into authorization arguments', async () => {
    const authorize = vi.fn(async (capability: Parameters<GoogleOAuthAuthority['authorize']>[0]) => ({
      capability,
      fetch: async () => jsonResponse({ id: 'file-1', name: 'Plan', mimeType: 'text/plain' }),
    }));
    const oauth: GoogleOAuthAuthority = { authorize, getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }), disconnect: async () => undefined };
    await new GoogleDriveService(oauth).getFile('file-1');
    expect(authorize).toHaveBeenCalledWith('drive.files.app.read');
  });
});
