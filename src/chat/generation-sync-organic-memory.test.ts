import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ConversationState, ProviderStatus } from '../domain/chat';
import type { OrganicObservationResult } from '../memory/organic-observer';

const { observePersistedTurn, geminiOrganicMemoryExtractor } = vi.hoisted(() => ({
  observePersistedTurn: vi.fn(),
  geminiOrganicMemoryExtractor: vi.fn(),
}));

vi.mock('../memory/organic-observer', () => ({ observePersistedTurn }));
vi.mock('../gemini/memory-observer', () => ({ geminiOrganicMemoryExtractor }));

import { applyGenerationEvent, createGenerationState } from './generation-state';
import { syncGenerationEvent, type GenerationSyncContext } from './generation-sync';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeContext(save: GenerationSyncContext['save'], responseVariant?: number) {
  const user: ChatMessage = { id: 'user-1', role: 'user', text: 'I prefer the compact editor.', conversationId: 'thread-1', createdAt: 1 };
  const base: ConversationState = { id: 'thread-1', title: 'Thread', createdAt: 1, updatedAt: 1, messages: [user] };
  const assistantMessage: ChatMessage = { id: 'assistant-1', role: 'assistant', text: '', conversationId: 'thread-1', createdAt: 2, responseVariant };
  let conversation = base;
  let status: ProviderStatus = 'streaming';
  let handedOff: Promise<void> | null = null;
  const context: GenerationSyncContext = {
    assistantMessage,
    base,
    input: user.text,
    inputMessageId: user.id,
    model: 'gemini-3.8-flash',
    wallStartedAt: 1,
    setConversation: (next) => { conversation = typeof next === 'function' ? next(conversation) : next; },
    setStatus: (next) => { status = next; },
    setError: () => undefined,
    setStructuredError: () => undefined,
    save,
    onTerminalPersistence: (pending) => { handedOff = pending; },
    isActiveGeneration: () => true,
    ensureAssistant: () => undefined,
  };
  return { context, read: () => ({ conversation, status, handedOff }) };
}

function completedGeneration(withMemoryTool = false) {
  let state = createGenerationState('gen-1', { startedAt: 0 });
  const events = withMemoryTool
    ? [
        { type: 'step-start', index: 0, stepType: 'function_call' } as const,
        { type: 'tool-call', interactionId: 'i-1', index: 0, callId: 'call-1', name: 'memory.lookup', arguments: { query: 'compact' } } as const,
        { type: 'step-stop', index: 0 } as const,
        { type: 'completed', interactionId: 'i-1', status: 'completed', durationMs: 1 } as const,
      ]
    : [{ type: 'completed', interactionId: 'i-1', status: 'completed', durationMs: 1 } as const];
  for (const [index, event] of events.entries()) {
    state = applyGenerationEvent(state, { generationId: 'gen-1', event, receivedAt: index + 1 });
  }
  return { state, completed: events.at(-1)! };
}

describe('terminal persistence -> organic observation barrier', () => {
  beforeEach(() => {
    observePersistedTurn.mockReset();
    geminiOrganicMemoryExtractor.mockReset();
  });

  it('does not inspect memory until the response save has durably resolved', async () => {
    const gate = deferred<void>();
    const extractor = vi.fn();
    geminiOrganicMemoryExtractor.mockReturnValue(extractor);
    observePersistedTurn.mockResolvedValue({ status: 'empty', count: 0 } satisfies OrganicObservationResult);
    const harness = makeContext(() => gate.promise);
    const { state, completed } = completedGeneration();

    syncGenerationEvent(completed, state, harness.context);
    const handedOff = harness.read().handedOff;
    if (!handedOff) throw new Error('expected terminal persistence handoff');

    expect(harness.read().status).toBe('saving');
    expect(observePersistedTurn).not.toHaveBeenCalled();

    gate.resolve();
    await handedOff;

    expect(geminiOrganicMemoryExtractor).toHaveBeenCalledWith('gemini-3.8-flash');
    expect(observePersistedTurn).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'thread-1',
      messageId: 'user-1',
      userMessage: 'I prefer the compact editor.',
      extractor,
      usedMemoryTool: false,
    }));
  });

  it('never runs the observer when the response save fails', async () => {
    const saveError = new Error('IndexedDB write failed');
    geminiOrganicMemoryExtractor.mockReturnValue(vi.fn());
    const harness = makeContext(async () => { throw saveError; });
    const { state, completed } = completedGeneration();

    syncGenerationEvent(completed, state, harness.context);
    const handedOff = harness.read().handedOff;
    if (!handedOff) throw new Error('expected terminal persistence handoff');

    await expect(handedOff).rejects.toBe(saveError);
    expect(observePersistedTurn).not.toHaveBeenCalled();
  });

  it('marks memory-tool turns and regeneration variants so the core skips them', async () => {
    const extractor = vi.fn();
    geminiOrganicMemoryExtractor.mockReturnValue(extractor);
    observePersistedTurn.mockResolvedValue({ status: 'skipped', count: 0 } satisfies OrganicObservationResult);
    const harness = makeContext(async () => undefined, 2);
    const { state, completed } = completedGeneration(true);

    syncGenerationEvent(completed, state, harness.context);
    const handedOff = harness.read().handedOff;
    if (!handedOff) throw new Error('expected terminal persistence handoff');
    await handedOff;

    expect(observePersistedTurn).toHaveBeenCalledWith(expect.objectContaining({
      usedMemoryTool: true,
      responseVariant: 2,
    }));
  });

  it('keeps a saved response successful when the observer degrades', async () => {
    geminiOrganicMemoryExtractor.mockReturnValue(vi.fn());
    observePersistedTurn.mockRejectedValue(new Error('observer exploded unexpectedly'));
    const harness = makeContext(async () => undefined);
    const { state, completed } = completedGeneration();

    syncGenerationEvent(completed, state, harness.context);
    const handedOff = harness.read().handedOff;
    if (!handedOff) throw new Error('expected terminal persistence handoff');

    await expect(handedOff).resolves.toBeUndefined();
    expect(harness.read().conversation.messages.some((message) => message.role === 'assistant')).toBe(true);
  });
});
