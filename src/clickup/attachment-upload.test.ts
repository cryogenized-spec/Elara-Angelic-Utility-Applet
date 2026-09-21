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

import { uploadClickUpArtifact } from './attachment-upload';

describe('ClickUp browser artifact upload', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    artifactGet.mockReset();
    loadPairing.mockReset();
    resolvePairingToken.mockReset();
    loadPairing.mockReturnValue({ workerUrl: 'https://worker.example' });
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
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
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

    await expect(uploadClickUpArtifact({
      taskId: '86task',
      artifactId: 'artifact-1',
      filename: 'repair-note.txt',
    })).resolves.toEqual({
      provider: 'clickup',
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

    await uploadClickUpArtifact({ taskId: '86task', artifactId: 'artifact-generated' });
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

    await expect(uploadClickUpArtifact({ taskId: '86task', artifactId: 'artifact-1' })).rejects.toMatchObject({
      code: 'artifact-not-ready',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
