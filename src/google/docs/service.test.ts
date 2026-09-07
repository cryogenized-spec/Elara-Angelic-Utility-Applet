import { describe, expect, it } from 'vitest';
import { GoogleDocsService } from './service';
import type { GoogleOAuthAuthority } from '../oauth/contracts';

describe('GoogleDocsService', () => {
  it('keeps read access separate from document writes', async () => {
    const capabilities: string[] = [];
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => ({
        capability,
        fetch: async () => {
          capabilities.push(capability);
          return new Response(JSON.stringify({ documentId: 'doc-1', title: 'Plan', revisionId: 'rev-1' }), { status: 200 });
        },
      }),
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [] }),
      disconnect: async () => undefined,
    };

    const service = new GoogleDocsService(oauth);
    await expect(service.getDocument('doc-1')).resolves.toMatchObject({ documentId: 'doc-1' });
    await expect(service.batchUpdate('doc-1', [{ insertText: { location: { index: 1 }, text: 'x' } }])).resolves.toMatchObject({ documentId: 'doc-1' });
    expect(capabilities).toEqual(['docs.read', 'docs.write']);
  });

  it('rejects oversized document inputs before authorization', async () => {
    let authorizeCalls = 0;
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => {
        authorizeCalls += 1;
        return { capability, fetch: async () => new Response('{}', { status: 200 }) };
      },
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [] }),
      disconnect: async () => undefined,
    };
    const service = new GoogleDocsService(oauth);

    await expect(service.createDocument('x'.repeat(501))).rejects.toThrow('document title is too long');
    await expect(service.getDocument('x'.repeat(501))).rejects.toThrow('document ID is too long');
    await expect(service.batchUpdate('doc-1', [])).rejects.toThrow('at least one request');
    expect(authorizeCalls).toBe(0);
  });

  it('rejects oversized batch request counts before authorization', async () => {
    let authorizeCalls = 0;
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => {
        authorizeCalls += 1;
        return { capability, fetch: async () => new Response('{}', { status: 200 }) };
      },
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [] }),
      disconnect: async () => undefined,
    };
    const service = new GoogleDocsService(oauth);
    const requests = Array.from({ length: 101 }, () => ({ insertText: { location: { index: 1 }, text: 'x' } }));

    await expect(service.batchUpdate('doc-1', requests)).rejects.toThrow('limited to 100 requests');
    expect(authorizeCalls).toBe(0);
  });
});
