import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getGeminiApiKey, uploadFile, createInteraction } = vi.hoisted(() => ({
  getGeminiApiKey: vi.fn(),
  uploadFile: vi.fn(),
  createInteraction: vi.fn(),
}));

vi.mock('../persistence/gemini-api-key', () => ({ getGeminiApiKey }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    files = { upload: uploadFile };
    interactions = { create: createInteraction };
  },
}));

import { transcribeVttCapture, VttTranscriptionError, VTT_TRANSCRIPTION_TIMEOUT_MS } from './transcription';
import type { VttCapture } from './recording';

const capture: VttCapture = {
  blob: new Blob(['audio'], { type: 'audio/webm;codecs=opus' }),
  mimeType: 'audio/webm;codecs=opus',
  durationMs: 800,
  selection: { start: 2, end: 2 },
};

beforeEach(() => {
  getGeminiApiKey.mockResolvedValue('test-gemini-key');
  uploadFile.mockResolvedValue({ uri: 'files/audio-1', mimeType: 'audio/webm' });
  createInteraction.mockResolvedValue({ output_text: 'hello there' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  getGeminiApiKey.mockReset();
  uploadFile.mockReset();
  createInteraction.mockReset();
});

describe('VTT transcription client', () => {
  it('uploads the capture to Gemini with a canonical MIME type', async () => {
    await expect(transcribeVttCapture(capture)).resolves.toBe('hello there');
    expect(uploadFile).toHaveBeenCalledWith({
      file: capture.blob,
      config: { mimeType: 'audio/webm' },
    });
    expect(createInteraction).toHaveBeenCalledWith({
      model: 'gemini-3.5-transcribe',
      input: [{ type: 'audio', uri: 'files/audio-1', mime_type: 'audio/webm' }],
      generation_config: { transcription_config: { mode: 'smart', language_codes: [] } },
      store: false,
    });
  });

  it('returns a typed provider error from an unsuccessful Gemini request', async () => {
    uploadFile.mockRejectedValue(new Error('Transcription unavailable.'));
    await expect(transcribeVttCapture(capture)).rejects.toEqual(new VttTranscriptionError('provider', 'Transcription unavailable.'));
  });

  it('rejects an empty transcript response', async () => {
    createInteraction.mockResolvedValue({ output_text: '   ' });
    await expect(transcribeVttCapture(capture)).rejects.toEqual(new VttTranscriptionError('empty', 'No speech was detected.'));
  });

  it('preserves caller cancellation as a typed cancellation error', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(transcribeVttCapture(capture, controller.signal)).rejects.toEqual(
      new VttTranscriptionError('cancelled', 'Voice transcription was cancelled.'),
    );
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('returns a typed timeout when Gemini does not respond in time', async () => {
    vi.useFakeTimers();
    uploadFile.mockImplementation(() => new Promise(() => {}));

    const request = transcribeVttCapture(capture);
    const assertion = expect(request).rejects.toEqual(new VttTranscriptionError('timeout', 'Voice transcription timed out.'));
    await vi.advanceTimersByTimeAsync(VTT_TRANSCRIPTION_TIMEOUT_MS);
    await assertion;
  });

  it('reports configuration failure when the Lockbox is unavailable', async () => {
    getGeminiApiKey.mockResolvedValue('');
    await expect(transcribeVttCapture(capture)).rejects.toEqual(
      new VttTranscriptionError('configuration', 'Gemini API key is not configured in the app Lockbox.'),
    );
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
