import { GoogleGenAI } from '@google/genai';
import { getGeminiApiKey } from '../security/lockbox';
import { DEFAULT_GEMINI_MODEL, type GeminiStreamEvent, type GeminiTurnPort, type GeminiTurnRequest, type GeminiUsage } from './contracts';
import { normalizeGeminiError } from './errors';
import { ELARA_SYSTEM_INSTRUCTION } from './creative-context';

const SAFETY_SETTINGS = [
  { category: 'harassment', threshold: 'block_none' },
  { category: 'hate_speech', threshold: 'block_none' },
  { category: 'sexually_explicit', threshold: 'block_none' },
  { category: 'dangerous_content', threshold: 'block_none' },
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readUsage(raw: unknown): GeminiUsage | undefined {
  const usage = asRecord(raw);
  const inputTokens = readNumber(usage, 'input_tokens') ?? readNumber(usage, 'prompt_token_count');
  const outputTokens = readNumber(usage, 'output_tokens') ?? readNumber(usage, 'candidates_token_count');
  const cachedTokens = readNumber(usage, 'cached_tokens') ?? readNumber(usage, 'cached_content_token_count');
  const thoughtsTokens = readNumber(usage, 'thoughts_tokens');
  const totalTokens = readNumber(usage, 'total_tokens') ?? readNumber(usage, 'total_token_count');
  if ([inputTokens, outputTokens, cachedTokens, thoughtsTokens, totalTokens].every((value) => value === undefined)) return undefined;
  return { inputTokens, outputTokens, cachedTokens, thoughtsTokens, totalTokens };
}

function stepIndex(event: Record<string, unknown>): number {
  return readNumber(event, 'index') ?? readNumber(asRecord(event.step), 'index') ?? 0;
}

function stepType(event: Record<string, unknown>): string {
  return readString(asRecord(event.step), 'type') ?? readString(event, 'step_type') ?? 'other';
}

export const geminiTurnPort: GeminiTurnPort = {
  async *streamReply(request: GeminiTurnRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> {
    const startedAt = performance.now();
    const requestId = crypto.randomUUID();
    let interactionId: string | undefined;

    if (signal?.aborted) {
      yield { type: 'cancelled' };
      return;
    }

    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      const error = normalizeGeminiError(new Error('No Gemini API key is configured. Add your key in Settings → API Lockbox.'), { requestId });
      yield { type: 'failed', error };
      return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey, apiVersion: 'v1' });
      const stream = await ai.interactions.create({
        model: request.model ?? DEFAULT_GEMINI_MODEL,
        input: request.input,
        system_instruction: ELARA_SYSTEM_INSTRUCTION,
        previous_interaction_id: request.previousInteractionId,
        stream: true,
        store: true,
        safety_settings: SAFETY_SETTINGS,
      });

      for await (const rawEvent of stream) {
        if (signal?.aborted) {
          yield { type: 'cancelled', interactionId };
          return;
        }

        const event = asRecord(rawEvent);
        const eventType = readString(event, 'event_type') ?? readString(event, 'type') ?? '';
        const eventInteractionId = readString(event, 'interaction_id') ?? readString(event, 'interactionId');
        if (eventInteractionId) interactionId = eventInteractionId;

        if (eventType === 'interaction.created') {
          yield { type: 'interaction-created', interactionId: interactionId ?? 'unknown', model: request.model ?? DEFAULT_GEMINI_MODEL };
          continue;
        }

        if (eventType === 'interaction.status' || eventType === 'interaction.updated') {
          const status = readString(event, 'status') ?? readString(asRecord(event.interaction), 'status') ?? 'in_progress';
          if (interactionId) yield { type: 'interaction-status', interactionId, status };
          continue;
        }

        if (eventType === 'step.start') {
          yield { type: 'step-start', index: stepIndex(event), stepType: stepType(event) };
          continue;
        }

        if (eventType === 'step.delta') {
          const delta = asRecord(event.delta);
          const index = stepIndex(event);
          const deltaText = readString(delta, 'text');
          if (deltaText) {
            const currentStepType = readString(delta, 'type') ?? stepType(event);
            if (currentStepType === 'thought' || currentStepType === 'thought_summary') yield { type: 'thought-summary-delta', index, text: deltaText };
            else yield { type: 'text-delta', index, text: deltaText };
          }
          continue;
        }

        if (eventType === 'step.stop') {
          yield { type: 'step-stop', index: stepIndex(event) };
          continue;
        }

        if (eventType === 'interaction.completed') {
          const interaction = asRecord(event.interaction);
          interactionId = readString(interaction, 'id') ?? interactionId;
          const status = readString(interaction, 'status') ?? 'completed';
          yield {
            type: 'completed',
            interactionId: interactionId ?? 'unknown',
            status,
            durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
            usage: readUsage(interaction.usage) ?? readUsage(event.usage),
          };
          return;
        }
      }

      const error = normalizeGeminiError(new Error('Gemini stream ended without an explicit interaction.completed event.'), {
        requestId,
        interactionId,
        durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
      });
      yield { type: 'failed', error };
    } catch (cause) {
      const error = normalizeGeminiError(cause, {
        requestId,
        interactionId,
        durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
      });
      if (error.cancelled || signal?.aborted) {
        yield { type: 'cancelled', interactionId };
        return;
      }
      yield { type: 'failed', error };
    }
  },
};
