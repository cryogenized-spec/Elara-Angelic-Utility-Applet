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
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
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
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
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
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
      disconnect: async () => undefined,
    };
    const service = new GoogleDocsService(oauth);
    const requests = Array.from({ length: 101 }, () => ({ insertText: { location: { index: 1 }, text: 'x' } }));

    await expect(service.batchUpdate('doc-1', requests)).rejects.toThrow('limited to 100 requests');
    expect(authorizeCalls).toBe(0);
  });

  it('requests all tab content with inline suggestions and returns revision-aware tab projections', async () => {
    let requestedUrl = '';
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => ({
        capability,
        fetch: async (input) => {
          requestedUrl = String(input);
          return new Response(JSON.stringify({
            documentId: 'doc-1',
            title: 'Plan',
            revisionId: 'rev-7',
            tabs: [{
              tabProperties: { tabId: 'tab-root', title: 'Overview', index: 0, nestingLevel: 0 },
              documentTab: { body: { content: [{ startIndex: 1, endIndex: 7, paragraph: { paragraphStyle: { namedStyleType: 'HEADING_1' }, elements: [{ textRun: { content: 'Hello\\n' } }] } }] } },
              childTabs: [{
                tabProperties: { tabId: 'tab-child', title: 'Details', parentTabId: 'tab-root', index: 0, nestingLevel: 1 },
                documentTab: { body: { content: [{ startIndex: 1, endIndex: 5, paragraph: { elements: [{ textRun: { content: 'More\\n' } }] } }] } },
              }],
            }],
          }), { status: 200 });
        },
      }),
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
      disconnect: async () => undefined,
    };

    const service = new GoogleDocsService(oauth);
    await expect(service.inspectDocument('doc-1')).resolves.toMatchObject({
      documentId: 'doc-1',
      revisionId: 'rev-7',
      trust: 'untrusted-external',
      source: 'docs',
      tabs: [
        { tabId: 'tab-root', title: 'Overview', endIndex: 7 },
        { tabId: 'tab-child', title: 'Details', parentTabId: 'tab-root', endIndex: 5 },
      ],
    });
    expect(requestedUrl).toContain('includeTabsContent=true');
    expect(requestedUrl).toContain('suggestionsViewMode=SUGGESTIONS_INLINE');
  });

  it('guards semantic insert writes with both tab identity and required revision', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => ({
        capability,
        fetch: async (input, init) => {
          requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
          return new Response(JSON.stringify({ documentId: 'doc-1', writeControl: { requiredRevisionId: 'rev-2' } }), { status: 200 });
        },
      }),
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
      disconnect: async () => undefined,
    };

    const service = new GoogleDocsService(oauth);
    await service.insertText('doc-1', 'tab-2', 'rev-1', 4, 'Hello');

    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual({
      requests: [{ insertText: { location: { index: 4, tabId: 'tab-2' }, text: 'Hello' } }],
      writeControl: { requiredRevisionId: 'rev-1' },
    });
  });

  it('fails append before mutation when the inspected revision changed', async () => {
    let providerCalls = 0;
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => ({
        capability,
        fetch: async () => {
          providerCalls += 1;
          return new Response(JSON.stringify({
            documentId: 'doc-1',
            title: 'Plan',
            revisionId: 'rev-new',
            tabs: [{
              tabProperties: { tabId: 'tab-1', title: 'Body' },
              documentTab: { body: { content: [{ startIndex: 1, endIndex: 2, paragraph: { elements: [{ textRun: { content: '\\n' } }] } }] } },
            }],
          }), { status: 200 });
        },
      }),
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
      disconnect: async () => undefined,
    };

    const service = new GoogleDocsService(oauth);
    await expect(service.appendParagraph('doc-1', 'tab-1', 'rev-old', 'Hello')).rejects.toThrow(/changed since it was inspected/i);
    expect(providerCalls).toBe(1);
  });

  it('exports only fixed Docs formats through the bounded Drive export endpoint', async () => {
    let requestedUrl = '';
    const oauth: GoogleOAuthAuthority = {
      authorize: async (capability) => ({
        capability,
        fetch: async (input) => {
          requestedUrl = String(input);
          return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/pdf', 'content-length': '3' } });
        },
      }),
      getStatus: async () => ({ state: 'connected', grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
      disconnect: async () => undefined,
    };
    const service = new GoogleDocsService(oauth);
    await expect(service.exportDocument('doc-1', 'pdf')).resolves.toMatchObject({ format: 'pdf', mimeType: 'application/pdf', extension: '.pdf' });
    expect(requestedUrl).toContain('/drive/v3/files/doc-1/export?');
    expect(decodeURIComponent(requestedUrl)).toContain('mimeType=application/pdf');
  });
});
