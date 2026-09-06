import { GoogleGenAI } from '@google/genai';
import type { VttCapture } from './recording';
import { getGeminiApiKey } from '../persistence/gemini-api-key';

export const VTT_TRANSCRIPTION_TIMEOUT_MS = 30_000;

function canonicalAudioMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0].trim().toLowerCase();
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return globalThis.btoa(binary);
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
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new VttTranscriptionError('configuration', 'Gemini API key is not configured in the app Lockbox.');

  let timedOut = false;
  let abortListener: (() => void) | undefined;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;

  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const client = new GoogleGenAI({ apiKey });
    const operation = (async () => {
      const audioData = await blobToBase64(capture.blob);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const interaction = await client.interactions.create({
        model: 'gemini-3.5-transcribe',
        input: [{ type: 'audio', data: audioData, mime_type: mimeType }],
        generation_config: { transcription_config: { mode: 'smart', language_codes: [] } },
        store: false,
      });
      const transcript = typeof interaction.output_text === 'string' ? interaction.output_text.trim() : '';
      if (!transcript) throw new VttTranscriptionError('empty', 'No speech was detected.');
      return transcript;
    })();

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = globalThis.setTimeout(() => {
        timedOut = true;
        reject(new Error('VTT transcription timeout.'));
      }, VTT_TRANSCRIPTION_TIMEOUT_MS);
    });

    const callerAbort = new Promise<never>((_, reject) => {
      abortListener = () => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', abortListener, { once: true });
    });

    return await Promise.race([operation, timeout, callerAbort]);
  } catch (cause) {
    if (timedOut) throw new VttTranscriptionError('timeout', 'Voice transcription timed out.');
    if (cause instanceof VttTranscriptionError) throw cause;
    if (signal?.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) {
      throw new VttTranscriptionError('cancelled', 'Voice transcription was cancelled.');
    }
    throw new VttTranscriptionError('provider', cause instanceof Error ? cause.message : 'Voice transcription failed.');
  } finally {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
    if (abortListener) signal?.removeEventListener('abort', abortListener);
  }
}
