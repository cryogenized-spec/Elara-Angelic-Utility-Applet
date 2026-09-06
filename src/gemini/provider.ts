import { GoogleGenAI } from '@google/genai';
import { DEFAULT_GEMINI_MODEL, type GeminiStreamEvent, type GeminiToolContinuationRequest, type GeminiTurnPort, type GeminiTurnRequest, type GeminiUsage } from './contracts';
import { normalizeGeminiError } from './errors';
import { getGeminiApiKey } from '../persistence/gemini-api-key';
import { googleGeminiFunctionDeclarations } from '../google/tools/gemini-declarations';
import { appendMemoryContext, loadMemoryContext } from './memory-context';

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
function appendThoughtSummary(parts: Map<number, string>, index: number, text: string): void { parts.set(index, `${parts.get(index) ?? ''}${text}`); }
function thoughtSummaryFrom(parts: Map<number, string>): string | undefined {
  const summary = [...parts.entries()].sort(([left], [right]) => left - right).map(([, text]) => text.trim()).filter(Boolean).join('\n\n').trim();
  return summary || undefined;
}

export async function safeLoadMemoryContext(query: string): Promise<string> {
  try {
    return await loadMemoryContext(query);
  } catch {
    return '';
  }
}

type PendingFunctionCall = { callId: string; name: string; arguments: string };
type InteractionRequest = { model: string; input: unknown; previousInteractionId?: string; generationConfig?: unknown; systemInstruction?: string; tools?: readonly string[] };

export function toGeminiGenerationConfig(value: unknown): Record<string, unknown> | undefined {
  const source = asRecord(value);
  const generationConfig: Record<string, unknown> = {};
  const thinkingLevel = typeof source.thinkingLevel === 'string' ? source.thinkingLevel : typeof source.thinking_level === 'string' ? source.thinking_level : undefined;
  if (thinkingLevel) generationConfig.thinking_level = thinkingLevel;
  const thinkingSummaries = typeof source.thinkingSummaries === 'string' ? source.thinkingSummaries : typeof source.thinking_summaries === 'string' ? source.thinking_summaries : undefined;
  if (thinkingSummaries === 'auto' || thinkingSummaries === 'none') generationConfig.thinking_summaries = thinkingSummaries;
  const maxOutputTokens = readNumber(source, 'maxOutputTokens') ?? readNumber(source, 'max_output_tokens');
  if (maxOutputTokens !== undefined && Number.isInteger(maxOutputTokens) && maxOutputTokens > 0) generationConfig.max_output_tokens = maxOutputTokens;
  const seed = readNumber(source, 'seed');
  if (seed !== undefined && Number.isInteger(seed) && seed >= 0) generationConfig.seed = seed;
  const stopSequences = Array.isArray(source.stopSequences) ? source.stopSequences : Array.isArray(source.stop_sequences) ? source.stop_sequences : undefined;
  if (stopSequences) {
    const normalized = stopSequences.filter((item): item is string => typeof item === 'string' && item.length > 0);
    if (normalized.length > 0) generationConfig.stop_sequences = normalized.slice(0, 5);
  }
  return Object.keys(generationConfig).length > 0 ? generationConfig : undefined;
}

function buildInteractionPayload(request: InteractionRequest) {
  const requestedTools = request.tools ?? [];
  const declarations = googleGeminiFunctionDeclarations.filter((tool) => requestedTools.includes(tool.name));
  const generationConfig = toGeminiGenerationConfig(request.generationConfig);
  const payload: Record<string, unknown> = { model: request.model || DEFAULT_GEMINI_MODEL, input: request.input, previous_interaction_id: request.previousInteractionId, generation_config: generationConfig, tools: declarations.length ? declarations : undefined, stream: true, store: true };
  const systemInstruction = request.systemInstruction?.trim();
  if (systemInstruction) payload.system_instruction = systemInstruction;
  return payload;
}

async function* streamDirectRequest(request: InteractionRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();
  let interactionId: string | undefined;
  let sawTerminalEvent = false;
  let sawRequiresAction = false;
  const pendingFunctions = new Map<number, PendingFunctionCall>();
  const thoughtSummaryParts = new Map<number, string>();
  if (signal?.aborted) { yield { type: 'cancelled' }; return; }
  try {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) { yield { type: 'failed', error: normalizeGeminiError(new Error('Gemini API key is not configured in the app Lockbox.'), { requestId }) }; return; }
    if (signal?.aborted) { yield { type: 'cancelled' }; return; }
    const client = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
    const query = typeof request.input === 'string' ? request.input : JSON.stringify(request.input);
    const memoryContext = await safeLoadMemoryContext(query);
    const contextualInstruction = appendMemoryContext(request.systemInstruction ?? '', memoryContext);
    const stream = await client.interactions.create(buildInteractionPayload({ ...request, systemInstruction: contextualInstruction }) as never);
    for await (const rawEvent of stream as unknown as AsyncIterable<unknown>) {
      if (signal?.aborted) { yield { type: 'cancelled', interactionId }; return; }
      const raw = asRecord(rawEvent);
      const eventType = readString(raw, 'event_type') ?? readString(raw, 'type') ?? '';
      const eventInteractionId = interactionIdFrom(raw);
      if (eventInteractionId) interactionId = eventInteractionId;
      if (eventType === 'interaction.created') { const interaction = asRecord(raw.interaction); const id = readString(interaction, 'id') ?? interactionId ?? 'unknown'; interactionId = id; const model = readString(interaction, 'model') ?? (request.model || DEFAULT_GEMINI_MODEL); yield { type: 'interaction-created', interactionId: id, model }; continue; }
      if (eventType === 'interaction.in_progress' || eventType === 'interaction.status_update' || eventType === 'interaction.status' || eventType === 'interaction.updated' || eventType === 'interaction.requires_action') { const status = readString(raw, 'status') ?? readString(asRecord(raw.interaction), 'status') ?? eventType.replace('interaction.', ''); if (eventType === 'interaction.requires_action' || status === 'requires_action') sawRequiresAction = true; if (interactionId) yield { type: 'interaction-status', interactionId, status }; continue; }
      if (eventType === 'step.start') {
        const index = stepIndex(raw);
        const step = asRecord(raw.step);
        const type = stepType(raw);
        yield { type: 'step-start', index, stepType: type };
        if (type === 'thought') {
          const summaryBlocks = Array.isArray(step.summary) ? step.summary : [];
          for (const summaryBlock of summaryBlocks) {
            const text = readString(asRecord(summaryBlock), 'text');
            if (text) { appendThoughtSummary(thoughtSummaryParts, index, text); yield { type: 'thought-summary-delta', index, text }; }
          }
        }
        const signature = readString(step, 'signature');
        if (signature) yield { type: 'thought-signature', index, signature };
        if (type === 'function_call') { const callId = readString(step, 'id'); const name = readString(step, 'name'); if (callId && name) pendingFunctions.set(index, { callId, name, arguments: '' }); }
        continue;
      }
      if (eventType === 'step.delta') {
        const delta = asRecord(raw.delta); const index = stepIndex(raw); const deltaType = readString(delta, 'type'); const content = asRecord(delta.content); const deltaText = readString(delta, 'text') ?? readString(content, 'text');
        if (deltaType === 'thought_signature') { const signature = readString(delta, 'signature'); if (signature) yield { type: 'thought-signature', index, signature }; }
        else if (deltaType === 'thought_summary') { if (deltaText) { appendThoughtSummary(thoughtSummaryParts, index, deltaText); yield { type: 'thought-summary-delta', index, text: deltaText }; } }
        else if (deltaType === 'text' && deltaText) { yield { type: 'text-delta', index, text: deltaText }; }
        else if ((deltaType === 'arguments' || deltaType === 'arguments_delta') && pendingFunctions.has(index)) { const partialArguments = readString(delta, 'partial_arguments') ?? readString(delta, 'arguments'); if (partialArguments) pendingFunctions.get(index)!.arguments += partialArguments; }
        continue;
      }
      if (eventType === 'step.stop') { const index = stepIndex(raw); const pending = pendingFunctions.get(index); if (pending && pending.arguments && interactionId) { try { const args = JSON.parse(pending.arguments) as unknown; if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Function arguments must be an object.'); yield { type: 'tool-call', interactionId, index, callId: pending.callId, name: pending.name, arguments: args as Record<string, unknown> }; sawRequiresAction = true; } catch { yield { type: 'failed', error: normalizeGeminiError(new Error('Gemini produced invalid function-call arguments.'), { requestId, interactionId }) }; return; } pendingFunctions.delete(index); } yield { type: 'step-stop', index }; continue; }
      if (eventType === 'interaction.completed') {
        const interaction = asRecord(raw.interaction); interactionId = readString(interaction, 'id') ?? interactionId; const status = readString(interaction, 'status') ?? 'completed'; sawTerminalEvent = true;
        const usage = readUsage(interaction.usage) ?? readUsage(raw.usage); const thoughtSummary = thoughtSummaryFrom(thoughtSummaryParts); const completedUsage = usage ?? (thoughtSummary ? { thoughtSummary } : undefined); if (completedUsage && thoughtSummary) completedUsage.thoughtSummary = thoughtSummary;
        yield { type: 'completed', interactionId: interactionId ?? 'unknown', status, durationMs: Math.max(1, Math.round(performance.now() - startedAt)), usage: completedUsage }; return;
      }
      if (eventType === 'error') { const providerError = asRecord(raw.error); const message = readString(providerError, 'message') ?? 'Gemini returned a streaming error.'; sawTerminalEvent = true; yield { type: 'failed', error: normalizeGeminiError(new Error(message), { requestId, interactionId, durationMs: Math.max(1, Math.round(performance.now() - startedAt)) }) }; return; }
    }
    if (sawRequiresAction || sawTerminalEvent) return;
    yield { type: 'failed', error: normalizeGeminiError(new Error('Gemini stream ended without an explicit interaction.completed event.'), { requestId, interactionId, durationMs: Math.max(1, Math.round(performance.now() - startedAt)) }) };
  } catch (cause) { const error = normalizeGeminiError(cause, { requestId, interactionId, durationMs: Math.max(1, Math.round(performance.now() - startedAt)) }); if (error.cancelled || signal?.aborted) { yield { type: 'cancelled', interactionId }; return; } yield { type: 'failed', error }; }
}

export const geminiTurnPort: GeminiTurnPort = {
  streamReply(request: GeminiTurnRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> { return streamDirectRequest({ model: request.model || DEFAULT_GEMINI_MODEL, input: request.input, previousInteractionId: request.previousInteractionId, generationConfig: request.generationConfig, systemInstruction: request.systemInstruction, tools: request.tools }, signal); },
  streamToolResult(request: GeminiToolContinuationRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> { return streamDirectRequest({ model: request.model || DEFAULT_GEMINI_MODEL, input: [{ type: 'function_result', name: request.result.name, call_id: request.result.callId, result: [{ type: 'text', text: JSON.stringify(request.result.result) }] }], previousInteractionId: request.previousInteractionId, generationConfig: request.generationConfig, systemInstruction: request.systemInstruction, tools: request.tools }, signal); },
};
