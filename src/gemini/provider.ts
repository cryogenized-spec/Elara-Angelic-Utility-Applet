import { DEFAULT_GEMINI_MODEL, type GeminiStreamEvent, type GeminiToolContinuationRequest, type GeminiTurnPort, type GeminiTurnRequest, type GeminiUsage } from './contracts';
import { normalizeGeminiError } from './errors';

const WORKER_BASE_URL = (import.meta.env.VITE_GEMINI_WORKER_URL as string | undefined)?.trim() || 'https://elara-gemini.cryogenized.workers.dev';
const WORKER_URL = `${WORKER_BASE_URL.replace(/\/$/, '')}/api/gemini`;

function asRecord(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}; }
function readString(record: Record<string, unknown>, key: string): string | undefined { const value = record[key]; return typeof value === 'string' && value.length > 0 ? value : undefined; }
function readNumber(record: Record<string, unknown>, key: string): number | undefined { const value = record[key]; return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function readUsage(raw: unknown): GeminiUsage | undefined { const usage = asRecord(raw); const inputTokens = readNumber(usage, 'input_tokens') ?? readNumber(usage, 'prompt_tokens') ?? readNumber(usage, 'prompt_token_count') ?? readNumber(usage, 'total_input_tokens'); const outputTokens = readNumber(usage, 'output_tokens') ?? readNumber(usage, 'completion_tokens') ?? readNumber(usage, 'candidates_token_count') ?? readNumber(usage, 'total_output_tokens'); const cachedTokens = readNumber(usage, 'cached_tokens') ?? readNumber(usage, 'cached_content_token_count'); const thoughtsTokens = readNumber(usage, 'thoughts_tokens') ?? readNumber(usage, 'total_thought_tokens'); const totalTokens = readNumber(usage, 'total_tokens') ?? readNumber(usage, 'total_token_count'); if ([inputTokens, outputTokens, cachedTokens, thoughtsTokens, totalTokens].every((value) => value === undefined)) return undefined; return { inputTokens, outputTokens, cachedTokens, thoughtsTokens, totalTokens }; }
function interactionIdFrom(event: Record<string, unknown>): string | undefined { return readString(event, 'interaction_id') ?? readString(event, 'interactionId') ?? readString(asRecord(event.interaction), 'id'); }
function stepIndex(event: Record<string, unknown>): number { return readNumber(event, 'index') ?? readNumber(asRecord(event.step), 'index') ?? 0; }
function stepType(event: Record<string, unknown>): string { return readString(asRecord(event.step), 'type') ?? readString(event, 'step_type') ?? 'other'; }
async function readErrorResponse(response: Response): Promise<Error & { status?: number }> { const text = await response.text(); let message = text; try { const parsed = asRecord(JSON.parse(text)); message = readString(parsed, 'message') ?? message; } catch {} if (response.status === 404) message = 'Gemini Worker API endpoint was not found.'; const error = new Error(message || `Gemini Worker returned HTTP ${response.status}`) as Error & { status?: number }; error.status = response.status; return error; }
function parseSseBlock(block: string): { eventType: string; data: Record<string, unknown> } | null { let eventType = ''; let dataText = ''; for (const line of block.split('\n')) { if (line.startsWith('event:')) eventType = line.slice(6).trim(); if (line.startsWith('data:')) dataText += line.slice(5).trim(); } if (!eventType || !dataText) return null; try { return { eventType, data: asRecord(JSON.parse(dataText)) }; } catch { return null; } }

async function* streamWorkerRequest(payload: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();
  let interactionId: string | undefined;
  let sawTerminalEvent = false;
  let sawRequiresAction = false;
  if (signal?.aborted) { yield { type: 'cancelled' }; return; }
  try {
    const response = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
    if (!response.ok) { const error = await readErrorResponse(response); const normalized = normalizeGeminiError(error, { requestId, durationMs: Math.max(1, Math.round(performance.now() - startedAt)) }); yield { type: 'failed', error: normalized }; return; }
    if (!response.body) { const normalized = normalizeGeminiError(new Error('Gemini Worker returned no streaming body.'), { requestId }); yield { type: 'failed', error: normalized }; return; }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        if (signal?.aborted) { yield { type: 'cancelled', interactionId }; return; }
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true }).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
          const parsed = parseSseBlock(block);
          if (!parsed) continue;
          const event = parsed.data;
          const eventType = parsed.eventType;
          const eventInteractionId = interactionIdFrom(event);
          if (eventInteractionId) interactionId = eventInteractionId;
          if (eventType === 'interaction.created') { const interaction = asRecord(event.interaction); const id = readString(interaction, 'id') ?? interactionId ?? 'unknown'; interactionId = id; yield { type: 'interaction-created', interactionId: id, model: readString(interaction, 'model') ?? (payload.model as string || DEFAULT_GEMINI_MODEL) }; continue; }
          if (eventType === 'interaction.in_progress' || eventType === 'interaction.status_update' || eventType === 'interaction.status' || eventType === 'interaction.updated' || eventType === 'interaction.requires_action') { const status = readString(event, 'status') ?? readString(asRecord(event.interaction), 'status') ?? eventType.replace('interaction.', ''); if (eventType === 'interaction.requires_action' || status === 'requires_action') sawRequiresAction = true; if (interactionId) yield { type: 'interaction-status', interactionId, status }; continue; }
          if (eventType === 'step.start') { const index = stepIndex(event); yield { type: 'step-start', index, stepType: stepType(event) }; const step = asRecord(event.step); const summaryParts = Array.isArray(step.summary) ? step.summary : []; for (const summary of summaryParts) { const text = readString(asRecord(summary), 'text'); if (text) yield { type: 'thought-summary-delta', index, text }; } const signature = readString(step, 'signature'); if (signature) yield { type: 'thought-signature', index, signature }; continue; }
          if (eventType === 'tool-call') { const callId = readString(event, 'call_id'); const name = readString(event, 'name'); const args = asRecord(event.arguments); if (callId && name) yield { type: 'tool-call', index: stepIndex(event), callId, name, arguments: args }; sawRequiresAction = true; continue; }
          if (eventType === 'step.delta') { const delta = asRecord(event.delta); const index = stepIndex(event); const deltaType = readString(delta, 'type'); const deltaText = readString(delta, 'text'); if (deltaType === 'thought_signature') { const signature = readString(delta, 'signature'); if (signature) yield { type: 'thought-signature', index, signature }; } else if (deltaType === 'thought_summary') { if (deltaText) yield { type: 'thought-summary-delta', index, text: deltaText }; } else if (deltaType === 'text' && deltaText) yield { type: 'text-delta', index, text: deltaText }; continue; }
          if (eventType === 'step.stop') { yield { type: 'step-stop', index: stepIndex(event) }; continue; }
          if (eventType === 'interaction.completed') { const interaction = asRecord(event.interaction); interactionId = readString(interaction, 'id') ?? interactionId; const status = readString(interaction, 'status') ?? 'completed'; sawTerminalEvent = true; yield { type: 'completed', interactionId: interactionId ?? 'unknown', status, durationMs: Math.max(1, Math.round(performance.now() - startedAt)), usage: readUsage(interaction.usage) ?? readUsage(event.usage) }; return; }
          if (eventType === 'error') { const providerError = asRecord(event.error); const message = readString(providerError, 'message') ?? 'Gemini Worker returned a streaming error.'; sawTerminalEvent = true; const normalized = normalizeGeminiError(new Error(message), { requestId, interactionId, durationMs: Math.max(1, Math.round(performance.now() - startedAt)) }); yield { type: 'failed', error: normalized }; return; }
        }
      }
    } finally { reader.releaseLock(); }
    if (sawRequiresAction) return;
    if (sawTerminalEvent) return;
    const normalized = normalizeGeminiError(new Error('Gemini Worker stream ended without an explicit interaction.completed event.'), { requestId, interactionId, durationMs: Math.max(1, Math.round(performance.now() - startedAt)) }); yield { type: 'failed', error: normalized };
  } catch (cause) { const error = normalizeGeminiError(cause, { requestId, interactionId, durationMs: Math.max(1, Math.round(performance.now() - startedAt)) }); if (error.cancelled || signal?.aborted) { yield { type: 'cancelled', interactionId }; return; } yield { type: 'failed', error }; }
}

function commonPayload(request: { model: string; generationConfig?: unknown; systemInstruction?: string; tools?: readonly string[] }) { return { model: request.model || DEFAULT_GEMINI_MODEL, generationConfig: request.generationConfig, systemInstruction: request.systemInstruction, tools: request.tools }; }

export const geminiTurnPort: GeminiTurnPort = {
  streamReply(request: GeminiTurnRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> {
    return streamWorkerRequest({ ...commonPayload(request), input: request.input, previousInteractionId: request.previousInteractionId }, signal);
  },

  streamToolResult(request: GeminiToolContinuationRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> {
    return streamWorkerRequest({ ...commonPayload(request), previousInteractionId: request.previousInteractionId, toolResult: request.result }, signal);
  },
};
