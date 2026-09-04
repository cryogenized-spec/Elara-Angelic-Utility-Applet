import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createInteraction, uploadFile, deleteFile } = vi.hoisted(() => ({
  createInteraction: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    interactions = { create: createInteraction };
    files = { upload: uploadFile, delete: deleteFile };
  },
}));

import worker from './index';

describe('VTT transcription Worker contract', () => {
  const env = {
    GEMINI_API_KEY: 'test-secret-key',
    ALLOWED_ORIGINS: 'https://cryogenized-spec.github.io',
  };

  beforeEach(() => {
    createInteraction.mockReset();
    uploadFile.mockReset();
    deleteFile.mockReset();
  });

  it('deletes a temporary Gemini File after successful transcription', async () => {
    uploadFile.mockResolvedValue({ name: 'files/vtt-test', uri: 'https://example.invalid/vtt-test', mimeType: 'audio/webm' });
    createInteraction.mockResolvedValue({ output_text: 'hello from voice' });

    const request = new Request('https://worker.example/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm', Origin: 'https://cryogenized-spec.github.io' },
      body: new Uint8Array(3_000),
    });

    await expect(worker.fetch(request, env)).resolves.toSatisfy(async (response: Response) => response.status === 200);
    await vi.waitFor(() => expect(deleteFile).toHaveBeenCalledWith({ name: 'files/vtt-test' }));
  });

  it('deletes a temporary Gemini File when transcription fails', async () => {
    uploadFile.mockResolvedValue({ name: 'files/vtt-failure', uri: 'https://example.invalid/vtt-failure', mimeType: 'audio/webm' });
    createInteraction.mockRejectedValue(new Error('upstream transcription failure'));

    const request = new Request('https://worker.example/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm', Origin: 'https://cryogenized-spec.github.io' },
      body: new Uint8Array(3_000),
    });

    const response = await worker.fetch(request, env);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      code: 'provider',
      message: 'The Gemini Worker could not complete the request.',
    });
    expect(JSON.stringify(await response.clone().text())).not.toContain('test-secret-key');
    await vi.waitFor(() => expect(deleteFile).toHaveBeenCalledWith({ name: 'files/vtt-failure' }));
  });

  it('rejects a VTT body that exceeds the hard byte limit after reading it', async () => {
    const oversized = new Uint8Array((2 * 1024 * 1024) + 1);
    const request = new Request('https://worker.example/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm', Origin: 'https://cryogenized-spec.github.io' },
      body: oversized,
    });

    const response = await worker.fetch(request, env);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      code: 'validation',
      message: 'VTT audio capture is too large.',
    });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(createInteraction).not.toHaveBeenCalled();
  });
});
