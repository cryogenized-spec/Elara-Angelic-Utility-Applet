import { beforeEach, describe, expect, it, vi } from 'vitest';

const { GoogleGenAI, create, getGeminiApiKey, composeSystemInstruction } = vi.hoisted(() => ({
  GoogleGenAI: vi.fn(),
  create: vi.fn(),
  getGeminiApiKey: vi.fn(),
  composeSystemInstruction: vi.fn(),
}));

vi.mock('@google/genai', () => ({ GoogleGenAI }));
vi.mock('../persistence/gemini-api-key', () => ({ getGeminiApiKey }));
vi.mock('./memory-context', () => ({ composeSystemInstruction }));

import { geminiTurnPort } from './provider';

async function* events(...items: unknown[]) {
  for (const item of items) yield item as never;
}

describe('geminiTurnPort', () => {
  beforeEach(() => {
    GoogleGenAI.mockReset();
    create.mockReset();
    getGeminiApiKey.mockReset();
    composeSystemInstruction.mockReset();
    getGeminiApiKey.mockResolvedValue('test-key');
    composeSystemInstruction.mockImplementation(async (instruction: string | undefined) => instruction);
    GoogleGenAI.mockImplementation(() => ({ interactions: { create } }));
  });

  it('constructs the SDK with the stable v1 API version and dispatches an interaction', async () => {
    create.mockResolvedValue(events(
      { event_type: 'interaction.created', interaction: { id: 'interaction-1', model: 'gemini-3.8-flash' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Hello.' } },
      { event_type: 'interaction.completed', interaction: { id: 'interaction-1', status: 'completed' } },
    ));

    const collected: unknown[] = [];
    for await (const event of geminiTurnPort.streamReply({
      model: 'gemini-3.8-flash',
      input: 'Hello',
      systemInstruction: 'You are Elara.',
      tools: [],
    })) collected.push(event);

    expect(GoogleGenAI).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'test-key',
      httpOptions: expect.objectContaining({
        apiVersion: 'v1',
        retryOptions: { attempts: 1 },
      }),
    }));
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.8-flash',
      input: 'Hello',
      system_instruction: 'You are Elara.',
      stream: true,
      store: true,
    }));
    expect(collected).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'interaction-created', interactionId: 'interaction-1' }),
      expect.objectContaining({ type: 'text-delta', text: 'Hello.' }),
      expect.objectContaining({ type: 'completed', interactionId: 'interaction-1' }),
    ]));
  });
});
