import { describe, expect, it } from 'vitest';
import type { ChatMessage, ConversationState, ProviderStatus } from '../domain/chat';
import type { NormalizedProviderError } from '../gemini/errors';
import { applyGenerationEvent, createGenerationState } from './generation-state';
import { statusAfterNavigation, syncGenerationEvent, type GenerationSyncContext } from './generation-sync';

describe('Pass 8 generation durability boundaries', () => {
  it('keeps the saving barrier active across navigation', () => {
    expect(statusAfterNavigation('saving')).toBe('saving');
    expect(statusAfterNavigation('streaming')).toBe('idle');
    expect(statusAfterNavigation('failed')).toBe('idle');
    expect(statusAfterNavigation('idle')).toBe('idle');
  });

  it('hands a rejecting terminal save to the turn owner without changing its identity', async () => {
    const base: ConversationState = {
      id: 'thread-1',
      title: 'Durability',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ id: 'user-1', role: 'user', text: 'Hello', createdAt: 1, conversationId: 'thread-1' }],
    };
    const assistantMessage: ChatMessage = { id: 'assistant-1', role: 'assistant', text: '', createdAt: 2, conversationId: 'thread-1' };
    const failure = new Error('disk full');
    const savePromise = Promise.reject(failure);
    let handedOff: Promise<void> | null = null;
    let status: ProviderStatus = 'streaming';
    let conversation = base;
    let structured: NormalizedProviderError | null = null;
    const context: GenerationSyncContext = {
      assistantMessage,
      base,
      input: 'Hello',
      model: 'gemini-3.8-flash',
      wallStartedAt: 1,
      setConversation: (updater) => {
        conversation = typeof updater === 'function' ? updater(conversation) : updater;
      },
      setStatus: (next) => { status = next; },
      setError: () => undefined,
      setStructuredError: (next) => { structured = next; },
      save: () => savePromise,
      onTerminalPersistence: (persistence) => { handedOff = persistence; },
      isActiveGeneration: () => true,
      ensureAssistant: () => undefined,
    };
    let generation = createGenerationState('gen-1', { startedAt: 0 });
    generation = applyGenerationEvent(generation, {
      generationId: 'gen-1',
      event: { type: 'text-delta', index: 0, text: 'Answer.' },
      receivedAt: 10,
    });
    const completed = { type: 'completed' as const, interactionId: 'interaction-1', status: 'completed', durationMs: 20 };
    generation = applyGenerationEvent(generation, { generationId: 'gen-1', event: completed, receivedAt: 20 });

    syncGenerationEvent(completed, generation, context);

    expect(status).toBe('saving');
    expect(conversation.messages.at(-1)?.text).toBe('Answer.');
    expect(structured).toBeNull();
    expect(handedOff).toBe(savePromise);
    if (!handedOff) throw new Error('terminal persistence was not handed off');
    await expect(handedOff).rejects.toBe(failure);
  });
});
