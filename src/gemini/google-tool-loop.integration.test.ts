import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createInteraction, getGeminiApiKey, getGeminiLockboxStatus, GoogleGenAI, oauthFetch, oauthStatus } = vi.hoisted(() => ({
  createInteraction: vi.fn(),
  getGeminiApiKey: vi.fn(),
  getGeminiLockboxStatus: vi.fn(),
  GoogleGenAI: vi.fn(),
  oauthFetch: vi.fn(),
  oauthStatus: vi.fn(),
}));

vi.mock('@google/genai', () => ({ GoogleGenAI }));
vi.mock('../persistence/gemini-api-key', () => ({ getGeminiApiKey, getGeminiLockboxStatus }));
// Mock ONLY the OAuth authority (the network edge): the real executor, the
// real read-handler wrapper, and the real Gmail service run beneath the loop.
vi.mock('../google/oauth/authority', () => ({
  googleOAuthAuthority: {
    authorize: async (capability: string) => ({ capability, fetch: oauthFetch }),
    getStatus: oauthStatus,
    disconnect: async () => undefined,
  },
}));

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

  // HANDLER-EXECUTION PROOF (complements the admission/declaration proofs in
  // src/autonomy/tool-surface.test.ts): one real read tool executes through
  // the REAL executor, the REAL read-handler wrapper, and the REAL Gmail
  // service in the loop's read-only headless mode — only the network edge
  // (oauth.fetch) and the model provider are mocked.
  it('executes a real read tool through the real executor and service in read-only headless mode', async () => {
    oauthFetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ labels: [{ id: 'INBOX', name: 'INBOX' }, { id: 'TRASH', name: 'TRASH' }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    oauthStatus.mockReset().mockResolvedValue({ state: 'connected' as const, grantedCapabilities: ['gmail.read' as const], enabledCapabilities: ['gmail.read' as const], grantedProviderScopes: [] });

    createInteraction
      .mockResolvedValueOnce(events(
        { event_type: 'interaction.created', interaction: { id: 'interaction-readonly', model: 'gemini-3.8-flash' } },
        { event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'call-readonly', name: 'gmail.listLabels' } },
        { event_type: 'step.stop', index: 0 },
        { event_type: 'interaction.requires_action', interaction_id: 'interaction-readonly', status: 'requires_action' },
      ))
      .mockResolvedValueOnce(events(
        { event_type: 'interaction.created', interaction: { id: 'interaction-readonly-done', model: 'gemini-3.8-flash' } },
        { event_type: 'step.delta', index: 0, delta: { type: 'text', text: '{"outcome":"noop","reason":"labels checked"}' } },
        { event_type: 'interaction.completed', interaction: { id: 'interaction-readonly-done', status: 'completed' } },
      ));

    const collected: unknown[] = [];
    for await (const event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Run the routine.', systemInstruction: 'Routine instruction.', tools: ['gmail.listLabels'] },
      { tools: ['gmail.listLabels'], readOnly: true, headless: true },
    )) collected.push(event);

    // The REAL service executed exactly one Gmail labels call against the mocked network edge.
    expect(oauthFetch).toHaveBeenCalledTimes(1);
    expect(String((oauthFetch.mock.calls[0] as unknown[])[0])).toContain('gmail/v1/users/me/labels');
    // Its result flowed back to the provider as the tool continuation.
    expect(createInteraction).toHaveBeenCalledTimes(2);
    const continuation = createInteraction.mock.calls[1][0] as { input: Array<{ type: string; name: string; result: Array<{ text: string }> }> };
    expect(continuation.input[0]).toMatchObject({ type: 'function_result', name: 'gmail.listLabels' });
    expect(continuation.input[0].result[0].text).toContain('INBOX');
    expect(collected.at(-1)).toMatchObject({ type: 'completed', interactionId: 'interaction-readonly-done' });
    expect(collected.some((event) => (event as { type: string }).type === 'failed')).toBe(false);
  });
});
