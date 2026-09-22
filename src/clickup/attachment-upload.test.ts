import { beforeEach, describe, expect, it, vi } from 'vitest';

const { artifactGet, loadPairing, resolvePairingToken } = vi.hoisted(() => ({
  artifactGet: vi.fn(),
  loadPairing: vi.fn(),
  resolvePairingToken: vi.fn(),
}));

vi.mock('../artifacts/repository', () => ({
  artifactRepository: { get: artifactGet },
}));

vi.mock('../autonomy/cloud/pairing', () => ({
  loadPairing,
  resolvePairingToken,
}));

import { CLICKUP_GRANT_REVISION_HEADER } from './mcp-protocol';
import { captureClickUpArtifactApprovalSnapshot } from './attachment-authority';
import { uploadClickUpArtifact } from './attachment-upload';

describe('ClickUp browser artifact upload', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    artifactGet.mockReset();
    loadPairing.mockReset();
    resolvePairingToken.mockReset();
    loadPairing.mockReturnValue({
      workerUrl: 'https://worker.example',
      installationId: 'test-installation',
    });
    resolvePairingToken.mockResolvedValue('installation-token');
  });

  it('resolves a local artifact by opaque id and sends only application-owned multipart bytes to the Worker', async () => {
    artifactGet.mockResolvedValue({
      id: 'artifact-1',
      artifactType: 'attachment',
      kind: 'text',
      provenance: 'user_upload',
      status: 'ready',
      name: 'repair.txt',
      mimeType: 'text/plain',
      size: 9,
      createdAt: 1,
      data: new Blob(['completed'], { type: 'text/plain' }),
    });

    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer installation-token');
      expect(headers.get(CLICKUP_GRANT_REVISION_HEADER)).toBe('123');
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get('workspaceId')).toBe('999');
      expect(form.get('taskId')).toBe('86task');
      expect(form.get('artifactId')).toBe('artifact-1');
      expect(form.get('filename')).toBe('repair-note.txt');
      const file = form.get('file') as File;
      expect(file.name).toBe('repair-note.txt');
      expect(await file.text()).toBe('completed');
      return new Response(JSON.stringify({
        ok: true,
        result: { provider: 'clickup', taskId: '86task', artifactId: 'artifact-1', attachmentId: '77' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const args = {
      workspaceId: '999',
      taskId: '86task',
      artifactId: 'artifact-1',
      filename: 'repair-note.txt',
    };
    const approvedArtifact = await captureClickUpArtifactApprovalSnapshot(args);

    await expect(uploadClickUpArtifact(args, undefined, {
      revision: 123,
      authorityBinding: 'https://worker.example#test-installation',
    }, approvedArtifact)).resolves.toEqual({
      provider: 'clickup',
      workspaceId: '999',
      taskId: '86task',
      artifactId: 'artifact-1',
      attachmentId: '77',
    });

    expect(artifactGet).toHaveBeenCalledWith('artifact-1');
  });

  it('can materialize a ready generated text artifact without exposing source text in the model arguments', async () => {
    artifactGet.mockResolvedValue({
      id: 'artifact-generated',
      artifactType: 'generated',
      provenance: 'generated_tool',
      status: 'ready',
      name: 'notes.md',
      mimeType: 'text/markdown',
      size: 14,
      createdAt: 1,
      sourceCode: { language: 'markdown', content: '# Repair notes' },
    });

    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      const file = form.get('file') as File;
      expect(await file.text()).toBe('# Repair notes');
      return new Response(JSON.stringify({
        ok: true,
        result: { provider: 'clickup', taskId: '86task', artifactId: 'artifact-generated' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const args = { workspaceId: '999', taskId: '86task', artifactId: 'artifact-generated' };
    const approvedArtifact = await captureClickUpArtifactApprovalSnapshot(args);
    await uploadClickUpArtifact(
      args,
      undefined,
      { revision: 123, authorityBinding: 'https://worker.example#test-installation' },
      approvedArtifact,
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('fails before network egress when the artifact is not ready', async () => {
    artifactGet.mockResolvedValue({
      id: 'artifact-1',
      artifactType: 'attachment',
      kind: 'text',
      provenance: 'user_upload',
      status: 'processing',
      name: 'repair.txt',
      mimeType: 'text/plain',
      size: 9,
      createdAt: 1,
      data: new Blob(['completed'], { type: 'text/plain' }),
    });
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(captureClickUpArtifactApprovalSnapshot({
      workspaceId: '999',
      taskId: '86task',
      artifactId: 'artifact-1',
    })).rejects.toMatchObject({
      code: 'artifact-not-ready',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects payload substitution under the same artifact id after approval and sends no bytes', async () => {
    artifactGet
      .mockResolvedValueOnce({
        id: 'artifact-1',
        artifactType: 'attachment',
        kind: 'text',
        provenance: 'user_upload',
        status: 'ready',
        name: 'repair.txt',
        mimeType: 'text/plain',
        size: 8,
        createdAt: 1,
        data: new Blob(['approved'], { type: 'text/plain' }),
      })
      .mockResolvedValueOnce({
        id: 'artifact-1',
        artifactType: 'attachment',
        kind: 'text',
        provenance: 'user_upload',
        status: 'ready',
        name: 'repair.txt',
        mimeType: 'text/plain',
        size: 8,
        createdAt: 1,
        data: new Blob(['replaced'], { type: 'text/plain' }),
      });

    const args = { workspaceId: '999', taskId: '86task', artifactId: 'artifact-1' };
    const approvedArtifact = await captureClickUpArtifactApprovalSnapshot(args);
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(uploadClickUpArtifact(
      args,
      undefined,
      { revision: 123, authorityBinding: 'https://worker.example#test-installation' },
      approvedArtifact,
    )).rejects.toMatchObject({
      code: 'artifact-changed',
      status: 409,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized chunked Worker response even without Content-Length', async () => {
    const artifact = {
      id: 'artifact-oversized-response',
      artifactType: 'attachment' as const,
      kind: 'text' as const,
      provenance: 'user_upload' as const,
      status: 'ready' as const,
      name: 'repair.txt',
      mimeType: 'text/plain',
      size: 8,
      createdAt: 1,
      data: new Blob(['approved'], { type: 'text/plain' }),
    };
    artifactGet.mockResolvedValue(artifact);

    const args = {
      workspaceId: '999',
      taskId: '86task',
      artifactId: 'artifact-oversized-response',
    };
    const approvedArtifact = await captureClickUpArtifactApprovalSnapshot(args);

    const encoder = new TextEncoder();
    globalThis.fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 6; index += 1) {
          controller.enqueue(encoder.encode('x'.repeat(50_000)));
        }
        controller.close();
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    await expect(uploadClickUpArtifact(
      args,
      undefined,
      { revision: 123, authorityBinding: 'https://worker.example#test-installation' },
      approvedArtifact,
    )).rejects.toMatchObject({
      code: 'response-too-large',
      status: 200,
    });
  });

  it('uploads the immutable approved Blob rather than a second mutable repository read', async () => {
    const approvedArtifactRecord = {
      id: 'artifact-1',
      artifactType: 'attachment' as const,
      kind: 'text' as const,
      provenance: 'user_upload' as const,
      status: 'ready' as const,
      name: 'repair.txt',
      mimeType: 'text/plain',
      size: 8,
      createdAt: 1,
      data: new Blob(['approved'], { type: 'text/plain' }),
    };
    artifactGet.mockResolvedValue(approvedArtifactRecord);

    const args = { workspaceId: '999', taskId: '86task', artifactId: 'artifact-1' };
    const approvedArtifact = await captureClickUpArtifactApprovalSnapshot(args);

    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      const file = form.get('file') as File;
      expect(await file.text()).toBe('approved');
      return new Response(JSON.stringify({
        ok: true,
        result: { provider: 'clickup', taskId: '86task', artifactId: 'artifact-1' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    await uploadClickUpArtifact(
      args,
      undefined,
      { revision: 123, authorityBinding: 'https://worker.example#test-installation' },
      approvedArtifact,
    );
  });
});
