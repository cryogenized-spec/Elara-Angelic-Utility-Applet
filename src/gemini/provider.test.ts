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
