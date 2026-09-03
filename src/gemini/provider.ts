import { GoogleGenAI, type SafetySetting } from '@google/genai';
import { getGeminiApiKey } from '../security/lockbox';
import { DEFAULT_GEMINI_MODEL, type GeminiStreamEvent, type GeminiTurnPort, type GeminiTurnRequest, type GeminiUsage } from './contracts';
import { normalizeGeminiError } from './errors';
import { ELARA_SYSTEM_INSTRUCTION } from './creative-context';

const SAFETY_SETTINGS: SafetySetting[] = [
  { category: 'harassment', threshold: 'block_none' },
  { category: 'hate_speech', threshold: 'block_none' },
  { category: 'sexually_explicit', threshold: 'block_none' },
  { category: 'dangerous_content', threshold: 'block_none' },
];

function asRecord(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}; }
function readString(record: Record<string, unknown>, key: string): string | undefined { const value = record[key]; return typeof value === 'string' && value.length > 0 ? value : undefined; }
function readNumber(record: Record<string, unknown>, key: string): number | undefined { const value = record[key]; return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }

function readUsage(raw: unknown): GeminiUsage | undefined {
  const usage = asRecord(raw);
  const inputTokens = readNumber(usage, 'input_tokens') ?? readNumber(usage, 'prompt_tokens') ?? readNumber(usage, 'prompt_token_count') ?? readNumber(usage, 'total_input_tokens');
  const outputTokens = readNumber(usage, 'output_tokens') ?? readNumber(usage, 'completion_tokens') ?? readNumber(usage, 'candidates_token_count') ?? readNumber(usage, 'total_output_tokens');
  const cachedTokens = readNumber(usage, 'cached_tokens') ?? readNumber(usage, 'cached_content_token_count');
  const thoughtsTokens = readNumber(usage, 'thoughts_tokens') ?? readNumber(usage, 'total_thought_tokens');
  const totalTokens = readNumber(usage, 'total_tokens') ?? readNumber(usage, 'total_token_count');
  if ([inputTokens, outputTokens, cachedTokens, thoughtsTokens, totalTokens].every((value) => value === undefined)) return undefined;
  return { inputTokens, outputTokens, cachedTokens, thoughtsTokens, totalTokens };
}

function interactionIdFrom(event: Record<string, unknown>): string | undefined {
  return readString(event, 'interaction_id') ?? readString(event, 'interactionId') ?? readString(asRecord(event.interaction), 'id');
}
function stepIndex(event: Record<string, unknown>): number { return readNumber(event, 'index') ?? readNumber(asRecord(event.step), 'index') ?? 0; }
function stepType(event: Record<string, unknown>): string { return readString(asRecord(event.step), 'type') ?? readString(event, 'step_type') ?? 'other'; }

function buildGenerationConfig(request: GeminiTurnRequest) {
  const config = request.generationConfig;
  if (!config) return undefined;
  const generationConfig: Record<string, unknown> = {};
  if (config.thinkingLevel) generationConfig.thinking_level = config.thinkingLevel;
  if (config.thinkingSummaries) generationConfig.thinking_summaries = config.thinkingSummaries;
  if (config.maxOutputTokens !== undefined) generationConfig.max_output_tokens = config.maxOutputTokens;
  if (config.seed !== undefined) generationConfig.seed = config.seed;
  if (config.stopSequences?.length) generationConfig.stop_sequences = config.stopSequences;
  return Object.keys(generationConfig).length > 0 ? generationConfig : undefined;
}

export const geminiTurnPort: GeminiTurnPort = {
  async *streamReply(request: GeminiTurnRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> {
    const startedAt = performance.now();
    const requestId = crypto.randomUUID();
    let interactionId: string | undefined;
    if (signal?.aborted) { yield { type: 'cancelled' }; return; }

    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      const error = normalizeGeminiError(new Error('No Gemini API key is configured. Add your key in Settings → API Lockbox.'), { requestId });
      yield { type: 'failed', error }; return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey, apiVersion: 'v1' });
      const stream = await ai.interactions.create({
        model: request.model || DEFAULT_GEMINI_MODEL,
        input: request.input,
        system_instruction: ELARA_SYSTEM_INSTRUCTION,
        previous_interaction_id: request.previousInteractionId,
        generation_config: buildGenerationConfig(request),
        stream: true,
        store: true,
        safety_settings: SAFETY_SETTINGS,
      });

      for await (const rawEvent of stream) {
        if (signal?.aborted) { yield { type: 'cancelled', interactionId }; return; }
        const event = asRecord(rawEvent);
        const eventType = readString(event, 'event_type') ?? readString(event, 'type') ?? '';
        const eventInteractionId = interactionIdFrom(event);
        if (eventInteractionId) interactionId = eventInteractionId;

        if (eventType === 'interaction.created') {
          const model = readString(asRecord(event.interaction), 'model') ?? request.model || DEFAULT_GEMINI_MODEL;
          yield { type: 'interaction-created', interactionId: interactionId ?? 'unknown', model }; continue;
        }
        if (eventType === 'interaction.in_progress' || eventType === 'interaction.status_update' || eventType === 'interaction.status' || eventType === 'interaction.updated' || eventType === 'interaction.requires_action') {
          const status = readString(event, 'status') ?? readString(asRecord(event.interaction), 'status') ?? (eventType.replace('interaction.', '') || 'in_progress');
          if (interactionId) yield { type: 'interaction-status', interactionId, status }; continue;
        }
        if (eventType === 'step.start') {
          const index = stepIndex(event);
          yield { type: 'step-start', index, stepType: stepType(event) };
          const step = asRecord(event.step);
          const summaryParts = Array.isArray(step.summary) ? step.summary : [];
          for (const summary of summaryParts) { const text = readString(asRecord(summary), 'text'); if (text) yield { type: 'thought-summary-delta', index, text }; }
          const signature = readString(step, 'signature');
          if (signature) yield { type: 'thought-signature', index, signature };
          continue;
        }
        if (eventType === 'step.delta') {
          const delta = asRecord(event.delta); const index = stepIndex(event); const deltaType = readString(delta, 'type'); const deltaText = readString(delta, 'text');
          if (deltaType === 'thought_signature') { const signature = readString(delta, 'signature'); if (signature) yield { type: 'thought-signature', index, signature }; continue; }
          if (deltaType === 'thought_summary') { if (deltaText) yield { type: 'thought-summary-delta', index, text: deltaText }; continue; }
          if (deltaType === 'text') { if (deltaText) yield { type: 'text-delta', index, text: deltaText }; continue; }
          if (deltaText) yield { type: 'text-delta', index, text: deltaText };
          continue;
        }
        if (eventType === 'step.stop') { yield { type: 'step-stop', index: stepIndex(event) }; continue; }
        if (eventType === 'interaction.completed') {
          const interaction = asRecord(event.interaction);
          interactionId = readString(interaction, 'id') ?? interactionId;
          const status = readString(interaction, 'status') ?? 'completed';
          yield { type: 'completed', interactionId: interactionId ?? 'unknown', status, durationMs: Math.max(1, Math.round(performance.now() - startedAt)), usage: readUsage(interaction.usage) ?? readUsage(event.usage) };
          return;
        }
        if (eventType === 'error') {
          const providerError = asRecord(event.error);
          const message = readString(providerError, 'message') ?? 'Gemini returned a streaming error.';
          const normalized = normalizeGeminiError(new Error(message), { requestId, interactionId, durationMs: Math.max(1, Math.round(performance.now() - startedAt)) });
          yield { type: 'failed', error: normalized };
          return;
        }
      }

      const error = normalizeGeminiError(new Error('Gemini stream ended without an explicit interaction.completed event.'), { requestId, interactionId, durationMs: Math.max(1, Math.round(performance.now() - startedAt)) });
      yield { type: 'failed', error };
    } catch (cause) {
      const error = normalizeGeminiError(cause, { requestId, interactionId, durationMs: Math.max(1, Math.round(performance.now() - startedAt)) });
      if (error.cancelled || signal?.aborted) { yield { type: 'cancelled', interactionId }; return; }
      yield { type: 'failed', error };
    }
  },
};
