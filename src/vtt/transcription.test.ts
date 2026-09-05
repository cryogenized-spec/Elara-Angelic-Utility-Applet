import { afterEach, describe, expect, it, vi } from 'vitest';
import { transcribeVttCapture, VttTranscriptionError, VTT_TRANSCRIPTION_TIMEOUT_MS } from './transcription';
import type { VttCapture } from './recording';

const capture: VttCapture = {
  blob: new Blob(['audio'], { type: 'audio/webm;codecs=opus' }),
  mimeType: 'audio/webm;codecs=opus',
  durationMs: 800,
  selection: { start: 2, end: 2 },
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('VTT transcription client', () => {
  it('posts the capture to the Worker transcription boundary with a canonical MIME type', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ transcript: 'hello there' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(transcribeVttCapture(capture)).resolves.toBe('hello there');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://elara-gemini.cryogenized.workers.dev/api/transcribe',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: capture.blob }),
    );
  });

  it('returns a typed provider error from an unsuccessful Worker response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'provider', message: 'Transcription unavailable.' }), { status: 502, headers: { 'Content-Type': 'application/json' } }));
    await expect(transcribeVttCapture(capture)).rejects.toEqual(new VttTranscriptionError('provider', 'Transcription unavailable.'));
  });

  it('rejects an empty transcript response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ transcript: '   ' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(transcribeVttCapture(capture)).rejects.toEqual(new VttTranscriptionError('empty', 'No speech was detected.'));
  });

  it('preserves caller cancellation as AbortError instead of converting it to a timeout', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    await expect(transcribeVttCapture(capture, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('returns a typed timeout when the Worker does not respond in time', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));

    const request = transcribeVttCapture(capture);
    await vi.advanceTimersByTimeAsync(VTT_TRANSCRIPTION_TIMEOUT_MS);

    await expect(request).rejects.toEqual(new VttTranscriptionError('timeout', 'Voice transcription timed out.'));
  });
});
