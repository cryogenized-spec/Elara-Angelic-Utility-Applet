import type { Dispatch, SetStateAction } from 'react';
import type { ChatMessage, ConversationState, ProviderStatus, ProviderUsage } from '../domain/chat';
import type { GeminiStreamEvent, GeminiUsage } from '../gemini/contracts';
import type { NormalizedProviderError } from '../gemini/errors';
import {
  applyGenerationEvent,
  buildGenerationActivity,
  persistedThoughtSummaryOf,
  type GenerationEventEnvelope,
  type GenerationState,
} from './generation-state';

// ---------------------------------------------------------------------------
// Generation sync: fold canonical stream events + reducer state into the
// durable conversation. The reducer owns transcript + Generation Activity;
// this module owns the one-assistant-message invariant and terminal persistence.
// ---------------------------------------------------------------------------

export interface GenerationArbiter {
  activate(generationId: string): void;
  release(generationId: string): void;
  isActive(generationId: string): boolean;
}

export function createGenerationArbiter(): GenerationArbiter {
  let activeGenerationId: string | null = null;
  return {
    activate(generationId: string): void { activeGenerationId = generationId; },
    release(generationId: string): void { if (activeGenerationId === generationId) activeGenerationId = null; },
    isActive(generationId: string): boolean { return activeGenerationId === generationId; },
  };
}

export interface GenerationSyncContext {
  assistantMessage: ChatMessage;
  base: ConversationState;
  input: string;
  inputMessageId?: string;
  model: string;
  wallStartedAt: number;
  supersedesGenerationId?: string;
  setConversation: Dispatch<SetStateAction<ConversationState>>;
  setStatus: (status: ProviderStatus) => void;
  setError: (message: string | null) => void;
  setStructuredError: (error: NormalizedProviderError | null) => void;
  save: (conversation: ConversationState) => Promise<void>;
  onTerminalPersistence: (persistence: Promise<void>) => void;
  isActiveGeneration: () => boolean;
  ensureAssistant: () => void;
  onFailedAttempt?: (attempt: FailedTurnAttempt) => void;
}

export interface FailedTurnAttempt {
  generationId: string;
  base: ConversationState;
  input: string;
  inputMessageId?: string;
  responseGroupId?: string;
  responseVariant?: number;
}

export function canRetryFailedTurn(status: ProviderStatus, attempt: FailedTurnAttempt | null, conversationId: string): boolean {
  return status === 'failed' && attempt !== null && attempt.base.id === conversationId && attempt.input.trim().length > 0;
}

/** Navigation may hide the old turn, but it must not release a durability barrier. */
export function statusAfterNavigation(status: ProviderStatus): ProviderStatus {
  return status === 'saving' ? 'saving' : 'idle';
}

export function regenerateBaseFor(conversation: ConversationState, attempt: FailedTurnAttempt | null): ConversationState {
  return attempt !== null && attempt.base.id === conversation.id ? attempt.base : conversation;
}

export function isFailedPartialTarget(conversation: ConversationState, attempt: FailedTurnAttempt | null, targetId: string): boolean {
  if (attempt === null || attempt.base.id !== conversation.id) return false;
  if (attempt.base.messages.some((message) => message.id === targetId)) return false;
  return conversation.messages.some((message) => message.id === targetId);
}

function buildUsage(usage: GeminiUsage | undefined, thoughtSummary: string | undefined): ProviderUsage | undefined {
  if (!usage && !thoughtSummary) return undefined;
  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    cachedTokens: usage?.cachedTokens,
    thoughtsTokens: usage?.thoughtsTokens,
    totalTokens: usage?.totalTokens,
    thoughtSummary,
  };
}

export function syncGenerationEvent(event: GeminiStreamEvent, generation: GenerationState, context: GenerationSyncContext): void {
  const { assistantMessage, base, isActiveGeneration } = context;

  if (event.type === 'text-delta') {
    context.ensureAssistant();
    if (!isActiveGeneration()) return;
    const text = generation.transcript;
    context.setConversation((current) => current.id === base.id ? { ...base, messages: [...base.messages, { ...assistantMessage, text }] } : current);
    return;
  }

  if (event.type === 'completed') {
    context.ensureAssistant();
    if (!isActiveGeneration()) return;
    const completedAt = Date.now();
    const completedMessage: ChatMessage = {
      ...assistantMessage,
      text: generation.transcript,
      artifacts: generation.artifactIds.length ? [...generation.artifactIds] : undefined,
      media: generation.mediaItems.length ? [...generation.mediaItems] : undefined,
      generationActivity: buildGenerationActivity(generation),
      providerTurn: {
        provider: 'gemini' as const,
        model: context.model,
        interactionId: generation.currentInteractionId ?? event.interactionId,
        startedAt: context.wallStartedAt,
        completedAt,
        durationMs: Math.max(1, completedAt - context.wallStartedAt),
        usage: buildUsage(event.usage, persistedThoughtSummaryOf(generation)),
        generationId: generation.generationId,
        supersedesGenerationId: context.supersedesGenerationId,
      },
    };
    const completed: ConversationState = { ...base, updatedAt: completedAt, messages: [...base.messages, completedMessage] };
    context.setConversation(completed);
    context.setStatus('saving');
    const persistence = context.save(completed);
    // The turn owner awaits this exact promise. Mark the rejection handled now
    // so a fast storage failure cannot surface as an unhandled rejection before
    // control reaches the owner's finally block.
    void persistence.catch(() => undefined);
    context.onTerminalPersistence(persistence);
    return;
  }

  if (event.type === 'failed' || event.type === 'error') {
    if (!isActiveGeneration()) return;
    context.setStatus('failed');
    const structured = event.type === 'failed' ? event.error : event.error;
    if (structured) {
      context.setStructuredError(structured);
      context.setError(`[${structured.code}] ${structured.message}`);
    } else if (event.type === 'error') {
      context.setStructuredError(null);
      context.setError(event.message);
    }
    context.onFailedAttempt?.({
      generationId: generation.generationId,
      base,
      input: context.input,
      inputMessageId: context.inputMessageId,
      responseGroupId: assistantMessage.responseGroupId,
      responseVariant: assistantMessage.responseVariant,
    });
    return;
  }

  if (event.type === 'cancelled') {
    if (!isActiveGeneration()) return;
    context.setConversation((current) => current.id === base.id ? base : current);
    context.setStatus('idle');
    context.setError(null);
    context.setStructuredError(null);
  }
}

export function dispatchGenerationEvent(current: GenerationState, envelope: GenerationEventEnvelope, context: GenerationSyncContext): GenerationState {
  const next = applyGenerationEvent(current, envelope);
  if (next === current) return current;
  syncGenerationEvent(envelope.event, next, context);
  return next;
}
