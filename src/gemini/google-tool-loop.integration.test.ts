import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createInteraction, getGeminiApiKey, getGeminiLockboxStatus, GoogleGenAI } = vi.hoisted(() => ({
  createInteraction: vi.fn(),
  getGeminiApiKey: vi.fn(),
  getGeminiLockboxStatus: vi.fn(),
  GoogleGenAI: vi.fn(),
}));

vi.mock('@google/genai', () => ({ GoogleGenAI }));
vi.mock('../persistence/gemini-api-key', () => ({ getGeminiApiKey, getGeminiLockboxStatus }));

import { streamGoogleToolLoop } from './google-tool-loop';

async function* events(...items: unknown[]) {
  for (const item of items) yield item;
}

const oauth = {
  authorize: async (capability: string) => ({ capability: capability as never, fetch: async () => new Response('{}', { status: 200 }) }),
  getStatus: async () => ({ state: 'connected' as const, grantedCapabilities: ['gmail.read' as const], enabledCapabilities: ['gmail.read' as const], grantedProviderScopes: [] }),
  disconnect: async () => undefined,
};

describe('Gemini provider and Google tool-loop integration', () => {
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

  it('executes a zero-argument registered tool and completes its continuation', async () => {
    createInteraction
      .mockResolvedValueOnce(events(
        { event_type: 'interaction.created', interaction: { id: 'interaction-zero', model: 'gemini-3.8-flash' } },
        { event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'call-zero', name: 'gmail.listLabels' } },
        { event_type: 'step.stop', index: 0 },
        { event_type: 'interaction.requires_action', interaction_id: 'interaction-zero', status: 'requires_action' },
      ))
      .mockResolvedValueOnce(events(
        { event_type: 'interaction.created', interaction: { id: 'interaction-after-tool', model: 'gemini-3.8-flash' } },
        { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'You have no new labels.' } },
        { event_type: 'interaction.completed', interaction: { id: 'interaction-after-tool', status: 'completed' } },
      ));

    const handler = vi.fn(async ({ arguments: args }: { arguments: Readonly<Record<string, unknown>> }) => ({ labels: [], received: args }));
    const collected: unknown[] = [];
    for await (const event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'List my Gmail labels.', systemInstruction: 'You are Elara.', tools: ['gmail.listLabels'] },
      { tools: ['gmail.listLabels'], executor: { oauth, handlers: { 'gmail.listLabels': handler } } },
    )) collected.push(event);

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ arguments: {} }));
    expect(createInteraction).toHaveBeenCalledTimes(2);
    expect(createInteraction.mock.calls[1][0]).toMatchObject({
      previous_interaction_id: 'interaction-zero',
      input: [{
        type: 'function_result',
        name: 'gmail.listLabels',
        call_id: 'call-zero',
        result: [{ type: 'text', text: JSON.stringify({ labels: [], received: {} }) }],
      }],
    });
    expect(collected).toContainEqual(expect.objectContaining({ type: 'tool-call', callId: 'call-zero', name: 'gmail.listLabels', arguments: {} }));
    expect(collected).toContainEqual(expect.objectContaining({ type: 'completed', interactionId: 'interaction-after-tool' }));
    expect(collected.some((event) => (event as { type: string; error?: { message?: string } }).error?.message === 'Gemini closed the stream without completing the turn.')).toBe(false);
    expect(collected.some((event) => (event as { type: string }).type === 'failed')).toBe(false);
  });
});
