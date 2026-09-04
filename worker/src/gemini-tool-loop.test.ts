import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createInteraction } = vi.hoisted(() => ({ createInteraction: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { interactions = { create: createInteraction }; } }));

import worker from './index';

const env = { GEMINI_API_KEY: 'test-key', ALLOWED_ORIGINS: 'https://cryogenized-spec.github.io' };

async function* eventStream(...items: unknown[]) { for (const item of items) yield item; }

async function parseSse(response: Response): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const text = await response.text();
  return text.trim().split('\n\n').filter(Boolean).map((block) => {
    const lines = block.split('\n');
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? '';
    const data = lines.find((line) => line.startsWith('data:'))?.slice(5) ?? '{}';
    return { event, data: JSON.parse(data) as Record<string, unknown> };
  });
}

describe('Gemini registered tool loop', () => {
  beforeEach(() => createInteraction.mockReset());

  it('accumulates function-call argument deltas and pauses for the tool result', async () => {
    createInteraction.mockResolvedValueOnce(eventStream(
      { event_type: 'interaction.created', interaction: { id: 'interaction-1', model: 'gemini-3.8-flash' } },
      { event_type: 'step.start', step: { index: 0, id: 'call-1', name: 'calendar.listEvents', type: 'function_call' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '{"timeMin":"2026-09-04T00:00:00Z",' } },
      { event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '"timeMax":"2026-09-04T23:59:59Z"}' } },
      { event_type: 'step.stop', index: 0 },
      { event_type: 'interaction.requires_action', interaction_id: 'interaction-1', status: 'requires_action' },
    ));

    const response = await worker.fetch(new Request('https://worker.example/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://cryogenized-spec.github.io' },
      body: JSON.stringify({ model: 'gemini-3.8-flash', input: 'Show my calendar today.', tools: ['calendar.listEvents'] }),
    }), env);

    const events = await parseSse(response);
    const call = events.find((item) => item.event === 'tool-call');
    expect(response.status).toBe(200);
    expect(call?.data).toEqual(expect.objectContaining({ call_id: 'call-1', name: 'calendar.listEvents', arguments: { timeMin: '2026-09-04T00:00:00Z', timeMax: '2026-09-04T23:59:59Z' } }));
    expect(events.some((item) => item.event === 'interaction.requires_action')).toBe(true);
    expect(createInteraction).toHaveBeenCalledWith(expect.objectContaining({ tools: [expect.objectContaining({ type: 'function', name: 'calendar.listEvents' })] }));
  });

  it('continues an interaction from a registered tool result', async () => {
    createInteraction.mockResolvedValueOnce(eventStream(
      { event_type: 'interaction.created', interaction: { id: 'interaction-2', model: 'gemini-3.8-flash' } },
      { event_type: 'interaction.completed', interaction: { id: 'interaction-2', status: 'completed' } },
    ));

    const response = await worker.fetch(new Request('https://worker.example/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://cryogenized-spec.github.io' },
      body: JSON.stringify({
        model: 'gemini-3.8-flash',
        previousInteractionId: 'interaction-1',
        tools: ['calendar.listEvents'],
        toolResult: { callId: 'call-1', name: 'calendar.listEvents', result: { events: [] } },
      }),
    }), env);

    expect(response.status).toBe(200);
    expect(createInteraction).toHaveBeenCalledWith(expect.objectContaining({
      previous_interaction_id: 'interaction-1',
      input: [{ type: 'function_result', name: 'calendar.listEvents', call_id: 'call-1' }],
    }));
  });

  it('rejects an unregistered tool before Gemini is called', async () => {
    const response = await worker.fetch(new Request('https://worker.example/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://cryogenized-spec.github.io' },
      body: JSON.stringify({ model: 'gemini-3.8-flash', input: 'Do it.', tools: ['not.a.real.tool'] }),
    }), env);

    expect(response.status).toBe(400);
    expect(createInteraction).not.toHaveBeenCalled();
  });
});
