import { describe, expect, it, vi } from 'vitest';
import { GoogleDriveService } from './service';
import type { GoogleOAuthAuthority } from '../oauth/contracts';

function makeOAuth(calls: string[]) : GoogleOAuthAuthority {
  return {
    authorize: async (capability) => ({
      capability,
      fetch: async (input, init) => {
        calls.push(`${capability}:${init?.method ?? 'GET'}:${String(input)}`);
        return new Response(JSON.stringify({
          id: 'file-1', name: 'Plan', mimeType: 'text/plain', modifiedTime: '2026-09-04T00:00:00Z', webViewLink: 'https://drive.google.com/file/d/file-1',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    }),
    getStatus: async () => ({ state: 'connected', grantedCapabilities: [] }),
    disconnect: async () => undefined,
  };
}

describe('GoogleDriveService', () => {
  it('keeps read and write capabilities separate', async () => {
    const calls: string[] = [];
    const service = new GoogleDriveService(makeOAuth(calls));
    await expect(service.getFile('file-1')).resolves.toMatchObject({ id: 'file-1' });
    await expect(service.updateFile('file-1', { name: 'Updated' })).resolves.toMatchObject({ name: 'Plan' });
    expect(calls.some((call) => call.startsWith('drive.files.read:'))).toBe(true);
    expect(calls.some((call) => call.startsWith('drive.files.write:'))).toBe(true);
  });

  it('rejects an empty update', async () => {
    const service = new GoogleDriveService(makeOAuth([]));
    await expect(service.updateFile('file-1', {})).rejects.toThrow('at least one field');
  });

  it('limits list page size to 100', async () => {
    const calls: string[] = [];
    const service = new GoogleDriveService(makeOAuth(calls));
    await service.listFiles({ pageSize: 999 });
    expect(calls[0]).toContain('pageSize=100');
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
