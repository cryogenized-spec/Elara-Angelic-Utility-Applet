import { describe, expect, it, vi } from 'vitest';
import { transcribeAudio, VTT_MAX_AUDIO_BYTES, type GeminiTranscriptionClient } from './transcription';

describe('Gemini VTT transcription adapter', () => {
  it('uses Gemini 3.5 Transcribe smart mode and deletes the uploaded audio', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: 'Hello there.' });
    const upload = vi.fn().mockResolvedValue({ name: 'files/vtt-test', uri: 'https://example.test/file', mimeType: 'audio/webm' });
    const remove = vi.fn().mockResolvedValue(undefined);
    const client: GeminiTranscriptionClient = { files: { upload, delete: remove }, interactions: { create } };

    await expect(transcribeAudio(client, new TextEncoder().encode('audio').buffer, 'audio/webm;codecs=opus')).resolves.toBe('Hello there.');
    expect(upload).toHaveBeenCalledWith({ file: expect.any(Blob), config: { mime_type: 'audio/webm' } });
    expect(create).toHaveBeenCalledWith({ model: 'gemini-3.5-transcribe', input: [{ type: 'audio', uri: 'https://example.test/file', mime_type: 'audio/webm' }], generation_config: { transcription_config: { mode: 'smart' } } });
    expect(remove).toHaveBeenCalledWith({ name: 'files/vtt-test' });
  });

  it('rejects unsupported formats and oversized audio before upload', async () => {
    const client = { files: { upload: vi.fn(), delete: vi.fn() }, interactions: { create: vi.fn() } } as unknown as GeminiTranscriptionClient;
    await expect(transcribeAudio(client, new ArrayBuffer(10), 'audio/mp3')).rejects.toThrow(/unsupported/i);
    await expect(transcribeAudio(client, new ArrayBuffer(VTT_MAX_AUDIO_BYTES + 1), 'audio/webm')).rejects.toThrow(/size limit/i);
    expect(client.files.upload).not.toHaveBeenCalled();
  });

  it('cleans up the uploaded file when transcription fails', async () => {
    const create = vi.fn().mockRejectedValue(new Error('provider failure'));
    const remove = vi.fn().mockResolvedValue(undefined);
    const client: GeminiTranscriptionClient = { files: { upload: vi.fn().mockResolvedValue({ name: 'files/vtt-test', uri: 'https://example.test/file' }), delete: remove }, interactions: { create } };
    await expect(transcribeAudio(client, new ArrayBuffer(10), 'audio/ogg')).rejects.toThrow('provider failure');
    expect(remove).toHaveBeenCalledWith({ name: 'files/vtt-test' });
  });
});
