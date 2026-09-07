import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createInteraction, getGeminiApiKey, getGeminiLockboxStatus, GoogleGenAI } = vi.hoisted(() => ({
  createInteraction: vi.fn(),
  getGeminiApiKey: vi.fn(),
  getGeminiLockboxStatus: vi.fn(),
  GoogleGenAI: vi.fn(),
}));

vi.mock('@google/genai', () => ({ GoogleGenAI }));
vi.mock('../persistence/gemini-api-key', () => ({ getGeminiApiKey, getGeminiLockboxStatus }));

import { geminiTurnPort } from './provider';

async function* events(...items: unknown[]) {
  for (const item of items) yield item;
}

describe('Gemini provider credential preflight', () => {
  beforeEach(() => {
    createInteraction.mockReset();
    getGeminiApiKey.mockReset();
    getGeminiLockboxStatus.mockReset();
    GoogleGenAI.mockReset();
    GoogleGenAI.mockImplementation(function MockGoogleGenAI(this: { interactions: { create: typeof createInteraction } }) {
      this.interactions = { create: createInteraction };
    });
  });

  it('fails before constructing the SDK when the Lockbox is empty', async () => {
    getGeminiLockboxStatus.mockResolvedValue('empty');

    const collected: unknown[] = [];
    for await (const event of geminiTurnPort.streamReply({ model: 'gemini-3.8-flash', input: 'Hello.' })) collected.push(event);

    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({
      type: 'failed',
      error: {
        category: 'configuration',
        code: 'GEMINI_CONFIGURATION',
        message: 'Gemini API key is not configured in the app Lockbox.',
        retryable: false,
      },
    });
    expect(getGeminiApiKey).not.toHaveBeenCalled();
    expect(GoogleGenAI).not.toHaveBeenCalled();
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('fails before constructing the SDK when the Lockbox is locked', async () => {
    getGeminiLockboxStatus.mockResolvedValue('locked');

    const collected: unknown[] = [];
    for await (const event of geminiTurnPort.streamReply({ model: 'gemini-3.8-flash', input: 'Hello while locked.' })) collected.push(event);

    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({
      type: 'failed',
      error: {
        category: 'configuration',
        code: 'GEMINI_LOCKBOX_LOCKED',
        message: 'Gemini API key is locked in the app Lockbox. Unlock the Lockbox before sending.',
        retryable: false,
      },
    });
    expect(getGeminiApiKey).not.toHaveBeenCalled();
    expect(GoogleGenAI).not.toHaveBeenCalled();
    expect(createInteraction).not.toHaveBeenCalled();
  });

  it('constructs the SDK and reaches interactions.create after an unlocked credential preflight', async () => {
    getGeminiLockboxStatus.mockResolvedValue('unlocked');
    getGeminiApiKey.mockResolvedValue('test-gemini-key');
    createInteraction.mockResolvedValue(events(
      { event_type: 'interaction.created', interaction: { id: 'interaction-1', model: 'gemini-3.8-flash' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Hello from Gemini.' } },
      { event_type: 'interaction.completed', interaction: { id: 'interaction-1', status: 'completed' } },
    ));

    const collected: unknown[] = [];
    for await (const event of geminiTurnPort.streamReply({ model: 'gemini-3.8-flash', input: 'Hello.' })) collected.push(event);

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-gemini-key',
      httpOptions: { apiVersion: 'v1', retryOptions: { attempts: 1 } },
    });
    expect(createInteraction).toHaveBeenCalledTimes(1);
    expect(createInteraction).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.8-flash',
      input: 'Hello.',
      stream: true,
      store: true,
    }));
    expect(collected).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'interaction-created', interactionId: 'interaction-1' }),
      expect.objectContaining({ type: 'text-delta', text: 'Hello from Gemini.' }),
      expect.objectContaining({ type: 'completed', interactionId: 'interaction-1' }),
    ]));
  });
});

describe('Gemini provider stream fidelity', () => {
  beforeEach(() => {
    createInteraction.mockReset();
    getGeminiApiKey.mockReset();
    getGeminiLockboxStatus.mockReset();
    GoogleGenAI.mockReset();
    GoogleGenAI.mockImplementation(function MockGoogleGenAI(this: { interactions: { create: typeof createInteraction } }) {
      this.interactions = { create: createInteraction };
    });
    getGeminiLockboxStatus.mockResolvedValue('unlocked');
    getGeminiApiKey.mockResolvedValue('test-gemini-key');
  });

  async function collect(items: unknown[]): Promise<unknown[]> {
    createInteraction.mockResolvedValue(events(...items));
    const collected: unknown[] = [];
    for await (const event of geminiTurnPort.streamReply({ model: 'gemini-3.8-flash', input: 'Hello.' })) collected.push(event);
    return collected;
  }

  it('preserves provider status and code from streamed SSE error events', async () => {
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-1', model: 'gemini-3.8-flash' } },
      { event_type: 'error', interaction_id: 'interaction-1', error: { message: 'Slow down.', status: 429, code: 'RESOURCE_EXHAUSTED' } },
    ]);

    expect(collected.at(-1)).toMatchObject({
      type: 'failed',
      error: {
        category: 'rate_limit',
        code: 'GEMINI_RATE_LIMIT',
        message: 'Slow down.',
        retryable: true,
        providerStatus: 429,
        providerCode: 'RESOURCE_EXHAUSTED',
        interactionId: 'interaction-1',
      },
    });
  });

  it('classifies a streamed 503 error event as a retryable provider failure', async () => {
    const collected = await collect([
      { event_type: 'error', error: { message: 'Service unavailable.', code: 503 } },
    ]);
    expect(collected.at(-1)).toMatchObject({
      type: 'failed',
      error: { category: 'provider', code: 'GEMINI_PROVIDER', providerStatus: 503, retryable: true },
    });
  });

  it('treats requires_action completion as a status update, not a terminal event', async () => {
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-1', model: 'gemini-3.8-flash' } },
      { event_type: 'interaction.completed', interaction: { id: 'interaction-1', status: 'requires_action' } },
    ]);
    expect(collected.at(-1)).toMatchObject({
      type: 'interaction-status',
      interactionId: 'interaction-1',
      status: 'requires_action',
    });
    expect(collected.some((event) => (event as { type: string }).type === 'completed')).toBe(false);
  });

  it('fails explicitly when the stream ends without interaction.completed', async () => {
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-1', model: 'gemini-3.8-flash' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Partial…' } },
    ]);
    expect(collected.at(-1)).toMatchObject({
      type: 'failed',
      error: { message: 'Gemini stream ended without an explicit interaction.completed event.' },
    });
  });

  it('streams thought-summary deltas and reports them on completion usage', async () => {
    const collected = await collect([
      { event_type: 'interaction.created', interaction: { id: 'interaction-1', model: 'gemini-3.8-flash' } },
      { event_type: 'step.start', index: 0, step: { type: 'thought' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'thought_summary', text: 'First thought. ' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'thought_summary', text: 'Second thought.' } },
      { event_type: 'step.stop', index: 0 },
      { event_type: 'interaction.completed', interaction: { id: 'interaction-1', status: 'completed', usage: { input_tokens: 12, output_tokens: 4 } } },
    ]);
    const deltas = collected.filter((event) => (event as { type: string }).type === 'thought-summary-delta');
    expect(deltas).toHaveLength(2);
    expect(collected.at(-1)).toMatchObject({
      type: 'completed',
      usage: { inputTokens: 12, outputTokens: 4, thoughtSummary: 'First thought. Second thought.' },
    });
  });
});
