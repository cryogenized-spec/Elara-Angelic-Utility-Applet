import type { VttCapture } from './recording';

const WORKER_URL = (import.meta.env.VITE_GEMINI_WORKER_URL ?? 'https://elara-gemini.cryogenized.workers.dev').replace(/\/$/, '');

function canonicalAudioMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0].trim().toLowerCase();
}

export class VttTranscriptionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'VttTranscriptionError';
    this.code = code;
  }
}

export async function transcribeVttCapture(capture: VttCapture, signal?: AbortSignal): Promise<string> {
  const mimeType = canonicalAudioMimeType(capture.mimeType);
  const response = await fetch(`${WORKER_URL}/api/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': mimeType },
    body: capture.blob,
    signal,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const code = typeof record.code === 'string' ? record.code : 'provider';
    const message = typeof record.message === 'string' ? record.message : 'Voice transcription failed.';
    throw new VttTranscriptionError(code, message);
  }

  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const transcript = typeof record.transcript === 'string' ? record.transcript.trim() : '';
  if (!transcript) throw new VttTranscriptionError('empty', 'No speech was detected.');
  return transcript;
}
