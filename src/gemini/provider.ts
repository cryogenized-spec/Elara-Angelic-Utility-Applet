import { GoogleGenAI } from '@google/genai';
import { DEFAULT_GEMINI_MODEL, type GeminiStreamEvent, type GeminiToolContinuationRequest, type GeminiTurnPort, type GeminiTurnRequest, type GeminiUsage } from './contracts';
import { normalizeGeminiError } from './errors';
import { getGeminiApiKey, getGeminiLockboxStatus } from '../persistence/gemini-api-key';
import { googleGeminiFunctionDeclarations } from '../google/tools/gemini-declarations';
import { composeSystemInstructionWithStatus } from './memory-context';
import { artifactRepository } from '../artifacts/repository';
import { ArtifactError } from '../artifacts/errors';
import { isAttachment } from '../domain/artifact';
import {
  estimateSerializedInputTokens,
  finalizeGeminiQuotaReservation,
  releaseGeminiQuotaReservation,
  reserveGeminiQuota,
  type GeminiQuotaReservation,
} from './quota-ledger';

function asRecord(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}; }
function readString(record: Record<string, unknown>, key: string): string | undefined { const value = record[key]; return typeof value === 'string' && value.length > 0 ? value : undefined; }
function readNumber(record: Record<string, unknown>, key: string): number | undefined { const value = record[key]; return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function readStatus(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d{3}$/.test(value.trim())) return Number(value.trim());
  return undefined;
}
function readUsage(raw: unknown): GeminiUsage | undefined {
  const usage = asRecord(raw);
  const inputTokens = readNumber(usage, 'input_tokens') ?? readNumber(usage, 'prompt_tokens') ?? readNumber(usage, 'prompt_token_count') ?? readNumber(usage, 'total_input_tokens');
  const outputTokens = readNumber(usage, 'output_tokens') ?? readNumber(usage, 'completion_tokens') ?? readNumber(usage, 'candidates_token_count') ?? readNumber(usage, 'total_output_tokens');
  const cachedTokens = readNumber(usage, 'cached_tokens') ?? readNumber(usage, 'cached_content_token_count') ?? readNumber(usage, 'total_cached_tokens');
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

type PendingFunctionCall = { callId: string; name: string; arguments: string; initialArguments?: unknown };
type InteractionRequest = { model: string; input: unknown; attachments?: readonly string[]; previousInteractionId?: string; generationConfig?: unknown; systemInstruction?: string; tools?: readonly string[]; memoryContext?: 'thread' | 'none'; conversationId?: string; generationId?: string; isGenerationActive?: () => boolean; signal?: AbortSignal };

function pendingFunctionCall(callId: string, name: string, step: Record<string, unknown>): PendingFunctionCall {
  const initial = step.arguments;
  if (typeof initial === 'string') return { callId, name, arguments: initial };
  if (initial === undefined || initial === null) return { callId, name, arguments: '' };
  return { callId, name, arguments: '', initialArguments: initial };
}

function resolveFunctionArguments(pending: PendingFunctionCall): Record<string, unknown> {
  const source: unknown = pending.arguments.length > 0 ? JSON.parse(pending.arguments) : pending.initialArguments === undefined ? {} : pending.initialArguments;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Function arguments must be an object.');
  return source as Record<string, unknown>;
}

type GeminiInputPart = Record<string, unknown>;
const INLINE_ATTACHMENT_LIMIT = 4 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  return btoa(binary);
}

async function blobAsBase64(blob: Blob): Promise<string> {
  let bytes: ArrayBuffer;
  if (typeof blob.arrayBuffer === 'function') bytes = await blob.arrayBuffer();
  else if (typeof FileReader !== 'undefined') {
    bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error('The attachment could not be read.'));
      reader.readAsArrayBuffer(blob);
    });
  } else bytes = await new Response(blob).arrayBuffer();
  return bytesToBase64(new Uint8Array(bytes));
}

function providerPartType(mimeType: string): 'image' | 'document' { return mimeType.startsWith('image/') ? 'image' : 'document'; }

async function resolveGeminiInput(request: InteractionRequest, client: GoogleGenAI): Promise<unknown> {
  if (!request.attachments?.length) return request.input;
  const parts: GeminiInputPart[] = [];
  if (typeof request.input === 'string' && request.input.trim()) parts.push({ type: 'text', text: request.input });
  const active = () => !request.isGenerationActive || request.isGenerationActive();
  for (const artifactId of request.attachments) {
    if (!active()) throw new DOMException('The generation was superseded.', 'AbortError');
    const artifact = await artifactRepository.get(artifactId);
    if (!isAttachment(artifact) || artifact.status !== 'ready') throw new ArtifactError('PROVIDER_ATTACHMENT_FAILED', 'An attachment is not ready for Gemini.');
    const type = providerPartType(artifact.mimeType);
    const validRemoteRef = artifact.remoteRef?.provider === 'gemini' && artifact.remoteRef.expiresAt > Date.now() + 60_000;
    if (validRemoteRef) { parts.push({ type, uri: artifact.remoteRef!.fileUri, mime_type: artifact.mimeType }); continue; }
    const operationId = `${request.generationId ?? crypto.randomUUID()}:${artifact.id}`;
    await artifactRepository.beginOperation(artifact.id, operationId, 'ready');
    const guard = { operationId, expectedStatus: 'ready' as const, isValid: () => !request.signal?.aborted && active() };
    if (request.signal?.aborted || !active()) throw new DOMException('The provider preparation was cancelled.', 'AbortError');
    if (artifact.remoteRef) await artifactRepository.updateMetadata(artifact.id, { remoteRef: null }, guard);
    if (artifact.data.size <= INLINE_ATTACHMENT_LIMIT) {
      const data = await blobAsBase64(artifact.data);
      if (request.signal?.aborted || !active()) throw new DOMException('The provider preparation was cancelled.', 'AbortError');
      parts.push({ type, data, mime_type: artifact.mimeType });
      continue;
    }
    try {
      const uploaded = await client.files.upload({ file: artifact.data, config: { mimeType: artifact.mimeType } } as never) as unknown as Record<string, unknown>;
      if (request.signal?.aborted || !active()) throw new DOMException('The provider preparation was cancelled.', 'AbortError');
      const fileUri = typeof uploaded.uri === 'string' ? uploaded.uri : undefined;
      if (!fileUri) throw new Error('Gemini did not return a file URI.');
      const expiresAt = typeof uploaded.expirationTime === 'string' ? Date.parse(uploaded.expirationTime) : Date.now() + 48 * 60 * 60 * 1000;
      await artifactRepository.updateMetadata(artifact.id, { remoteRef: { provider: 'gemini', fileUri, expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 48 * 60 * 60 * 1000 } }, guard);
      if (request.signal?.aborted || !active()) throw new DOMException('The provider preparation was cancelled.', 'AbortError');
      parts.push({ type, uri: fileUri, mime_type: artifact.mimeType });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      if (cause instanceof ArtifactError) throw cause;
      throw new ArtifactError('PROVIDER_ATTACHMENT_FAILED', 'Gemini could not prepare this attachment.', cause);
    }
  }
  if (request.signal?.aborted || !active()) throw new DOMException('The provider preparation was cancelled.', 'AbortError');
  return parts;
}

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

function toolContinuationInput(request: GeminiToolContinuationRequest): unknown[] {
  const results = request.results ?? (request.result ? [request.result] : []);
  return results.map((result) => ({
    type: 'function_result',
    name: result.name,
    call_id: result.callId,
    result: [{ type: 'text', text: JSON.stringify(result.result) }],
  }));
}

/**
 * Estimate the serialized provider request before dispatch. This mirrors the
 * exact declaration expansion used by the browser provider; fresh checkpoint
 * calls use it to prove they still fit inside the turn-level hard budget.
 */
export function estimateGeminiTurnRequestInputTokens(request: GeminiTurnRequest): number {
  return estimateSerializedInputTokens(buildInteractionPayload({
    model: request.model || DEFAULT_GEMINI_MODEL,
    input: request.input,
    previousInteractionId: request.previousInteractionId,
    generationConfig: request.generationConfig,
    systemInstruction: request.systemInstruction,
    tools: request.tools,
  }));
}

/**
 * Continuations inherit server-side history, so callers combine this serialized
 * delta estimate with the previous interaction's measured gross input.
 */
export function estimateGeminiToolContinuationInputTokens(request: GeminiToolContinuationRequest): number {
  return estimateSerializedInputTokens(buildInteractionPayload({
    model: request.model || DEFAULT_GEMINI_MODEL,
    input: toolContinuationInput(request),
    previousInteractionId: request.previousInteractionId,
    generationConfig: request.generationConfig,
    systemInstruction: request.systemInstruction,
    tools: request.tools,
  }));
}

async function nextStreamItem(iterator: AsyncIterator<unknown>, signal?: AbortSignal): Promise<IteratorResult<unknown> | 'aborted'> {
  if (!signal || signal.aborted) return signal?.aborted ? 'aborted' : iterator.next();
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<'aborted'>((resolve) => {
    onAbort = () => resolve('aborted');
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([iterator.next(), abortPromise]); }
  finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
}

async function* streamDirectRequest(request: InteractionRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();
  let interactionId: string | undefined;
  let sawTerminalEvent = false;
  let sawRequiresAction = false;
  const pendingFunctions = new Map<number, PendingFunctionCall>();
  const thoughtSummaryParts = new Map<number, string>();
  let quotaReservation: Extract<GeminiQuotaReservation, { granted: true }> | undefined;
  let usageReported = false;
  const estimatedUsageEvent = (status: string, providerUsage?: GeminiUsage): GeminiStreamEvent | undefined => {
    if (usageReported || !quotaReservation) return undefined;
    usageReported = true;
    return {
      type: 'interaction-usage',
      interactionId: interactionId ?? requestId,
      status,
      source: 'estimate',
      usage: { ...providerUsage, inputTokens: quotaReservation.reservedInputTokens },
    };
  };
  const usageEvent = async (status: string, providerUsage?: GeminiUsage): Promise<GeminiStreamEvent | undefined> => {
    const grossInput = providerUsage?.inputTokens;
    if (typeof grossInput === 'number' && Number.isInteger(grossInput) && grossInput >= 0) {
      usageReported = true;
      if (quotaReservation) await finalizeGeminiQuotaReservation(quotaReservation, grossInput);
      return {
        type: 'interaction-usage',
        interactionId: interactionId ?? requestId,
        status,
        source: 'provider',
        usage: { ...providerUsage, inputTokens: grossInput },
      };
    }
    return estimatedUsageEvent(status, providerUsage);
  };
  if (signal?.aborted) { yield { type: 'cancelled' }; return; }
  try {
    const lockboxStatus = await getGeminiLockboxStatus();
    if (lockboxStatus === 'empty') { yield { type: 'failed', error: normalizeGeminiError(new Error('Gemini API key is not configured in the app Lockbox.'), { requestId, category: 'configuration' }) }; return; }
    if (lockboxStatus === 'locked') {
      const error = normalizeGeminiError(new Error('Gemini API key is locked in the app Lockbox. Unlock the Lockbox before sending.'), { requestId, category: 'configuration' });
      yield { type: 'failed', error: { ...error, code: 'GEMINI_LOCKBOX_LOCKED' } };
      return;
    }
    const apiKey = await getGeminiApiKey();
    if (!apiKey) { yield { type: 'failed', error: normalizeGeminiError(new Error('Gemini API key is not configured in the app Lockbox.'), { requestId, category: 'configuration' }) }; return; }
    if (signal?.aborted) { yield { type: 'cancelled' }; return; }
    const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1', retryOptions: { attempts: 1 } } });
    const query = typeof request.input === 'string' ? request.input : JSON.stringify(request.input);

    let contextualInstruction = request.systemInstruction?.trim() || undefined;
    const shouldComposeThreadMemory = request.memoryContext !== 'none' && !request.previousInteractionId;
    if (shouldComposeThreadMemory) {
      const memoryStartedAt = performance.now();
      const composed = await composeSystemInstructionWithStatus(request.systemInstruction, query, request.conversationId);
      contextualInstruction = composed.instruction;
      const memoryDurationMs = Math.max(0, performance.now() - memoryStartedAt);
      if (composed.memoryStatus !== 'empty') {
        yield {
          type: 'context-activity',
          category: 'memory',
          label: 'Memory',
          detail: composed.memoryStatus === 'used' ? 'Recalled relevant durable memory.' : 'Memory retrieval was unavailable; continued without it.',
          durationMs: memoryDurationMs,
          outcome: composed.memoryStatus,
        };
      }
    }

    if (signal?.aborted) { yield { type: 'cancelled' }; return; }
    const providerInput = await resolveGeminiInput({ ...request, signal }, client);
    const payload = buildInteractionPayload({ ...request, input: providerInput, systemInstruction: contextualInstruction });
    const reservation = await reserveGeminiQuota(estimateSerializedInputTokens(payload));
    if (!reservation.granted) {
      const failure = new Error('Elara paused this Gemini request before the local rolling input budget could be exceeded.') as Error & { code?: string };
      failure.code = 'LOCAL_RATE_LIMIT';
      const normalized = normalizeGeminiError(failure, { requestId, category: 'rate_limit' });
      yield {
        type: 'failed',
        error: {
          ...normalized,
          code: 'GEMINI_LOCAL_RATE_LIMIT',
          providerCode: 'LOCAL_RATE_LIMIT',
          debug: {
            ...normalized.debug,
            localQuotaReason: reservation.reason,
            rollingInputTokens: reservation.rollingInputTokens,
            projectedInputTokens: reservation.projectedInputTokens,
            allowance: reservation.allowance,
            retryAfterMs: reservation.retryAfterMs,
          },
        },
      };
      return;
    }
    quotaReservation = reservation;
    if (signal?.aborted || request.isGenerationActive?.() === false) {
      await releaseGeminiQuotaReservation(reservation);
      yield { type: 'cancelled', interactionId };
      return;
    }
    const stream = await client.interactions.create(payload as never);
    const iterator = (stream as unknown as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    try {
      for (;;) {
        const next = await nextStreamItem(iterator, signal);
        if (next === 'aborted' || signal?.aborted) {
          void iterator.return?.()?.catch(() => undefined);
          const estimated = estimatedUsageEvent('cancelled');
          if (estimated) yield estimated;
          yield { type: 'cancelled', interactionId };
          return;
        }
        if (next.done) break;
        const raw = asRecord(next.value);
        const eventType = readString(raw, 'event_type') ?? readString(raw, 'type') ?? '';
        const eventInteractionId = interactionIdFrom(raw);
        if (eventInteractionId) interactionId = eventInteractionId;
        if (eventType === 'interaction.created') { const interaction = asRecord(raw.interaction); const id = readString(interaction, 'id') ?? interactionId ?? 'unknown'; interactionId = id; const model = readString(interaction, 'model') ?? (request.model || DEFAULT_GEMINI_MODEL); yield { type: 'interaction-created', interactionId: id, model }; continue; }
        if (eventType === 'interaction.in_progress' || eventType === 'interaction.status_update' || eventType === 'interaction.status' || eventType === 'interaction.updated' || eventType === 'interaction.requires_action') {
          const interaction = asRecord(raw.interaction);
          const status = readString(raw, 'status') ?? readString(interaction, 'status') ?? eventType.replace('interaction.', '');
          if (eventType === 'interaction.requires_action' || status === 'requires_action') sawRequiresAction = true;
          if (eventType === 'interaction.requires_action') {
            const providerUsage = readUsage(interaction.usage)
              ?? readUsage(interaction.usage_metadata)
              ?? readUsage(interaction.usageMetadata)
              ?? readUsage(raw.usage)
              ?? readUsage(raw.usage_metadata)
              ?? readUsage(raw.usageMetadata);
            const accounting = await usageEvent(status, providerUsage);
            if (accounting) yield accounting;
          }
          if (interactionId) yield { type: 'interaction-status', interactionId, status };
          continue;
        }
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
          if (type === 'function_call') { const callId = readString(step, 'id'); const name = readString(step, 'name'); if (callId && name) pendingFunctions.set(index, pendingFunctionCall(callId, name, step)); }
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
        if (eventType === 'step.stop') { const index = stepIndex(raw); const pending = pendingFunctions.get(index); if (pending && interactionId) { try { const args = resolveFunctionArguments(pending); yield { type: 'tool-call', interactionId, index, callId: pending.callId, name: pending.name, arguments: args }; sawRequiresAction = true; } catch { const estimated = estimatedUsageEvent('failed'); if (estimated) yield estimated; yield { type: 'failed', error: normalizeGeminiError(new Error('Gemini produced invalid function-call arguments.'), { requestId, interactionId }) }; return; } pendingFunctions.delete(index); } yield { type: 'step-stop', index }; continue; }
        if (eventType === 'interaction.completed') {
          const interaction = asRecord(raw.interaction);
          interactionId = readString(interaction, 'id') ?? interactionId;
          const status = readString(interaction, 'status') ?? 'completed';
          const usage = readUsage(interaction.usage)
            ?? readUsage(interaction.usage_metadata)
            ?? readUsage(interaction.usageMetadata)
            ?? readUsage(raw.usage)
            ?? readUsage(raw.usage_metadata)
            ?? readUsage(raw.usageMetadata);
          const accounting = await usageEvent(status, usage);
          if (accounting) yield accounting;
          const effectiveUsage = accounting?.type === 'interaction-usage' ? accounting.usage : usage;
          if (status === 'requires_action') {
            sawRequiresAction = true;
            if (interactionId) yield { type: 'interaction-status', interactionId, status };
            continue;
          }
          sawTerminalEvent = true;
          const thoughtSummary = thoughtSummaryFrom(thoughtSummaryParts);
          const completedUsage = effectiveUsage
            ? { ...effectiveUsage, ...(thoughtSummary ? { thoughtSummary } : {}) }
            : (thoughtSummary ? { thoughtSummary } : undefined);
          yield { type: 'completed', interactionId: interactionId ?? 'unknown', status, durationMs: Math.max(1, Math.round(performance.now() - startedAt)), usage: completedUsage };
          return;
        }
        if (eventType === 'error') {
          const providerError = asRecord(raw.error);
          const nestedError = asRecord(providerError.error);
          const message = readString(providerError, 'message') ?? 'Gemini returned a streaming error.';
          const failure = new Error(message) as Error & { status?: number; code?: string | number };
          const providerStatus = readStatus(providerError, 'status') ?? readStatus(providerError, 'code') ?? readStatus(nestedError, 'status') ?? readStatus(nestedError, 'code');
          if (providerStatus !== undefined) failure.status = providerStatus;
          const providerCode = readString(providerError, 'code') ?? readString(providerError, 'type') ?? readString(nestedError, 'code');
          if (providerCode !== undefined) failure.code = providerCode;
          sawTerminalEvent = true;
          const estimated = estimatedUsageEvent('failed');
          if (estimated) yield estimated;
          yield { type: 'failed', error: normalizeGeminiError(failure, { requestId, interactionId, durationMs: Math.max(1, Math.round(performance.now() - startedAt)) }) };
          return;
        }
      }
      if (sawRequiresAction) {
        const estimated = estimatedUsageEvent('requires_action');
        if (estimated) yield estimated;
        return;
      }
      if (sawTerminalEvent) return;
      const estimated = estimatedUsageEvent('failed');
      if (estimated) yield estimated;
      yield { type: 'failed', error: normalizeGeminiError(new Error('Gemini stream ended without an explicit interaction.completed event.'), { requestId, interactionId, durationMs: Math.max(1, Math.round(performance.now() - startedAt)) }) };
    } finally {
      void iterator.return?.()?.catch(() => undefined);
    }
  } catch (cause) {
    const normalized = normalizeGeminiError(cause, { requestId, interactionId, durationMs: Math.max(1, Math.round(performance.now() - startedAt)) });
    const error = cause instanceof ArtifactError
      ? { ...normalized, code: cause.code, message: cause.userMessage, retryable: false, debug: { ...normalized.debug, artifactError: cause.code } }
      : normalized;
    if (error.cancelled || signal?.aborted || request.isGenerationActive?.() === false) {
      const estimated = estimatedUsageEvent('cancelled');
      if (estimated) yield estimated;
      yield { type: 'cancelled', interactionId };
      return;
    }
    const estimated = estimatedUsageEvent('failed');
    if (estimated) yield estimated;
    yield { type: 'failed', error };
  }
}

export const geminiTurnPort: GeminiTurnPort = {
  streamReply(request: GeminiTurnRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> {
    return streamDirectRequest({ model: request.model || DEFAULT_GEMINI_MODEL, input: request.input, attachments: request.attachments, previousInteractionId: request.previousInteractionId, generationConfig: request.generationConfig, systemInstruction: request.systemInstruction, tools: request.tools, memoryContext: request.memoryContext, conversationId: request.conversationId, generationId: request.generationId, isGenerationActive: request.isGenerationActive }, signal);
  },
  streamToolResult(request: GeminiToolContinuationRequest, signal?: AbortSignal): AsyncGenerator<GeminiStreamEvent> {
    return streamDirectRequest({ model: request.model || DEFAULT_GEMINI_MODEL, input: toolContinuationInput(request), previousInteractionId: request.previousInteractionId, generationConfig: request.generationConfig, systemInstruction: request.systemInstruction, tools: request.tools, memoryContext: 'none' }, signal);
  },
};
