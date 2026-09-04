export interface GeminiTranscriptionClient {
  files: {
    upload(params: { file: Blob; config: { mime_type: string } }): Promise<{ name?: string; uri?: string; mimeType?: string }>;
    delete(params: { name: string }): Promise<unknown>;
  };
  interactions: {
    create(params: {
      model: string;
      input: Array<{ type: 'audio'; uri: string; mime_type: string }>;
      generation_config: { transcription_config: { mode: 'smart' } };
    }): Promise<{ output_text?: string }>;
  };
}

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/opus', 'audio/wav']);

export async function transcribeAudio(client: GeminiTranscriptionClient, audio: ArrayBuffer, mimeType: string): Promise<string> {
  if (audio.byteLength === 0 || audio.byteLength > MAX_AUDIO_BYTES) throw new Error('Audio payload is empty or exceeds the VTT size limit.');
  const normalizedMimeType = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!SUPPORTED_MIME_TYPES.has(normalizedMimeType)) throw new Error('Unsupported VTT audio format.');

  const file = await client.files.upload({ file: new Blob([audio], { type: normalizedMimeType }), config: { mime_type: normalizedMimeType } });
  if (!file.uri || !file.name) throw new Error('Gemini did not return a usable transcription file.');
  try {
    const interaction = await client.interactions.create({
      model: 'gemini-3.5-transcribe',
      input: [{ type: 'audio', uri: file.uri, mime_type: normalizedMimeType }],
      generation_config: { transcription_config: { mode: 'smart' } },
    });
    const transcript = interaction.output_text?.trim() ?? '';
    if (!transcript) throw new Error('No speech was detected.');
    return transcript;
  } finally {
    await client.files.delete({ name: file.name }).catch(() => undefined);
  }
}

export const VTT_MAX_AUDIO_BYTES = MAX_AUDIO_BYTES;
