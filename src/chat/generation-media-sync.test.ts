import { describe, expect, it } from 'vitest';
import type { ChatMessage, ConversationState, ProviderStatus } from '../domain/chat';
import type { MediaItem } from '../domain/media';
import type { GeminiStreamEvent } from '../gemini/contracts';
import type { NormalizedProviderError } from '../gemini/errors';
import { applyGenerationEvent, createGenerationState, type GenerationState } from './generation-state';
import { syncGenerationEvent, type GenerationSyncContext } from './generation-sync';

const BASE_TIME = 1_000_000;

const VIDEO: MediaItem = {
  provider: 'youtube',
  id: 'video-1',
  kind: 'video',
  title: 'Test video',
  channel: 'Test channel',
  webUrl: 'https://www.youtube.com/watch?v=video-1',
  embedUrl: 'https://www.youtube-nocookie.com/embed/video-1?autoplay=0',
};

function harness(active = true) {
  const base: ConversationState = {
    id: 'thread-1',
    title: 'Media',
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    messages: [{ id: 'user-1', role: 'user', text: 'Find this.', createdAt: BASE_TIME, conversationId: 'thread-1' }],
  };
  const assistantMessage: ChatMessage = {
    id: 'assistant-1',
    role: 'assistant',
    text: '',
    createdAt: BASE_TIME + 1,
    conversationId: 'thread-1',
  };
  let conversation = base;
  let status: ProviderStatus = 'streaming';
  let error: string | null = null;
  let structuredError: NormalizedProviderError | null = null;
  const saved: ConversationState[] = [];
  const terminalPersistence: Promise<void>[] = [];
  const context: GenerationSyncContext = {
    assistantMessage,
    base,
    input: 'Find this.',
    model: 'gemini-3.8-flash',
    wallStartedAt: BASE_TIME,
    setConversation: (updater) => {
      conversation = typeof updater === 'function' ? updater(conversation) : updater;
    },
    setStatus: (next) => { status = next; },
    setError: (next) => { error = next; },
    setStructuredError: (next) => { structuredError = next; },
    save: async (next) => { saved.push(next); },
    onTerminalPersistence: (pending) => { terminalPersistence.push(pending); },
    isActiveGeneration: () => active,
    ensureAssistant: () => undefined,
  };
  return {
    base,
    context,
    read: () => ({ conversation, status, error, structuredError, saved, terminalPersistence }),
  };
}

function dispatch(state: GenerationState, event: GeminiStreamEvent, context: GenerationSyncContext, receivedAt: number): GenerationState {
  const next = applyGenerationEvent(state, { generationId: state.generationId, event, receivedAt });
  syncGenerationEvent(event, next, context);
  return next;
}

describe('live structured-content projection', () => {
  it('projects media immediately before any text or terminal event', () => {
    const run = harness();
    let state = createGenerationState('gen-media', { startedAt: 0 });
    state = dispatch(state, { type: 'media-resolved', provider: 'youtube', queries: ['test'], items: [VIDEO] }, run.context, 10);

    const assistant = run.read().conversation.messages.find((message) => message.role === 'assistant');
    expect(assistant?.text).toBe('');
    expect(assistant?.media).toEqual([VIDEO]);
    expect(run.read().saved).toHaveLength(0);
    expect(run.read().terminalPersistence).toHaveLength(0);
  });

  it('keeps already-resolved media when later text deltas arrive', () => {
    const run = harness();
    let state = createGenerationState('gen-media-text', { startedAt: 0 });
    state = dispatch(state, { type: 'media-resolved', provider: 'youtube', queries: ['test'], items: [VIDEO] }, run.context, 10);
    state = dispatch(state, { type: 'text-delta', index: 0, text: 'Here it is.' }, run.context, 20);

    const assistant = run.read().conversation.messages.find((message) => message.role === 'assistant');
    expect(assistant?.text).toBe('Here it is.');
    expect(assistant?.media).toEqual([VIDEO]);
  });

  it('projects artifacts and media through the same optimistic assistant', () => {
    const run = harness();
    let state = createGenerationState('gen-structured', { startedAt: 0 });
    state = dispatch(state, { type: 'artifact-created', artifactId: 'artifact-1', status: 'ready', mimeType: 'application/pdf' }, run.context, 10);
    state = dispatch(state, { type: 'media-resolved', provider: 'youtube', queries: ['test'], items: [VIDEO] }, run.context, 20);

    const assistant = run.read().conversation.messages.find((message) => message.role === 'assistant');
    expect(assistant?.artifacts).toEqual(['artifact-1']);
    expect(assistant?.media).toEqual([VIDEO]);
    expect(run.read().saved).toHaveLength(0);
  });

  it('rolls live structured content back to the exact base on cancellation', () => {
    const run = harness();
    let state = createGenerationState('gen-cancel', { startedAt: 0 });
    state = dispatch(state, { type: 'media-resolved', provider: 'youtube', queries: ['test'], items: [VIDEO] }, run.context, 10);
    state = dispatch(state, { type: 'cancelled', interactionId: 'i-1' }, run.context, 20);

    expect(run.read().conversation).toEqual(run.base);
    expect(run.read().saved).toHaveLength(0);
    expect(run.read().terminalPersistence).toHaveLength(0);
  });

  it('leaves a failed partial structured assistant visible but never durable', () => {
    const run = harness();
    let state = createGenerationState('gen-fail', { startedAt: 0 });
    state = dispatch(state, { type: 'media-resolved', provider: 'youtube', queries: ['test'], items: [VIDEO] }, run.context, 10);
    state = dispatch(state, {
      type: 'failed',
      error: {
        category: 'provider',
        code: 'GEMINI_PROVIDER',
        message: 'Continuation failed.',
        retryable: true,
        cancelled: false,
        debug: {},
      },
    }, run.context, 20);

    const assistant = run.read().conversation.messages.find((message) => message.role === 'assistant');
    expect(assistant?.media).toEqual([VIDEO]);
    expect(run.read().status).toBe('failed');
    expect(run.read().saved).toHaveLength(0);
    expect(run.read().terminalPersistence).toHaveLength(0);
  });

  it('does not project stale structured events after generation ownership is lost', () => {
    const run = harness(false);
    let state = createGenerationState('gen-stale', { startedAt: 0 });
    state = dispatch(state, { type: 'media-resolved', provider: 'youtube', queries: ['test'], items: [VIDEO] }, run.context, 10);

    expect(run.read().conversation).toEqual(run.base);
  });
});
