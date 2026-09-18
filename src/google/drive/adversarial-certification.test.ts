import { describe, expect, it, vi } from 'vitest';
import { DRIVE_LIMITS } from './limits';
import { DriveTransferError } from './errors';
import { GoogleDriveService, driveQueryWithTrashBoundary } from './service';
import { executeGoogleTool } from '../tools/executor';
import type { GoogleCapabilityKey, GoogleOAuthAuthority } from '../oauth/contracts';

type Transport = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function oauthFor(transport: Transport, capabilities: GoogleCapabilityKey[] = []): GoogleOAuthAuthority {
  return {
    authorize: async (capability) => ({ capability, fetch: transport }),
    getStatus: async () => ({ state: 'connected', grantedCapabilities: capabilities, enabledCapabilities: capabilities, grantedProviderScopes: [] }),
    disconnect: async () => undefined,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const FILE = {
  id: 'file-1',
  name: 'Plan',
  mimeType: 'text/plain',
  size: '3',
  etag: '"etag-1"',
  capabilities: { canDownload: true },
};

describe('Drive adversarial certification', () => {
  it('never lets a file name containing the word trashed suppress the trashed boundary', async () => {
    // A literal that mentions "trashed" is a name, not a predicate.
    expect(driveQueryWithTrashBoundary("name contains 'trashed notes'", false)).toBe("name contains 'trashed notes' and trashed = false");
    expect(driveQueryWithTrashBoundary('name = "trashed"', false)).toBe('name = "trashed" and trashed = false');
    // Malformed quoting fails safe: the boundary is kept rather than widened.
    expect(driveQueryWithTrashBoundary("name = 'unbalanced trashed", false)).toBe("name = 'unbalanced trashed and trashed = false");

    const urls: string[] = [];
    const service = new GoogleDriveService(oauthFor(async (url) => {
      urls.push(String(url));
      return jsonResponse({ files: [] });
    }));
    await service.listFiles({ query: "name contains 'trashed notes'" });
    expect(new URL(urls[0]).searchParams.get('q')).toBe("name contains 'trashed notes' and trashed = false");
  });

  it('honors one explicit trashed predicate without appending a contradictory clause', () => {
    for (const query of ['trashed = true', "name = 'x' or trashed = true"]) {
      const bounded = driveQueryWithTrashBoundary(query, false);
      expect(bounded).toBe(query);
      expect(bounded?.match(/trashed/gi)).toHaveLength(1);
    }
    expect(driveQueryWithTrashBoundary("name = 'x'", true)).toBe("name = 'x'");
  });

  it('cannot widen the transfer ceiling through an adversarial maxBytes', async () => {
    const mediaRequests: string[] = [];
    const service = new GoogleDriveService(oauthFor(async (url) => {
      const target = String(url);
      if (target.includes('alt=media')) {
        mediaRequests.push(target);
        return new Response(new Uint8Array([1, 2, 3]));
      }
      return jsonResponse({ ...FILE, size: String(DRIVE_LIMITS.maxTransferBytes + 1) });
    }));

    for (const maxBytes of [DRIVE_LIMITS.maxTransferBytes + 1, 2 ** 40, Number.POSITIVE_INFINITY, Number.NaN, -1, 0.5]) {
      await expect(service.downloadFile('file-1', { maxBytes })).rejects.toMatchObject({ code: 'DRIVE_FILE_TOO_LARGE' });
    }
    expect(mediaRequests).toEqual([]);
  });

  it('bounds every provider-supplied field that reaches a tool result', async () => {
    const service = new GoogleDriveService(oauthFor(async () => jsonResponse({
      ...FILE,
      name: 'n'.repeat(5_000),
      mimeType: 'text/'.repeat(500),
      description: 'd'.repeat(20_000),
      webViewLink: `https://drive.google.com/${'x'.repeat(9_000)}`,
      createdTime: 'c'.repeat(5_000),
      parents: Array.from({ length: 500 }, (_, index) => `parent-${index}`),
    })));

    const file = await service.getFile('file-1');
    expect(file.name).toHaveLength(DRIVE_LIMITS.maxNameLength);
    expect(file.description).toHaveLength(DRIVE_LIMITS.maxDescriptionLength);
    expect(file.createdTime).toHaveLength(DRIVE_LIMITS.maxProviderTextLength);
    expect(file.parents).toHaveLength(DRIVE_LIMITS.maxParents);
    // An implausible MIME type is classification authority, so it falls back to
    // the generic binary type; a link too long to present truthfully is dropped
    // rather than truncated into a broken URL the user could click.
    expect(file.mimeType).toBe('application/octet-stream');
    expect(file.webViewLink).toBeUndefined();
  });

  it('drops a non-HTTPS web-view link and keeps an ordinary one', async () => {
    const service = new GoogleDriveService(oauthFor(async () => jsonResponse({
      ...FILE,
      webViewLink: 'http://drive.google.com/file/d/file-1/view',
      mimeType: 'application/pdf',
      size: '3',
    })));
    const file = await service.getFile('file-1');
    expect(file.webViewLink).toBeUndefined();
    expect(file.mimeType).toBe('application/pdf');
  });

  it('refuses every invalid validator before authorization or a provider request', async () => {
    let authorized = 0;
    let fetched = 0;
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => {
        authorized += 1;
        return { capability, fetch: async () => { fetched += 1; return jsonResponse(FILE); } };
      },
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
      disconnect: async () => undefined,
    };
    const service = new GoogleDriveService(oauth);

    for (const attempt of [
      () => service.updateFile('file-1', 'W/"weak"', { name: 'Renamed' }),
      () => service.updateFile('file-1', '*', { name: 'Renamed' }),
      () => service.updateFile('file-1', 'etag-1', { name: 'Renamed' }),
      () => service.moveFile('file-1', 'W/"weak"', 'folder-2'),
      () => service.moveFile('file-1', '"etag-1" "etag-2"', 'folder-2'),
      () => service.trashFile('file-1', ''),
      () => service.trashFile('file-1', `"${'e'.repeat(DRIVE_LIMITS.maxEtagLength)}"`),
    ]) {
      // Either the concrete-validator rule or the length bound refuses it —
      // both are fail-closed at the service boundary, before any authority.
      await expect(attempt()).rejects.toThrow(/ETag/i);
    }
    expect(authorized).toBe(0);
    expect(fetched).toBe(0);
  });

  it('refuses a contradictory move before authorization or network access', async () => {
    let authorized = 0;
    let fetched = 0;
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => {
        authorized += 1;
        return { capability, fetch: async () => { fetched += 1; return jsonResponse(FILE); } };
      },
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
      disconnect: async () => undefined,
    };
    const service = new GoogleDriveService(oauth);

    await expect(service.moveFile('file-1', '"etag-1"', 'folder-9', ' folder-9 ')).rejects.toThrow(/same parent/i);
    expect(authorized).toBe(0);
    expect(fetched).toBe(0);
  });

  it('collapses duplicate parent ids into one parent list instead of duplicating a parent', async () => {
    const bodies: string[] = [];
    const service = new GoogleDriveService(oauthFor(async (_url, init) => {
      bodies.push(String(init?.body ?? ''));
      return jsonResponse(FILE);
    }));

    await service.createFile({ name: 'Report', parents: ['folder-1', ' folder-1 ', 'folder-2', 'folder-1'] });
    const body = JSON.parse(bodies[0]) as { parents?: readonly string[] };
    expect(body.parents).toEqual(['folder-1', 'folder-2']);
  });

  it('reports a media stream that dies mid-transfer as a typed transfer failure', async () => {
    const service = new GoogleDriveService(oauthFor(async (url) => {
      if (String(url).includes('alt=media')) {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.error(new Error('socket reset'));
          },
        }), { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      return jsonResponse(FILE);
    }));

    const failure = await service.downloadFile('file-1').catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(DriveTransferError);
    expect((failure as DriveTransferError).code).toBe('DRIVE_TRANSFER_FAILED');
  });

  it('cancels an unterminated stream the moment it crosses the ceiling', async () => {
    let cancelled = false;
    const chunk = new Uint8Array(1024 * 1024);
    const service = new GoogleDriveService(oauthFor(async (url) => {
      if (String(url).includes('alt=media')) {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(chunk);
            controller.enqueue(chunk);
            // No close(): an adversarial provider never terminates its body.
          },
          cancel() {
            cancelled = true;
          },
        }), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
      }
      return jsonResponse(FILE);
    }));

    await expect(service.downloadFile('file-1', { maxBytes: 1024 })).rejects.toMatchObject({ code: 'DRIVE_FILE_TOO_LARGE' });
    expect(cancelled).toBe(true);
  });

  it('keeps the sensitive library read and every Drive write behind their own capability', async () => {
    const handler = vi.fn(async () => ({}));

    // App-file consent never buys library search.
    const library = await executeGoogleTool(
      { tool: 'drive.searchLibrary', arguments: {} },
      { oauth: oauthFor(async () => jsonResponse({ files: [] }), ['drive.files.app.read']), handlers: { 'drive.searchLibrary': handler } },
    );
    expect(library).toMatchObject({ ok: false, code: 'AUTHORIZATION_REQUIRED', requiredCapability: 'drive.library.read' });
    expect(handler).not.toHaveBeenCalled();

    // Neither a broad nor a narrow read grant buys a write.
    for (const granted of [['drive.files.app.read'], ['drive.library.read']] as GoogleCapabilityKey[][]) {
      const write = await executeGoogleTool(
        { tool: 'drive.trashFile', arguments: { fileId: 'file-1', etag: '"etag-1"' } },
        { oauth: oauthFor(async () => jsonResponse(FILE), granted), handlers: { 'drive.trashFile': handler }, confirm: async () => true },
      );
      expect(write).toMatchObject({ ok: false, code: 'AUTHORIZATION_REQUIRED', requiredCapability: 'drive.files.app.write' });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('never executes a destructive Drive write after its approval window expires', async () => {
    const handler = vi.fn(async () => ({ id: 'file-1' }));
    const confirm = vi.fn(async () => true);
    let clock = 0;
    const now = () => new Date(clock++ === 0 ? '2026-09-04T06:00:00.000Z' : '2026-09-04T06:06:00.000Z');

    const result = await executeGoogleTool(
      { tool: 'drive.trashFile', arguments: { fileId: 'file-1', etag: '"etag-1"' } },
      { oauth: oauthFor(async () => jsonResponse(FILE), ['drive.files.app.write']), handlers: { 'drive.trashFile': handler }, confirm, now },
    );

    expect(confirm).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: false, code: 'USER_DECLINED', confirmation: { risk: 'destructive' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('cannot trash a file that changed after its ETag was read, and never deletes', async () => {
    const methods: string[] = [];
    let trashAttempts = 0;
    const service = new GoogleDriveService(oauthFor(async (_url, init) => {
      const method = init?.method ?? 'GET';
      methods.push(method);
      if (method === 'PATCH' && String(init?.body).includes('trashed')) {
        trashAttempts += 1;
        if (trashAttempts === 1) return jsonResponse({ error: 'precondition failed' }, 412);
        return jsonResponse({ ...FILE, trashed: true, etag: '"etag-2"' });
      }
      return jsonResponse({ ...FILE, etag: '"etag-2"' });
    }));

    // A stale validator from the earlier read is rejected, not silently retried.
    await expect(service.trashFile('file-1', '"etag-1"')).rejects.toThrow(/read the file again/i);

    // Re-reading and repeating the conditional write succeeds.
    const reread = await service.getFile('file-1');
    await expect(service.trashFile('file-1', reread.etag ?? '')).resolves.toMatchObject({ trashed: true });

    expect(methods).not.toContain('DELETE');
  });
});
