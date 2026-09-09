import { GoogleGenAI } from '@google/genai';
import { DEFAULT_GEMINI_MODEL } from '../../../src/gemini/contracts';
import { normalizeGeminiError } from '../../../src/gemini/errors';
import { composeRoutineSystemInstruction } from '../../../src/autonomy/instruction';
import { parseRoutineOutcome } from '../../../src/autonomy/outcome';
import { cloudAdmitFromOutcome, type CloudAdmitResult } from '../../../src/autonomy/cloud-result';
import type { RoutineRunEnvelope } from '../../../src/autonomy/envelope';

export class CloudExecuteRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudExecuteRetryError';
  }
}

function formatFrozenContext(envelope: RoutineRunEnvelope): string {
  if (!envelope.routine.permissions.memory) return '';
  const records = envelope.context?.records ?? [];
  if (!records.length) return 'Autonomy Context is empty or unavailable for this run.';
  return records.map((record) => {
    const row = record as { id?: string; kind?: string; title?: string; body?: string };
    return `- [${row.kind ?? 'record'} ${row.id ?? ''}] ${row.title ?? ''}: ${String(row.body ?? '').slice(0, 800)}`;
  }).join('\n').slice(0, 12_000);
}

export async function completeCloudGeminiTurn(apiKey: string, systemInstruction: string, input: string): Promise<string> {
  const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1', retryOptions: { attempts: 1 } } });
  const interaction = await client.interactions.create({
    model: DEFAULT_GEMINI_MODEL,
    input,
    system_instruction: systemInstruction,
    stream: false,
    store: false,
    generation_config: { max_output_tokens: 2_048, thinking_summaries: 'none' },
  } as never);
  const text = typeof (interaction as { output_text?: unknown }).output_text === 'string'
    ? (interaction as { output_text: string }).output_text
    : '';
  return text.trim();
}

export type CloudExecuteEnv = {
  GEMINI_API_KEY?: string;
  C1_MODEL_STUB?: string;
};

/**
 * Bounded C1 model step. Throws CloudExecuteRetryError for transient Gemini
 * failures. Terminal business/config/parse failures return an error admit
 * payload (Workflow must not retry those).
 */
export async function executeCloudRoutine(
  envelope: RoutineRunEnvelope,
  env: CloudExecuteEnv,
  completeTurn: typeof completeCloudGeminiTurn = completeCloudGeminiTurn,
): Promise<CloudAdmitResult> {
  if (env.C1_MODEL_STUB) {
    if (env.C1_MODEL_STUB === 'retry') throw new CloudExecuteRetryError('C1 model stub requested retry.');
    if (env.C1_MODEL_STUB === 'malformed') {
      return { disposition: 'error', errorCode: 'OUTCOME_INVALID_CONTRACT', errorMessage: 'The routine result did not satisfy the structured outcome contract.' };
    }
    if (env.C1_MODEL_STUB === 'missing-key') {
      return { disposition: 'error', errorCode: 'GEMINI_UNAVAILABLE', errorMessage: 'Cloud routine execution is not configured (missing GEMINI_API_KEY).' };
    }
    try {
      return JSON.parse(env.C1_MODEL_STUB) as CloudAdmitResult;
    } catch {
      return { disposition: 'noop', reason: 'C1 model stub.' };
    }
  }

  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return { disposition: 'error', errorCode: 'GEMINI_UNAVAILABLE', errorMessage: 'Cloud routine execution is not configured (missing GEMINI_API_KEY).' };
  }

  const memoryContext = formatFrozenContext(envelope);
  const systemInstruction = composeRoutineSystemInstruction(envelope.routine, memoryContext);
  const input = `Execute the frozen routine "${envelope.routine.name}" now. Use only the frozen envelope. End with the JSON outcome object.`;
  try {
    const text = await completeTurn(apiKey, systemInstruction, input);
    const parsed = parseRoutineOutcome(text);
    if (!parsed.ok) {
      return { disposition: 'error', errorCode: `OUTCOME_${parsed.error}`, errorMessage: 'The routine result did not satisfy the structured outcome contract.' };
    }
    return cloudAdmitFromOutcome(parsed.outcome);
  } catch (cause) {
    if (cause instanceof CloudExecuteRetryError) throw cause;
    const normalized = normalizeGeminiError(cause);
    if (normalized.retryable) throw new CloudExecuteRetryError(normalized.message);
    return { disposition: 'error', errorCode: normalized.code, errorMessage: normalized.message.slice(0, 500) };
  }
}
