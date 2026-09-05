import { GoogleGenAI } from '@google/genai';
import type { VttCapture } from './recording';
import { getGeminiApiKey } from '../persistence/gemini-api-key';

export const VTT_TRANSCRIPTION_TIMEOUT_MS = 30_000;

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
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new VttTranscriptionError('configuration', 'Gemini API key is not configured in the app Lockbox.');

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, VTT_TRANSCRIPTION_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort(signal?.reason);

  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    if (controller.signal.aborted) throw new VttTranscriptionError('cancelled', 'Voice transcription was cancelled.');
    const client = new GoogleGenAI({ apiKey });
    const uploaded = await client.files.upload({
      file: capture.blob,
      config: { mimeType },
    });
    if (!uploaded.uri || !uploaded.mimeType) throw new VttTranscriptionError('provider', 'Gemini did not return a usable uploaded audio file.');

    const interaction = await client.interactions.create({
      model: 'gemini-3.5-transcribe',
      input: [{ type: 'audio', uri: uploaded.uri, mime_type: uploaded.mimeType }],
      generation_config: { transcription_config: { mode: 'smart', language_codes: [] } },
      store: false,
    });
    const transcript = typeof interaction.output_text === 'string' ? interaction.output_text.trim() : '';
    if (!transcript) throw new VttTranscriptionError('empty', 'No speech was detected.');
    return transcript;
  } catch (cause) {
    if (timedOut) throw new VttTranscriptionError('timeout', 'Voice transcription timed out.');
    if (cause instanceof VttTranscriptionError) throw cause;
    if (signal?.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) throw new VttTranscriptionError('cancelled', 'Voice transcription was cancelled.');
    throw new VttTranscriptionError('provider', cause instanceof Error ? cause.message : 'Voice transcription failed.');
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
