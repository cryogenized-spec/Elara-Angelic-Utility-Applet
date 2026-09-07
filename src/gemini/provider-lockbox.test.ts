import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createInteraction, GoogleGenAI } = vi.hoisted(() => ({
  createInteraction: vi.fn(),
  GoogleGenAI: vi.fn(),
}));

vi.mock('@google/genai', () => ({ GoogleGenAI }));

import { geminiTurnPort } from './provider';
import { clearGeminiApiKey, configureGeminiApiKeyWithPin, lockGeminiApiKey } from '../persistence/gemini-api-key';

const PIN = '284619';

async function collectReply(): Promise<unknown[]> {
  const collected: unknown[] = [];
  for await (const event of geminiTurnPort.streamReply({ model: 'gemini-3.8-flash', input: 'Hello while locked.' })) collected.push(event);
  return collected;
}

describe('Gemini provider and Lockbox boundary', () => {
  beforeEach(async () => {
    await clearGeminiApiKey();
    createInteraction.mockReset();
    GoogleGenAI.mockReset();
    GoogleGenAI.mockImplementation(function MockGoogleGenAI(this: { interactions: { create: typeof createInteraction } }) {
      this.interactions = { create: createInteraction };
    });
  });

  it('does not construct the SDK when a real PIN Lockbox session is locked', async () => {
    await configureGeminiApiKeyWithPin('test-gemini-key', PIN);
    lockGeminiApiKey();

    const collected = await collectReply();

    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({
      type: 'failed',
      error: {
        category: 'configuration',
        code: 'GEMINI_LOCKBOX_LOCKED',
        message: 'Gemini API key is locked in the app Lockbox. Unlock the Lockbox before sending.',
      },
    });
    expect(GoogleGenAI).not.toHaveBeenCalled();
    expect(createInteraction).not.toHaveBeenCalled();
  });
});
