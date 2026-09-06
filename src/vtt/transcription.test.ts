import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getGeminiApiKey, createInteraction } = vi.hoisted(() => ({
  getGeminiApiKey: vi.fn(),
  createInteraction: vi.fn(),
}));

vi.mock('../persistence/gemini-api-key', () => ({ getGeminiApiKey }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
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
  createInteraction.mockResolvedValue({ output_text: 'hello there' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  getGeminiApiKey.mockReset();
  createInteraction.mockReset();
});

describe('VTT transcription client', () => {
  it('sends the capture to Gemini inline with a canonical MIME type', async () => {
    await expect(transcribeVttCapture(capture)).resolves.toBe('hello there');
    expect(createInteraction).toHaveBeenCalledWith({
      model: 'gemini-3.5-transcribe',
      input: [{ type: 'audio', data: expect.any(String), mime_type: 'audio/webm' }],
      generation_config: { transcription_config: { mode: 'smart', language_codes: [] } },
      store: false,
    });

    const audioData = createInteraction.mock.calls[0][0].input[0].data as string;
    expect(globalThis.atob(audioData)).toBe('audio');
  });

  it('returns a typed provider error from an unsuccessful Gemini request', async () => {
    createInteraction.mockRejectedValue(new Error('Transcription unavailable.'));
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
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('returns a typed timeout when Gemini does not respond in time', async () => {
    vi.useFakeTimers();
    createInteraction.mockImplementation(() => new Promise(() => {}));

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
    expect(createInteraction).not.toHaveBeenCalled();
  });
});
