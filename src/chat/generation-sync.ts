import type { Dispatch, SetStateAction } from 'react';
import type { ChatMessage, ConversationState, ProviderStatus, ProviderUsage } from '../domain/chat';
import type { GeminiStreamEvent, GeminiUsage } from '../gemini/contracts';
import type { NormalizedProviderError } from '../gemini/errors';
import {
  applyGenerationEvent,
  buildExecutionSummary,
  thoughtSummaryOf,
  type GenerationEventEnvelope,
  type GenerationState,
} from './generation-state';

// ---------------------------------------------------------------------------
// Generation sync: fold canonical stream events + reducer state into the
// durable conversation. The reducer owns the transcript; this module owns the
// one-assistant-message invariant (every text delta rewrites the SAME record)
// and terminal persistence. Trace-only events (thinking/tool/steps) are
// intentionally ignored here: they belong to the ephemeral live trace.
//
// Cross-turn arbitration: each turn owns an independent reducer, so reducer
// identity alone cannot stop an obsolete runner from mutating the app. The
// runner holds ONE shared arbiter; sync mutates application state only for
// the currently active generation.
// ---------------------------------------------------------------------------

export interface GenerationArbiter {
  activate(generationId: string): void;
  release(generationId: string): void;
  isActive(generationId: string): boolean;
}

export function createGenerationArbiter(): GenerationArbiter {
  let activeGenerationId: string | null = null;
  return {
    activate(generationId: string): void {
      activeGenerationId = generationId;
    },
    release(generationId: string): void {
      if (activeGenerationId === generationId) activeGenerationId = null;
    },
    isActive(generationId: string): boolean {
      return activeGenerationId === generationId;
    },
  };
}

export interface GenerationSyncContext {
  assistantMessage: ChatMessage;
  base: ConversationState;
  /** Exact turn input, so a retry re-runs the failed prompt (not latest history). */
  input: string;
  model: string;
  wallStartedAt: number;
  supersedesGenerationId?: string;
  setConversation: Dispatch<SetStateAction<ConversationState>>;
  setStatus: (status: ProviderStatus) => void;
  setError: (message: string | null) => void;
  setStructuredError: (error: NormalizedProviderError | null) => void;
  save: (conversation: ConversationState) => Promise<void>;
  refreshThreads: () => Promise<void>;
  /** Runner predicate: this turn's conversation is current AND its generation is still active. */
  isActiveGeneration: () => boolean;
  ensureAssistant: () => void;
  streamFailed: { value: boolean };
  /** Reported on terminal failure so a later retry can replace the attempt. */
  onFailedAttempt?: (attempt: FailedTurnAttempt) => void;
}

/**
 * Everything a user-initiated retry needs to replace (not append to) a
 * failed turn: the pre-generation conversation, the exact failed input, and
 * the response-variant identity for regeneration-style turns.
 */
export interface FailedTurnAttempt {
  generationId: string;
  base: ConversationState;
  input: string;
  responseGroupId?: string;
  responseVariant?: number;
}

export function canRetryFailedTurn(
  status: ProviderStatus,
  attempt: FailedTurnAttempt | null,
  conversationId: string,
): boolean {
  return (
    status === 'failed' &&
    attempt !== null &&
    attempt.base.id === conversationId &&
    attempt.input.trim().length > 0
  );
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

export function syncGenerationEvent(
  event: GeminiStreamEvent,
  generation: GenerationState,
  context: GenerationSyncContext,
): void {
  const { assistantMessage, base, isActiveGeneration } = context;

  if (event.type === 'text-delta') {
    context.ensureAssistant();
    if (!isActiveGeneration()) return;
    const text = generation.transcript;
    context.setConversation((current) =>
      current.id === base.id ? { ...base, messages: [...base.messages, { ...assistantMessage, text }] } : current,
    );
    return;
  }

  if (event.type === 'completed') {
    context.ensureAssistant();
    const completedAt = Date.now();
    const completedMessage: ChatMessage = {
      ...assistantMessage,
      text: generation.transcript,
      executionSummary: buildExecutionSummary(generation),
      providerTurn: {
        provider: 'gemini' as const,
        model: context.model,
        interactionId: generation.currentInteractionId ?? event.interactionId,
        startedAt: context.wallStartedAt,
        completedAt,
        durationMs: Math.max(1, completedAt - context.wallStartedAt),
        usage: buildUsage(event.usage, thoughtSummaryOf(generation)),
        generationId: generation.generationId,
        supersedesGenerationId: context.supersedesGenerationId,
      },
    };
    const completed: ConversationState = { ...base, updatedAt: completedAt, messages: [...base.messages, completedMessage] };
    if (isActiveGeneration()) {
      context.setConversation(completed);
      void context
        .save(completed)
        .then(context.refreshThreads)
        .catch((cause) => context.setError(cause instanceof Error ? cause.message : 'Could not save the response.'));
    }
    return;
  }

  if (event.type === 'failed') {
    context.streamFailed.value = true;
    if (!isActiveGeneration()) return;
    context.setStatus('failed');
    context.setStructuredError(event.error);
    context.setError(`[${event.error.code}] ${event.error.message}`);
    context.onFailedAttempt?.({
      generationId: generation.generationId,
      base,
      input: context.input,
      responseGroupId: assistantMessage.responseGroupId,
      responseVariant: assistantMessage.responseVariant,
    });
    return;
  }

  if (event.type === 'error') {
    context.streamFailed.value = true;
    if (!isActiveGeneration()) return;
    context.setStatus('failed');
    if (event.error) {
      context.setStructuredError(event.error);
      context.setError(`[${event.error.code}] ${event.error.message}`);
    } else {
      context.setStructuredError(null);
      context.setError(event.message);
    }
    context.onFailedAttempt?.({
      generationId: generation.generationId,
      base,
      input: context.input,
      responseGroupId: assistantMessage.responseGroupId,
      responseVariant: assistantMessage.responseVariant,
    });
    return;
  }

  if (event.type === 'cancelled') {
    // Restore the exact pre-turn state: no pseudo-answer, no persistence.
    if (!isActiveGeneration()) return;
    context.setConversation((current) => (current.id === base.id ? base : current));
    context.setStatus('idle');
    context.setError(null);
    context.setStructuredError(null);
    return;
  }
}

/**
 * Runner dispatch: reduce first, then sync — but only when the reducer
 * actually accepted the envelope. Stale-generation and post-terminal events
 * return the identical state reference and must not touch application state
 * (this is what stops a late abort-induced `cancelled` from wiping a
 * failure the watchdog already reported).
 */
export function dispatchGenerationEvent(
  current: GenerationState,
  envelope: GenerationEventEnvelope,
  context: GenerationSyncContext,
): GenerationState {
  const next = applyGenerationEvent(current, envelope);
  if (next === current) return current;
  syncGenerationEvent(envelope.event, next, context);
  return next;
}
