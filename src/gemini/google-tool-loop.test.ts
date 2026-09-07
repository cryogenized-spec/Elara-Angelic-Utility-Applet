import { beforeEach, describe, expect, it, vi } from 'vitest';

const { streamReply, streamToolResult } = vi.hoisted(() => ({
  streamReply: vi.fn(),
  streamToolResult: vi.fn(),
}));

vi.mock('./provider', () => ({
  geminiTurnPort: { streamReply, streamToolResult },
}));

import { streamGoogleToolLoop } from './google-tool-loop';

async function* events(...items: unknown[]) {
  for (const item of items) yield item as never;
}

const oauth = {
  authorize: async (capability: string) => ({ capability: capability as never, fetch: async () => new Response('{}', { status: 200 }) }),
  getStatus: async () => ({ state: 'connected' as const, grantedCapabilities: ['calendar.events.read' as const, 'calendar.events.write' as const, 'tasks.write' as const] }),
  disconnect: async () => undefined,
};

const systemInstruction = 'You are Elara, an angelic synthetic cybernetic woman and consort.';

describe('streamGoogleToolLoop', () => {
  beforeEach(() => {
    streamReply.mockReset();
    streamToolResult.mockReset();
  });

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
      { model: 'gemini-3.8-flash', input: 'Show my calendar.', systemInstruction },
      { tools: ['calendar.listEvents'], executor: { oauth, handlers: { 'calendar.listEvents': handler } } },
    )) collected.push(event);

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ arguments: { calendarId: 'primary' } }));
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.8-flash',
      previousInteractionId: 'interaction-1',
      systemInstruction: expect.stringContaining(systemInstruction),
      result: expect.objectContaining({ callId: 'call-1', name: 'calendar.listEvents', result: { events: [{ summary: 'Design review', calendarId: 'primary' }] } }),
      tools: ['calendar.listEvents'],
    }), undefined);
    expect(collected).toHaveLength(4);
    expect(collected[2]).toMatchObject({ type: 'text-delta', text: 'You have a design review.' });
    expect(collected[3]).toMatchObject({ type: 'completed', interactionId: 'interaction-2' });
  });

  it('never permits a write tool through the default read-only loop', async () => {
    const consume = async () => {
      for await (const _event of streamGoogleToolLoop(
        { model: 'gemini-3.8-flash', input: 'Change something.', systemInstruction, tools: ['tasks.createTask'] },
        { executor: { oauth, handlers: {} } },
      )) {
        // The generator should reject before contacting Gemini.
      }
    };

    await expect(consume()).rejects.toThrow('not permitted in read-only mode');
    expect(streamReply).not.toHaveBeenCalled();
  });

  it('routes a Google write through explicit confirmation before the handler executes', async () => {
    const handler = vi.fn(async () => ({ id: 'task-1' }));
    const confirm = vi.fn(async (request) => request.risk === 'write');
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction-write-1', model: 'gemini-3.8-flash' },
      { type: 'tool-call', interactionId: 'interaction-write-1', index: 0, callId: 'call-write-1', name: 'tasks.createTask', arguments: { taskListId: 'primary', task: { title: 'Buy milk' } } },
    ));
    streamToolResult.mockReturnValueOnce(events(
      { type: 'completed', interactionId: 'interaction-write-2', status: 'completed', durationMs: 12 },
    ));

    for await (const _event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Add a task to buy milk.', systemInstruction, tools: ['tasks.createTask'] },
      { tools: ['tasks.createTask'], readOnly: false, executor: { oauth, handlers: { 'tasks.createTask': handler }, confirm } },
    )) {
      // Consume the complete interaction.
    }

    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tool: 'tasks.createTask', risk: 'write' }));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('groups multiple mutations into one approval round and executes only approved items', async () => {
    const calendarHandler = vi.fn(async () => ({ id: 'event-1', htmlLink: 'https://calendar.google.com/event-1' }));
    const taskHandler = vi.fn(async () => ({ id: 'task-1' }));
    const confirm = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction-batch-1', model: 'gemini-3.8-flash' },
      { type: 'tool-call', interactionId: 'interaction-batch-1', index: 0, callId: 'call-event-1', name: 'calendar.createEvent', arguments: { calendarId: 'primary', event: { summary: 'Design review', start: { dateTime: '2026-09-08T10:00:00Z' }, end: { dateTime: '2026-09-08T11:00:00Z' } } } },
      { type: 'tool-call', interactionId: 'interaction-batch-1', index: 1, callId: 'call-task-1', name: 'tasks.createTask', arguments: { taskListId: 'primary', task: { title: 'Send recap' } } },
    ));
    streamToolResult.mockReturnValueOnce(events({ type: 'completed', interactionId: 'interaction-batch-2', status: 'completed', durationMs: 12 }));

    for await (const _event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Schedule the review and add the follow-up task.', systemInstruction },
      { tools: ['calendar.createEvent', 'tasks.createTask'], readOnly: false, executor: { oauth, handlers: { 'calendar.createEvent': calendarHandler, 'tasks.createTask': taskHandler }, confirm } },
    )) {
      // Consume the complete interaction.
    }

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[0][0]).toMatchObject({ tool: 'calendar.createEvent' });
    expect(confirm.mock.calls[1][0]).toMatchObject({ tool: 'tasks.createTask' });
    expect(calendarHandler).toHaveBeenCalledOnce();
    expect(taskHandler).not.toHaveBeenCalled();
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      previousInteractionId: 'interaction-batch-1',
      results: expect.arrayContaining([
        expect.objectContaining({ callId: 'call-event-1', result: { id: 'event-1', htmlLink: 'https://calendar.google.com/event-1' } }),
        expect.objectContaining({ callId: 'call-task-1', result: { ok: false, error: 'USER_DECLINED' } }),
      ]),
    }), undefined);
  });
});
