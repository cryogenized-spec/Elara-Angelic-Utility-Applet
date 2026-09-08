import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { compilePdf } = vi.hoisted(() => ({ compilePdf: vi.fn() }));
vi.mock('./compiler', () => ({ compilePdf, validateLatexSource: (source: string) => source }));

import { artifactRepository } from '../artifacts/repository';
import { db } from '../persistence/conversation';
import { documentToolHandlers } from './tool-handler';

const handler = documentToolHandlers['document.create_pdf']!;

describe('document artifact lifecycle', () => {
  beforeEach(async () => { compilePdf.mockReset(); await db.artifactMetadata.clear(); await db.artifactBlobs.clear(); });
  it('fails rather than publishing ready when compilation succeeds after generation supersession', async () => {
    let active = true;
    let release!: (value: { pdf: Blob; compilationLog: string }) => void;
    compilePdf.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const pending = handler({ tool: 'document.create_pdf', descriptor: {} as never, capability: 'documents.local', risk: 'read', arguments: { source: 'A late document' }, generationId: 'generation-a', isGenerationActive: () => active });
    await vi.waitFor(() => expect(compilePdf).toHaveBeenCalledOnce());
    active = false;
    release({ pdf: new Blob(['late'], { type: 'application/pdf' }), compilationLog: 'late' });
    const result = await pending;
    expect(result).toMatchObject({ status: 'failed', errorCode: 'DOCUMENT_COMPILATION_FAILED' });
    expect((await artifactRepository.list())[0]).toMatchObject({ status: 'failed' });
  });
  it('maps cancellation to failed without allowing a late result to resurrect the artifact', async () => {
    const controller = new AbortController();
    let release!: (value: { pdf: Blob; compilationLog: string }) => void;
    compilePdf.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const pending = handler({ tool: 'document.create_pdf', descriptor: {} as never, capability: 'documents.local', risk: 'read', arguments: { source: 'A cancelled document' }, signal: controller.signal, generationId: 'generation-b', isGenerationActive: () => !controller.signal.aborted });
    await vi.waitFor(() => expect(compilePdf).toHaveBeenCalledOnce());
    controller.abort();
    release({ pdf: new Blob(['late'], { type: 'application/pdf' }), compilationLog: 'late' });
    const result = await pending;
    expect(result).toMatchObject({ status: 'failed' });
    expect((await artifactRepository.list())[0]).toMatchObject({ status: 'failed' });
  });
});
