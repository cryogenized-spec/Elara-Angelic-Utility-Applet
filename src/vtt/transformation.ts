import { DEFAULT_GEMINI_MODEL } from '../gemini/contracts';
import { geminiTurnPort } from '../gemini/provider';

export type VttTransformMode = 'raw' | 'polish' | 'roleplay';

export const VTT_TRANSFORM_SYSTEM_INSTRUCTION = [
  'You transform a voice transcript into a user-ready message for a chat composer.',
  'Return only the transformed message. No explanation, labels, quotation marks, or meta-commentary.',
  'Preserve the transcript meaning, factual details, names, sequence, intent, and requested specificity.',
  'Do not invent actions, facts, dialogue, emotions, motivations, settings, or details that are not present in the transcript.',
  '',
  'POLISH mode:',
  'Rewrite the transcript into a clear, straightforward message.',
  'Remove filler, verbal repetition, false starts, and needless runaround while preserving useful meaning.',
  'Do not aggressively summarize away important details or change the user’s intended tone.',
  '',
  'ROLEPLAY mode:',
  'Convert the transcript into concise roleplay action/narration suitable for a chat roleplay composer.',
  'Use third-person present-tense action beats inside asterisks, such as *walks up to her and smiles*.',
  'Preserve who acts, who is addressed, what happens, the sequence, and any explicit emotional intent.',
  'Do not add dialogue unless the transcript explicitly contains dialogue that should remain spoken.',
].join('\n');

export function buildVttTransformInput(transcript: string, mode: Exclude<VttTransformMode, 'raw'>): string {
  return `Mode: ${mode.toUpperCase()}\n\nTranscript:\n${transcript.trim()}`;
}

export async function transformVttTranscript(
  transcript: string,
  mode: VttTransformMode,
  options?: { model?: string; signal?: AbortSignal },
): Promise<string> {
  const cleaned = transcript.trim();
  if (!cleaned) throw new Error('Cannot transform an empty transcript.');
  if (mode === 'raw') return cleaned;

  let output = '';
  for await (const event of geminiTurnPort.streamReply({
    model: options?.model || DEFAULT_GEMINI_MODEL,
    input: buildVttTransformInput(cleaned, mode),
    systemInstruction: VTT_TRANSFORM_SYSTEM_INSTRUCTION,
    generationConfig: { maxOutputTokens: 500 },
  }, options?.signal)) {
    if (event.type === 'text-delta') output += event.text;
    else if (event.type === 'completed') break;
    else if (event.type === 'cancelled') throw new DOMException('The VTT transformation was cancelled.', 'AbortError');
    else if (event.type === 'failed') throw new Error(event.error.message);
  }

  const transformed = output.trim();
  if (!transformed) throw new Error('The VTT transformation returned no text.');
  return transformed;
}
