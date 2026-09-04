import { describe, expect, it, vi } from 'vitest';

const { streamReply, streamToolResult } = vi.hoisted(() => ({
  streamReply: vi.fn(),
  streamToolResult: vi.fn(),
}));

vi.mock('./provider', () => ({
  geminiTurnPort: { streamReply, streamToolResult },
}));

import { streamGoogleToolLoop } from './google-tool-loop';

async function* events(...items: Array<Awaited<ReturnType<typeof Promise.resolve>>>) {
  for (const item of items) yield item as never;
}

const oauth = {
  authorize: async (capability: string) => ({ capability: capability as never, fetch: async () => new Response('{}', { status: 200 }) }),
  getStatus: async () => ({ state: 'connected' as const, grantedCapabilities: ['calendar.events.read' as const] }),
  disconnect: async () => undefined,
};

describe('streamGoogleToolLoop', () => {
  it('executes a registered read tool and resumes the interaction with its result', async () => {
    const handler = vi.fn(async ({ arguments: args }) => ({ events: [{ summary: 'Design review', ...args }] }));
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction-1', model: 'gemini-3.8-flash' },
      { type: 'tool-call', interactionId: 'interaction-1', index: 0, callId: 'call-1', name: 'calendar.listEvents', arguments: { calendarId: 'primary' } },
    ));
    streamToolResult.mockReturnValueOnce(events(
      { type: 'text-delta', index: 1, text: 'You have a design review.' },
      { type: 'completed', interactionId: 'interaction-2', status: 'completed', durationMs: 12 },
    ));

    const collected: Array<unknown> = [];
    for await (const event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Show my calendar.' },
      { tools: ['calendar.listEvents'], executor: { oauth, handlers: { 'calendar.listEvents': handler } } },
    )) collected.push(event);

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ arguments: { calendarId: 'primary' } }));
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.8-flash',
      previousInteractionId: 'interaction-1',
      result: expect.objectContaining({ callId: 'call-1', name: 'calendar.listEvents', result: { events: [{ summary: 'Design review', calendarId: 'primary' }] } }),
      tools: ['calendar.listEvents'],
    }), undefined);
    expect(collected).toHaveLength(4);
    expect(collected[2]).toMatchObject({ type: 'text-delta', text: 'You have a design review.' });
    expect(collected[3]).toMatchObject({ type: 'completed', interactionId: 'interaction-2' });
  });

  it('never permits a write tool through the default read-only loop', async () => {
    await expect(streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Change something.', tools: ['tasks.createTask'] },
      { executor: { oauth, handlers: {} } },
    )).rejects.toThrow('not permitted in read-only mode');
    expect(streamReply).not.toHaveBeenCalled();
  });
});
