import { describe, expect, it, vi } from 'vitest';
import { GoogleDriveService } from './service';
import type { GoogleOAuthAuthority } from '../oauth/contracts';

function makeOAuth(handler: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>): GoogleOAuthAuthority {
  return {
    authorize: async (capability) => ({ capability, fetch: handler }),
    getStatus: async () => ({ state: 'connected', grantedCapabilities: [] }),
    disconnect: async () => undefined,
  };
}

describe('GoogleDriveService', () => {
  it('keeps read and write capabilities separate', async () => {
    const calls: string[] = [];
    const oauth = makeOAuth(async (url, init) => {
      calls.push(`${init?.method ?? 'GET'}:${String(url)}`);
      return new Response(JSON.stringify({ id: 'file-1', name: 'Plan', mimeType: 'text/plain' }), { status: 200 });
    });
    const service = new GoogleDriveService(oauth);
    await expect(service.getFile('file-1')).resolves.toMatchObject({ id: 'file-1' });
    await expect(service.updateFile('file-1', { name: 'Updated' })).resolves.toMatchObject({ name: 'Plan' });
    expect(calls[0]).toContain('/files/file-1?fields=');
    expect(calls[1]).toContain('PATCH:');
  });

  it('uses Drive list fields and pagination safely', async () => {
    const calls: string[] = [];
    const oauth = makeOAuth(async (url) => {
      const stringUrl = String(url);
      calls.push(stringUrl);
      return new Response(JSON.stringify({
        files: [{ id: 'file-1', name: 'Plan', mimeType: 'text/plain', modifiedTime: '2026-09-04T00:00:00Z', parents: ['root'], capabilities: { canDownload: true } }],
        nextPageToken: 'next-2',
      }), { status: 200 });
    });
    const result = await new GoogleDriveService(oauth).listFiles({ query: "name contains 'Plan'", pageToken: 'next-1', pageSize: 500 });
    expect(result.files[0]).toMatchObject({ id: 'file-1', canDownload: true, parents: ['root'] });
    expect(result.nextPageToken).toBe('next-2');
    expect(calls[0]).toContain('pageSize=100');
    expect(calls[0]).toContain('pageToken=next-1');
    expect(calls[0]).toContain('spaces=drive');
  });

  it('fetches metadata before downloading and refuses non-downloadable files', async () => {
    const calls: string[] = [];
    const oauth = makeOAuth(async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ id: 'file-1', name: 'Locked', mimeType: 'application/pdf', capabilities: { canDownload: false } }), { status: 200 });
    });
    await expect(new GoogleDriveService(oauth).downloadFile('file-1')).rejects.toThrow('cannot be downloaded');
    expect(calls).toHaveLength(1);
  });

  it('downloads bounded blob content through alt=media', async () => {
    const calls: string[] = [];
    const oauth = makeOAuth(async (url) => {
      const stringUrl = String(url);
      calls.push(stringUrl);
      if (stringUrl.includes('?fields=')) return new Response(JSON.stringify({ id: 'file-1', name: 'Text', mimeType: 'text/plain', capabilities: { canDownload: true } }), { status: 200 });
      return new Response(new Uint8Array([65, 66, 67]), { status: 200, headers: { 'content-type': 'text/plain', 'content-length': '3' } });
    });
    const content = await new GoogleDriveService(oauth).downloadFile('file-1', 10);
    expect([...content.bytes]).toEqual([65, 66, 67]);
    expect(content.mimeType).toBe('text/plain');
    expect(calls[1]).toContain('alt=media');
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
      return new Response(JSON.stringify({ id: 'file-1', name: 'Plan', mimeType: 'text/plain', parents: ['folder-2'] }), { status: 200 });
    });
    const result = await new GoogleDriveService(oauth).moveFile('file-1', 'folder-2', 'folder-1');
    expect(result.parents).toEqual(['folder-2']);
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toContain('addParents=folder-2');
    expect(calls[0].url).toContain('removeParents=folder-1');
  });

  it('does not leak file payloads into authorization arguments', async () => {
    const authorize = vi.fn(async (capability: Parameters<GoogleOAuthAuthority['authorize']>[0]) => ({
      capability,
      fetch: async () => new Response(JSON.stringify({ id: 'file-1', name: 'Plan', mimeType: 'text/plain' }), { status: 200 }),
    }));
    const oauth: GoogleOAuthAuthority = { authorize, getStatus: async () => ({ state: 'connected', grantedCapabilities: [] }), disconnect: async () => undefined };
    await new GoogleDriveService(oauth).getFile('file-1');
    expect(authorize).toHaveBeenCalledWith('drive.files.read');
  });
});
