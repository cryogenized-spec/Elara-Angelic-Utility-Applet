import type { Dispatch, SetStateAction } from 'react';
import type { ChatMessage, ConversationState, ProviderStatus, ProviderUsage } from '../domain/chat';
import type { GeminiStreamEvent, GeminiUsage } from '../gemini/contracts';
import type { NormalizedProviderError } from '../gemini/errors';
import { buildExecutionSummary, thoughtSummaryOf, type GenerationState } from './generation-state';

// ---------------------------------------------------------------------------
// Generation sync: fold canonical stream events + reducer state into the
// durable conversation. The reducer owns the transcript; this module owns the
// one-assistant-message invariant (every text delta rewrites the SAME record)
// and terminal persistence. Trace-only events (thinking/tool/steps) are
// intentionally ignored here: they belong to the ephemeral live trace.
// ---------------------------------------------------------------------------

export interface GenerationSyncContext {
  assistantMessage: ChatMessage;
  base: ConversationState;
  model: string;
  wallStartedAt: number;
  supersedesGenerationId?: string;
  setConversation: Dispatch<SetStateAction<ConversationState>>;
  setStatus: (status: ProviderStatus) => void;
  setError: (message: string | null) => void;
  setStructuredError: (error: NormalizedProviderError | null) => void;
  save: (conversation: ConversationState) => Promise<void>;
  refreshThreads: () => Promise<void>;
  isCurrentConversation: () => boolean;
  ensureAssistant: () => void;
  streamFailed: { value: boolean };
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
  const { assistantMessage, base, isCurrentConversation } = context;

  if (event.type === 'text-delta') {
    context.ensureAssistant();
    if (!isCurrentConversation()) return;
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
    if (isCurrentConversation()) {
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
    if (!isCurrentConversation()) return;
    context.setStatus('failed');
    context.setStructuredError(event.error);
    context.setError(`[${event.error.code}] ${event.error.message}`);
    return;
  }

  if (event.type === 'error') {
    context.streamFailed.value = true;
    if (!isCurrentConversation()) return;
    context.setStatus('failed');
    if (event.error) {
      context.setStructuredError(event.error);
      context.setError(`[${event.error.code}] ${event.error.message}`);
    } else {
      context.setStructuredError(null);
      context.setError(event.message);
    }
    return;
  }

  if (event.type === 'cancelled') {
    // Restore the exact pre-turn state: no pseudo-answer, no persistence.
    if (!isCurrentConversation()) return;
    context.setConversation((current) => (current.id === base.id ? base : current));
    context.setStatus('idle');
    context.setError(null);
    context.setStructuredError(null);
    return;
  }
}
