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
});
