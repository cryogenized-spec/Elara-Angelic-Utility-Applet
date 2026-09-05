import { DEFAULT_GEMINI_MODEL } from '../gemini/contracts';
import { geminiTurnPort } from '../gemini/provider';

export type VttTransformMode = 'raw' | 'polish' | 'roleplay';

function buildVttTransformInput(transcript: string, mode: Exclude<VttTransformMode, 'raw'>): string {
  const task = mode === 'polish'
    ? [
        'Transform the following voice transcript into a clear, straightforward message.',
        'Remove filler, verbal repetition, false starts, and needless runaround while preserving useful meaning.',
        'Do not aggressively summarize away important details or change the user’s intended tone.',
      ]
    : [
        'Transform the following voice transcript into concise roleplay action/narration suitable for the chat composer.',
        'Use third-person present-tense action beats inside asterisks when appropriate.',
        'Preserve who acts, who is addressed, what happens, the sequence, and explicit emotional intent.',
        'Do not add dialogue unless the transcript explicitly contains dialogue that should remain spoken.',
      ];

  return [
    'VOICE INPUT TRANSFORMATION TASK',
    ...task,
    'Return only the transformed message. No explanation, labels, quotation marks, or meta-commentary.',
    'Preserve factual details, names, sequence, intent, and requested specificity.',
    'Do not invent actions, facts, dialogue, emotions, motivations, settings, or details not present in the transcript.',
    '',
    'Transcript:',
    transcript.trim(),
  ].join('\n');
}

export async function transformVttTranscript(
  transcript: string,
  mode: VttTransformMode,
  options?: { model?: string; signal?: AbortSignal; systemInstruction?: string },
): Promise<string> {
  const cleaned = transcript.trim();
  if (!cleaned) throw new Error('Cannot transform an empty transcript.');
  if (mode === 'raw') return cleaned;

  let output = '';
  for await (const event of geminiTurnPort.streamReply({
    model: options?.model || DEFAULT_GEMINI_MODEL,
    input: buildVttTransformInput(cleaned, mode),
    systemInstruction: options?.systemInstruction,
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
