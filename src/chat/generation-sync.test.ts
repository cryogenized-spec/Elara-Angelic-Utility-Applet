import { describe, expect, it } from 'vitest';
import type { ChatMessage, ConversationState, ProviderStatus } from '../domain/chat';
import type { GeminiStreamEvent } from '../gemini/contracts';
import type { NormalizedProviderError } from '../gemini/errors';
import { applyGenerationEvent, createGenerationState, type GenerationState } from './generation-state';
import {
  canRetryFailedTurn,
  createGenerationArbiter,
  dispatchGenerationEvent,
  syncGenerationEvent,
  type FailedTurnAttempt,
  type GenerationSyncContext,
} from './generation-sync';

const BASE_TIME = 1_000_000;

function makeMessage(role: ChatMessage['role'], text: string): ChatMessage {
  return { id: `${role}-1`, role, text, createdAt: BASE_TIME, conversationId: 'thread-1' };
}

function createHarness(
  options: {
    active?: boolean;
    supersedesGenerationId?: string;
    input?: string;
    base?: ConversationState;
    assistantMessage?: ChatMessage;
    onFailedAttempt?: (attempt: FailedTurnAttempt) => void;
  } = {},
) {
  const userMessage = makeMessage('user', 'What is on my calendar?');
  const base: ConversationState = options.base ?? {
    id: 'thread-1',
    title: 'Calendar',
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    messages: [userMessage],
  };
  const assistantMessage = options.assistantMessage ?? makeMessage('assistant', '');
  let conversation = base;
  let status: ProviderStatus = 'streaming';
  let error: string | null = null;
  let structured: NormalizedProviderError | null = null;
  const saved: ConversationState[] = [];
  const streamFailed = { value: false };
  const context: GenerationSyncContext = {
    assistantMessage,
    base,
    input: options.input ?? 'What is on my calendar?',
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
    isActiveGeneration: () => options.active ?? true,
    ensureAssistant: () => undefined,
    streamFailed,
    onFailedAttempt: options.onFailedAttempt,
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

  it('captures the failed attempt so a retry can replace it', () => {
    const box: { attempt: FailedTurnAttempt | null } = { attempt: null };
    const assistantMessage: ChatMessage = { ...makeMessage('assistant', ''), responseGroupId: 'group-1', responseVariant: 2 };
    const harness = createHarness({ input: 'Original prompt.', assistantMessage, onFailedAttempt: (attempt) => { box.attempt = attempt; } });
    runTurn(
      harness.context,
      [
        { type: 'text-delta', index: 0, text: 'abc' },
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
      ],
      'gen-failed',
    );

    const captured = box.attempt;
    if (!captured) throw new Error('expected the failed attempt to be captured');
    expect(captured.generationId).toBe('gen-failed');
    expect(captured.base).toBe(harness.base);
    expect(captured.base.messages.some((message) => message.role === 'assistant')).toBe(false);
    expect(captured.input).toBe('Original prompt.');
    expect(captured.responseGroupId).toBe('group-1');
    expect(captured.responseVariant).toBe(2);
  });

  it('retries a partially streamed failure as one replaced answer, not two', async () => {
    const box: { attempt: FailedTurnAttempt | null } = { attempt: null };
    const firstTurn = createHarness({ input: 'Tell me a story.', onFailedAttempt: (attempt) => { box.attempt = attempt; } });
    runTurn(
      firstTurn.context,
      [
        { type: 'interaction-created', interactionId: 'i-1', model: 'gemini-3.8-flash' },
        { type: 'text-delta', index: 0, text: 'abc' },
        {
          type: 'failed',
          error: {
            category: 'provider',
            code: 'GEMINI_PROVIDER',
            message: 'Mid-stream failure.',
            retryable: true,
            cancelled: false,
            debug: {},
          },
        },
      ],
      'gen-1',
    );
    expect(firstTurn.read().conversation.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    const captured = box.attempt;
    if (!captured) throw new Error('expected the failed attempt to be captured');

    // Retry streams from the failed attempt's pre-generation base.
    const retryTurn = createHarness({
      base: captured.base,
      supersedesGenerationId: captured.generationId,
      input: captured.input,
    });
    runTurn(
      retryTurn.context,
      [
        { type: 'interaction-created', interactionId: 'i-2', model: 'gemini-3.8-flash' },
        { type: 'text-delta', index: 0, text: 'def' },
        COMPLETED('i-2'),
      ],
      'gen-2',
    );
    await Promise.resolve();

    const { conversation, saved } = retryTurn.read();
    const assistants = conversation.messages.filter((message) => message.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0].text).toBe('def');
    expect(saved).toHaveLength(1);
    expect(saved[0].messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    expect(saved[0].messages.find((message) => message.role === 'assistant')?.providerTurn).toMatchObject({
      generationId: 'gen-2',
      supersedesGenerationId: 'gen-1',
    });
  });

  it('ignores terminal outcomes for conversations the user already left', () => {
    const harness = createHarness({ active: false });
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

describe('canRetryFailedTurn', () => {
  const base: ConversationState = {
    id: 'thread-1',
    title: 'Retry',
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    messages: [{ id: 'user-1', role: 'user', text: 'Hello.', createdAt: BASE_TIME, conversationId: 'thread-1' }],
  };
  const attempt: FailedTurnAttempt = { generationId: 'gen-1', base, input: 'Hello.' };

  it('allows retry for a failed turn on the current thread', () => {
    expect(canRetryFailedTurn('failed', attempt, 'thread-1')).toBe(true);
  });

  it('refuses retry while streaming, when idle, without an attempt, or on another thread', () => {
    expect(canRetryFailedTurn('streaming', attempt, 'thread-1')).toBe(false);
    expect(canRetryFailedTurn('idle', attempt, 'thread-1')).toBe(false);
    expect(canRetryFailedTurn('failed', null, 'thread-1')).toBe(false);
    expect(canRetryFailedTurn('failed', attempt, 'thread-2')).toBe(false);
  });

  it('refuses retry when the failed turn had no input to re-run', () => {
    expect(canRetryFailedTurn('failed', { ...attempt, input: '   ' }, 'thread-1')).toBe(false);
  });
});

describe('cross-generation arbitration', () => {
  it('rejects late events from a superseded runner: conversation, error, retry, and persistence stay untouched', async () => {
    // One shared application store, two independent turn runners.
    const base: ConversationState = {
      id: 'thread-1',
      title: 'Arbitration',
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
      messages: [{ id: 'user-1', role: 'user', text: 'Hello.', createdAt: BASE_TIME, conversationId: 'thread-1' }],
    };
    let conversation = base;
    let status: ProviderStatus = 'streaming';
    let error: string | null = null;
    const saved: ConversationState[] = [];
    const attempts: FailedTurnAttempt[] = [];
    const arbiter = createGenerationArbiter();

    const makeContext = (generationId: string, assistantMessage: ChatMessage): GenerationSyncContext => ({
      assistantMessage,
      base,
      input: 'Hello.',
      model: 'gemini-3.8-flash',
      wallStartedAt: BASE_TIME,
      setConversation: (updater) => {
        conversation = typeof updater === 'function' ? updater(conversation) : updater;
      },
      setStatus: (next) => {
        status = next;
      },
      setError: (next) => {
        error = next;
      },
      setStructuredError: () => undefined,
      save: async (next) => {
        saved.push(next);
      },
      refreshThreads: async () => undefined,
      isActiveGeneration: () => arbiter.isActive(generationId),
      ensureAssistant: () => undefined,
      streamFailed: { value: false },
      onFailedAttempt: (attempt) => {
        attempts.push(attempt);
      },
    });
    const contextA = makeContext('gen-A', makeMessage('assistant', ''));
    const contextB = makeContext('gen-B', makeMessage('assistant', ''));

    // Generation A starts and streams partial text.
    arbiter.activate('gen-A');
    let genA = createGenerationState('gen-A', { startedAt: 0 });
    genA = dispatchGenerationEvent(genA, { generationId: 'gen-A', event: { type: 'text-delta', index: 0, text: 'old' }, receivedAt: 10 }, contextA);
    expect(conversation.messages.filter((message) => message.role === 'assistant').map((message) => message.text)).toEqual(['old']);

    // Generation B supersedes A: restores the pre-turn base, streams, completes.
    arbiter.activate('gen-B');
    conversation = base;
    let genB = createGenerationState('gen-B', { startedAt: 0 });
    genB = dispatchGenerationEvent(genB, { generationId: 'gen-B', event: { type: 'text-delta', index: 0, text: 'new' }, receivedAt: 20 }, contextB);
    genB = dispatchGenerationEvent(genB, { generationId: 'gen-B', event: COMPLETED('i-B'), receivedAt: 30 }, contextB);
    expect(genB.phase).toBe('completed');
    await Promise.resolve();
    expect(conversation.messages.filter((message) => message.role === 'assistant').map((message) => message.text)).toEqual(['new']);
    expect(saved).toHaveLength(1);

    // Late events from the obsolete runner change nothing: not the visible
    // transcript, not status/error, not retry state, not persistence.
    const snapshot = JSON.stringify({ conversation, status, error });
    genA = dispatchGenerationEvent(genA, { generationId: 'gen-A', event: { type: 'text-delta', index: 0, text: 'STALE' }, receivedAt: 30 }, contextA);
    expect(genA.transcript).toBe('oldSTALE');
    genA = dispatchGenerationEvent(
      genA,
      {
        generationId: 'gen-A',
        event: {
          type: 'failed',
          error: { category: 'provider', code: 'GEMINI_PROVIDER', message: 'Stale failure.', retryable: true, cancelled: false, debug: {} },
        },
        receivedAt: 40,
      },
      contextA,
    );
    genA = dispatchGenerationEvent(genA, { generationId: 'gen-A', event: COMPLETED('i-A-late'), receivedAt: 50 }, contextA);
    genA = dispatchGenerationEvent(genA, { generationId: 'gen-A', event: { type: 'cancelled' }, receivedAt: 60 }, contextA);
    expect(genA.phase).toBe('failed');
    await Promise.resolve();

    expect(JSON.stringify({ conversation, status, error })).toBe(snapshot);
    expect(conversation.messages.filter((message) => message.role === 'assistant').map((message) => message.text)).toEqual(['new']);
    expect(saved).toHaveLength(1);
    expect(attempts).toHaveLength(0);
    expect(error).toBeNull();
  });

  it('skips application sync for events the reducer ignores (post-terminal)', () => {
    const harness = createHarness();
    let generation = createGenerationState('gen-1', { startedAt: 0 });
    generation = dispatchGenerationEvent(generation, { generationId: 'gen-1', event: { type: 'text-delta', index: 0, text: 'Hi.' }, receivedAt: 10 }, harness.context);
    generation = dispatchGenerationEvent(generation, { generationId: 'gen-1', event: COMPLETED('i-1'), receivedAt: 20 }, harness.context);
    expect(generation.phase).toBe('completed');

    // A late abort-induced cancelled must not revert the completed turn.
    const before = JSON.stringify(harness.read().conversation);
    const after = dispatchGenerationEvent(generation, { generationId: 'gen-1', event: { type: 'cancelled' }, receivedAt: 30 }, harness.context);
    expect(after).toBe(generation);
    expect(JSON.stringify(harness.read().conversation)).toBe(before);
  });
});
