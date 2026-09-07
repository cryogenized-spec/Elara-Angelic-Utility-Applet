import { describe, expect, it } from 'vitest';
import type { ChatMessage, ConversationState, ProviderStatus } from '../domain/chat';
import type { GeminiStreamEvent } from '../gemini/contracts';
import type { NormalizedProviderError } from '../gemini/errors';
import { applyGenerationEvent, createGenerationState, type GenerationState } from './generation-state';
import { syncGenerationEvent, type GenerationSyncContext } from './generation-sync';

const BASE_TIME = 1_000_000;

function makeMessage(role: ChatMessage['role'], text: string): ChatMessage {
  return { id: `${role}-1`, role, text, createdAt: BASE_TIME, conversationId: 'thread-1' };
}

function createHarness(options: { current?: boolean; supersedesGenerationId?: string } = {}) {
  const userMessage = makeMessage('user', 'What is on my calendar?');
  const base: ConversationState = {
    id: 'thread-1',
    title: 'Calendar',
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    messages: [userMessage],
  };
  const assistantMessage = makeMessage('assistant', '');
  let conversation = base;
  let status: ProviderStatus = 'streaming';
  let error: string | null = null;
  let structured: NormalizedProviderError | null = null;
  const saved: ConversationState[] = [];
  const streamFailed = { value: false };
  const context: GenerationSyncContext = {
    assistantMessage,
    base,
    model: 'gemini-3.8-flash',
    wallStartedAt: BASE_TIME,
    supersedesGenerationId: options.supersedesGenerationId,
    setConversation: (updater) => {
      conversation = typeof updater === 'function' ? updater(conversation) : updater;
    },
    setStatus: (next) => {
      status = next;
    },
    setError: (next) => {
      error = next;
    },
    setStructuredError: (next) => {
      structured = next;
    },
    save: async (next) => {
      saved.push(next);
    },
    refreshThreads: async () => undefined,
    isCurrentConversation: () => options.current ?? true,
    ensureAssistant: () => undefined,
    streamFailed,
  };
  return { context, base, read: () => ({ conversation, status, error, structured, saved, streamFailed: streamFailed.value }) };
}

function runTurn(
  context: GenerationSyncContext,
  events: GeminiStreamEvent[],
  generationId = 'gen-1',
): GenerationState {
  let generation = createGenerationState(generationId, { startedAt: 0 });
  events.forEach((event, position) => {
    generation = applyGenerationEvent(generation, { generationId, event, receivedAt: (position + 1) * 10 });
    syncGenerationEvent(event, generation, context);
  });
  return generation;
}

const COMPLETED = (interactionId: string): GeminiStreamEvent => ({
  type: 'completed',
  interactionId,
  status: 'completed',
  durationMs: 50,
  usage: { inputTokens: 11, outputTokens: 7 },
});

describe('generation sync: one-assistant-message invariant', () => {
  it('folds many text deltas into exactly one assistant message', async () => {
    const harness = createHarness();
    runTurn(harness.context, [
      { type: 'interaction-created', interactionId: 'i-1', model: 'gemini-3.8-flash' },
      { type: 'text-delta', index: 0, text: 'a' },
      { type: 'text-delta', index: 0, text: 'b' },
      { type: 'text-delta', index: 0, text: 'c' },
      COMPLETED('i-1'),
    ]);
    await Promise.resolve();

    const { conversation, saved } = harness.read();
    const assistants = conversation.messages.filter((message) => message.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0].text).toBe('abc');
    expect(saved).toHaveLength(1);
    expect(saved[0].messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
  });

  it('persists pre- and post-tool text as one ordered transcript with one record', async () => {
    const harness = createHarness();
    const generation = runTurn(
      harness.context,
      [
        { type: 'interaction-created', interactionId: 'i-1', model: 'gemini-3.8-flash' },
        { type: 'step-start', index: 0, stepType: 'thought' },
        { type: 'thought-summary-delta', index: 0, text: 'Checking the calendar first.' },
        { type: 'step-stop', index: 0 },
        { type: 'text-delta', index: 1, text: 'One moment while I check. ' },
        { type: 'step-start', index: 2, stepType: 'function_call' },
        { type: 'tool-call', interactionId: 'i-1', index: 2, callId: 'call-1', name: 'calendar.listEvents', arguments: {} },
        { type: 'step-stop', index: 2 },
        // Tool continuation: same generation, new interaction. Nothing resets.
        { type: 'interaction-created', interactionId: 'i-2', model: 'gemini-3.8-flash' },
        { type: 'text-delta', index: 0, text: 'You have a design review at 10.' },
        COMPLETED('i-2'),
      ],
      'gen-continuation',
    );
    await Promise.resolve();

    expect(generation.interactionIds).toEqual(['i-1', 'i-2']);
    const { conversation, saved } = harness.read();
    const assistants = conversation.messages.filter((message) => message.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0].text).toBe('One moment while I check. You have a design review at 10.');
    expect(saved).toHaveLength(1);

    const persisted = saved[0].messages.find((message) => message.role === 'assistant');
    expect(persisted?.text).toBe('One moment while I check. You have a design review at 10.');
    expect(persisted?.providerTurn).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      interactionId: 'i-2',
      generationId: 'gen-continuation',
    });
    expect(persisted?.providerTurn?.usage).toMatchObject({
      inputTokens: 11,
      outputTokens: 7,
      thoughtSummary: 'Checking the calendar first.',
    });
    expect(persisted?.executionSummary?.steps.join(' | ')).toContain('Tool calendar.listEvents');
  });

  it('records the superseded generation on regeneration-style turns', async () => {
    const harness = createHarness({ supersedesGenerationId: 'gen-previous' });
    runTurn(harness.context, [{ type: 'text-delta', index: 0, text: 'Fresh answer.' }, COMPLETED('i-9')], 'gen-next');
    await Promise.resolve();
    const persisted = harness.read().saved[0].messages.find((message) => message.role === 'assistant');
    expect(persisted?.providerTurn).toMatchObject({ generationId: 'gen-next', supersedesGenerationId: 'gen-previous' });
  });

  it('restores the exact pre-turn state on cancellation and persists nothing', () => {
    const harness = createHarness();
    runTurn(harness.context, [
      { type: 'interaction-created', interactionId: 'i-1', model: 'gemini-3.8-flash' },
      { type: 'text-delta', index: 0, text: 'Partial…' },
      { type: 'cancelled', interactionId: 'i-1' },
    ]);

    const { conversation, status, error, structured, saved, streamFailed } = harness.read();
    expect(conversation).toEqual(harness.base);
    expect(conversation.messages.some((message) => message.role === 'assistant')).toBe(false);
    expect(status).toBe('idle');
    expect(error).toBeNull();
    expect(structured).toBeNull();
    expect(saved).toHaveLength(0);
    expect(streamFailed).toBe(false);
  });

  it('keeps structured failures with code, status, and retryability', () => {
    const harness = createHarness();
    runTurn(harness.context, [
      { type: 'interaction-created', interactionId: 'i-1', model: 'gemini-3.8-flash' },
      {
        type: 'failed',
        error: {
          category: 'rate_limit',
          code: 'GEMINI_RATE_LIMIT',
          message: 'Slow down.',
          retryable: true,
          cancelled: false,
          providerStatus: 429,
          providerCode: 'RESOURCE_EXHAUSTED',
          debug: {},
        },
      },
    ]);

    const { status, error, structured, saved, streamFailed } = harness.read();
    expect(status).toBe('failed');
    expect(error).toBe('[GEMINI_RATE_LIMIT] Slow down.');
    expect(structured).toMatchObject({ providerStatus: 429, providerCode: 'RESOURCE_EXHAUSTED', retryable: true });
    expect(saved).toHaveLength(0);
    expect(streamFailed).toBe(true);
  });

  it('ignores terminal outcomes for conversations the user already left', () => {
    const harness = createHarness({ current: false });
    runTurn(harness.context, [
      {
        type: 'failed',
        error: {
          category: 'provider',
          code: 'GEMINI_PROVIDER',
          message: 'Boom.',
          retryable: true,
          cancelled: false,
          debug: {},
        },
      },
    ]);
    const { status, error } = harness.read();
    expect(status).toBe('streaming');
    expect(error).toBeNull();
  });
});
