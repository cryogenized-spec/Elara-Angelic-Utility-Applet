import { GoogleGenAI } from '@google/genai';
import { DEFAULT_GEMINI_MODEL, type GeminiStreamEvent, type GeminiToolContinuationRequest, type GeminiTurnPort, type GeminiTurnRequest, type GeminiUsage } from './contracts';
import { normalizeGeminiError } from './errors';
import { getGeminiApiKey } from '../persistence/gemini-api-key';

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
function interactionIdFrom(event: Record<string, unknown>): string | undefined { return readString(event, 'interaction_id') ?? readString(event, 'interactionId') ?? readString(asRecord(event.interaction), 'id'); }
function stepIndex(event: Record<string, unknown>): number { return readNumber(event, 'index') ?? readNumber(asRecord(event.step), 'index') ?? 0; }
function stepType(event: Record<string, unknown>): string { return readString(asRecord(event.step), 'type') ?? readString(event, 'step_type') ?? 'other'; }

function buildInteractionPayload(request: { model: string; input: unknown; previousInteractionId?: string; generationConfig?: unknown; systemInstruction?: string; tools?: readonly string[] }, declarations: unknown[]) {
  const payload: Record<string, unknown> = {
    model: request.model || DEFAULT_GEMINI_MODEL,
    input: request.input,
    previous_interaction_id: request.previousInteractionId,
    generation_config: request.generationConfig,
    tools: declarations.length ? declarations : undefined,
    stream: true,
    store: true,
  };
  const systemInstruction = request.systemInstruction?.trim();
  if (systemInstruction) payload.system_instruction = systemInstruction;
  return payload;
}

async function* streamDirectRequest(request: { model: string; input: unknown; previousInteractionId?: string; generationConfig?: unknown; systemInstruction?: string; tools?: readonly string[] }, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();
  let interactionId: string | undefined;
  let sawTerminalEvent = false;
  let sawRequiresAction = false;
  if (signal?.aborted) { yield { type: 'cancelled' }; return; }

  try {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      const normalized = normalizeGeminiError(new Error('Gemini API key is not configured in the app Lockbox.'), { requestId });
      yield { type: 'failed', error: normalized };
      return;
    }
    if (signal?.aborted) { yield { type: 'cancelled' }; return; }

    const { googleGeminiFunctionDeclarations } = await import('../google/tools/gemini-declarations');
    const requestedTools = request.tools ?? [];
    const declarations = googleGeminiFunctionDeclarations.filter((tool) => requestedTools.includes(tool.name));
    const client = new GoogleGenAI({ apiKey });
    const stream = await client.interactions.create(buildInteractionPayload(request, declarations) as never);

    for await (const rawEvent of stream as AsyncIterable<unknown>) {
      if (signal?.aborted) { yield { type: 'cancelled', interactionId }; return; }
      const raw = asRecord(rawEvent);
      const eventType = readString(raw, 'event_type') ?? readString(raw, 'type') ?? '';
      const eventInteractionId = interactionIdFrom(raw);
      if (eventInteractionId) interactionId = eventInteractionId;

      if (eventType === 'interaction.created') {
        const interaction = asRecord(raw.interaction);
        const id = readString(interaction, 'id') ?? interactionId ?? 'unknown';
        interactionId = id;
        yield { type: 'interaction-created', interactionId: id, model: readString(interaction, 'model') ?? request.model || DEFAULT_GEMINI_MODEL };
        continue;
      }
      if (eventType === 'interaction.in_progress' || eventType === 'interaction.status_update' || eventType === 'interaction.status' || eventType === 'interaction.updated' || eventType === 'interaction.requires_action') {
        const status = readString(raw, 'status') ?? readString(asRecord(raw.interaction), 'status') ?? eventType.replace('interaction.', '');
        if (eventType === 'interaction.requires_action' || status === 'requires_action') sawRequiresAction = true;
        if (interactionId) yield { type: 'interaction-status', interactionId, status };
        continue;
      }
      if (eventType === 'step.start') {
        const index = stepIndex(raw);
        yield { type: 'step-start', index, stepType: stepType(raw) };
        const step = asRecord(raw.step);
        const summaryParts = Array.isArray(step.summary) ? step.summary : [];
        for (const summary of summaryParts) { const text = readString(asRecord(summary), 'text'); if (text) yield { type: 'thought-summary-delta', index, text }; }
        const signature = readString(step, 'signature');
        if (signature) yield { type: 'thought-signature', index, signature };
        if (stepType(raw) === 'function_call') {
          const callId = readString(step, 'id');
          const name = readString(step, 'name');
          const args = asRecord(step.arguments ?? step.args);
          if (callId && name && interactionId) {
            yield { type: 'tool-call', interactionId, index, callId, name, arguments: args };
            sawRequiresAction = true;
          }
        }
        continue;
      }
      if (eventType === 'tool-call') {
        const callId = readString(raw, 'call_id');
        const name = readString(raw, 'name');
        const args = asRecord(raw.arguments);
        if (callId && name && interactionId) yield { type: 'tool-call', interactionId, index: stepIndex(raw), callId, name, arguments: args };
        sawRequiresAction = true;
        continue;
      }
      if (eventType === 'step.delta') {
        const delta = asRecord(raw.delta);
        const index = stepIndex(raw);
        const deltaType = readString(delta, 'type');
        const deltaText = readString(delta, 'text');
        if (deltaType === 'thought_signature') { const signature = readString(delta, 'signature'); if (signature) yield { type: 'thought-signature', index, signature }; }
        else if (deltaType === 'thought_summary') { if (deltaText) yield { type: 'thought-summary-delta', index, text: deltaText }; }
        else if (deltaType === 'text' && deltaText) yield { type: 'text-delta', index, text: deltaText };
        continue;
      }
      if (eventType === 'step.stop') { yield { type: 'step-stop', index: stepIndex(raw) }; continue; }
      if (eventType === 'interaction.completed') {
        const interaction = asRecord(raw.interaction);
        interactionId = readString(interaction, 'id') ?? interactionId;
        const status = readString(interaction, 'status') ?? 'completed';
        sawTerminalEvent = true;
        yield { type: 'completed', interactionId: interactionId ?? 'unknown', status, durationMs: Math.max(1, Math.round(performance.now() - startedAt)), usage: readUsage(interaction.usage) ?? readUsage(raw.usage) };
        return;
      }
      if (eventType === 'error') {
        const providerError = asRecord(raw.error);
        const message = readString(providerError, 'message') ?? 'Gemini returned a streaming error.';
        sawTerminalEvent = true;
        const normalized = normalizeGeminiError(new Error(message), { requestId, interactionId, durationMs: Math.max(1, Math.round(performance.now() - startedAt)) });
        yield { type: 'failed', error: normalized };
        return;
      }
    }

    if (sawRequiresAction) return;
    if (sawTerminalEvent) return;
    const normalized = normalizeGeminiError(new Error('Gemini stream ended without an explicit interaction.completed event.'), { requestId, interactionId, durationMs: Math.max(1, Math.round(performance.now() - startedAt)) });
    yield { type: 'failed', error: normalized };
  } catch (cause) {
    const error = normalizeGeminiError(cause, { requestId, interactionId, durationMs: Math.max(1, Math.round(performance.now() - startedAt)) });
    if (error.cancelled || signal?.aborted) { yield { type: 'cancelled', interactionId }; return; }
    yield { type: 'failed', error };
  }
}

export const geminiTurnPort: GeminiTurnPort = {
  streamReply(request: GeminiTurnRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> {
    return streamDirectRequest({ model: request.model || DEFAULT_GEMINI_MODEL, input: request.input, previousInteractionId: request.previousInteractionId, generationConfig: request.generationConfig, systemInstruction: request.systemInstruction, tools: request.tools }, signal);
  },

  streamToolResult(request: GeminiToolContinuationRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> {
    return streamDirectRequest({
      model: request.model || DEFAULT_GEMINI_MODEL,
      input: [{ type: 'function_result', name: request.result.name, call_id: request.result.callId, result: [{ type: 'text', text: JSON.stringify(request.result.result) }] }],
      previousInteractionId: request.previousInteractionId,
      generationConfig: request.generationConfig,
      systemInstruction: request.systemInstruction,
      tools: request.tools,
    }, signal);
  },
};
