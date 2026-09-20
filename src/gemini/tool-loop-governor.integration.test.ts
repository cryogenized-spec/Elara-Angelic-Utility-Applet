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

const tools = ['drive.searchFiles', 'drive.searchLibrary', 'gmail.listMessages', 'tasks.createTask'] as const;

const oauth = {
  authorize: async (capability: string) => ({ capability: capability as never, fetch: async () => new Response('{}', { status: 200 }) }),
  getStatus: async () => ({
    state: 'connected' as const,
    grantedCapabilities: ['drive.files.app.read' as const, 'drive.library.read' as const, 'gmail.read' as const, 'tasks.write' as const, 'calendar.events.read' as const],
    enabledCapabilities: ['drive.files.app.read' as const, 'drive.library.read' as const, 'gmail.read' as const, 'tasks.write' as const, 'calendar.events.read' as const],
    grantedProviderScopes: [],
  }),
  disconnect: async () => undefined,
};

describe('Gemini tool-loop gross-input governor', () => {
  beforeEach(() => {
    streamReply.mockReset();
    streamToolResult.mockReset();
  });

  it('severs a growing chain at the compaction boundary and preserves external-data taint', async () => {
    const driveFiles = vi.fn(async () => ({ files: [] }));
    const driveLibrary = vi.fn(async () => ({ files: [] }));
    const gmailList = vi.fn(async () => ({
      trust: 'untrusted-external',
      messages: [{ id: 'm1', subject: 'GitHub PR #79', snippet: 'Kanban integration' }],
    }));
    const createTask = vi.fn(async () => ({ id: 'task-1', title: 'Review PR #79' }));
    const confirm = vi.fn(async () => true);

    streamReply
      .mockReturnValueOnce(events(
        { type: 'interaction-created', interactionId: 'i1', model: 'gemini-3.8-flash' },
        { type: 'interaction-usage', interactionId: 'i1', status: 'requires_action', source: 'provider', usage: { inputTokens: 40_000, cachedTokens: 30_000 } },
        { type: 'tool-call', interactionId: 'i1', index: 0, callId: 'c1', name: 'drive.searchFiles', arguments: { query: "name contains 'Kanban'" } },
      ))
      .mockReturnValueOnce(events(
        { type: 'interaction-created', interactionId: 'compact-1', model: 'gemini-3.8-flash' },
        { type: 'interaction-usage', interactionId: 'compact-1', status: 'requires_action', source: 'provider', usage: { inputTokens: 15_000, cachedTokens: 5_000 } },
        { type: 'tool-call', interactionId: 'compact-1', index: 0, callId: 'c4', name: 'tasks.createTask', arguments: { taskListId: 'primary', title: 'Review PR #79' } },
      ));

    streamToolResult
      .mockReturnValueOnce(events(
        { type: 'interaction-created', interactionId: 'i2', model: 'gemini-3.8-flash' },
        { type: 'interaction-usage', interactionId: 'i2', status: 'requires_action', source: 'provider', usage: { inputTokens: 40_000, cachedTokens: 32_000 } },
        { type: 'tool-call', interactionId: 'i2', index: 0, callId: 'c2', name: 'drive.searchLibrary', arguments: { query: "fullText contains 'Kanban'" } },
      ))
      .mockReturnValueOnce(events(
        { type: 'interaction-created', interactionId: 'i3', model: 'gemini-3.8-flash' },
        { type: 'interaction-usage', interactionId: 'i3', status: 'requires_action', source: 'provider', usage: { inputTokens: 40_000, cachedTokens: 33_000 } },
        { type: 'tool-call', interactionId: 'i3', index: 0, callId: 'c3', name: 'gmail.listMessages', arguments: { query: 'Kanban' } },
      ))
      .mockReturnValueOnce(events(
        { type: 'interaction-created', interactionId: 'i5', model: 'gemini-3.8-flash' },
        { type: 'interaction-usage', interactionId: 'i5', status: 'completed', source: 'provider', usage: { inputTokens: 10_000, cachedTokens: 2_000 } },
        { type: 'text-delta', index: 0, text: 'I found the Kanban lead and created the requested task.' },
        { type: 'completed', interactionId: 'i5', status: 'completed', durationMs: 3, usage: { inputTokens: 10_000, cachedTokens: 2_000 } },
      ));

    const collected: unknown[] = [];
    for await (const event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'See if you can figure out what is going on with the Kanban.', tools },
      {
        tools,
        readOnly: false,
        executor: {
          oauth,
          confirm,
          handlers: {
            'drive.searchFiles': driveFiles,
            'drive.searchLibrary': driveLibrary,
            'gmail.listMessages': gmailList,
            'tasks.createTask': createTask,
          },
        },
        budgetPolicy: {
          softGrossInputTokens: 100_000,
          compactGrossInputTokens: 120_000,
          hardGrossInputTokens: 200_000,
          compactAfterInteractions: 99,
          maxModelInteractions: 10,
        },
      },
    )) collected.push(event);

    expect(streamReply).toHaveBeenCalledTimes(2);
    const compactedRequest = streamReply.mock.calls[1]?.[0] as {
      previousInteractionId?: string;
      attachments?: readonly string[];
      tools?: readonly string[];
      memoryContext?: string;
      untrustedExternalContext?: boolean;
      input?: string;
    };
    expect(compactedRequest).toMatchObject({
      previousInteractionId: undefined,
      attachments: undefined,
      tools,
      memoryContext: 'none',
      untrustedExternalContext: true,
    });
    expect(compactedRequest.input).toContain('[APPLICATION-GENERATED INVESTIGATION CHECKPOINT]');
    expect(compactedRequest.input).toContain('GitHub PR #79');
    expect(compactedRequest.input).not.toContain('accessToken');
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'tasks.createTask',
      untrustedContext: true,
    }));
    expect(createTask).toHaveBeenCalledOnce();
    expect(collected).toContainEqual(expect.objectContaining({ type: 'context-activity', label: 'Context compacted' }));
    expect(collected.at(-1)).toMatchObject({
      type: 'completed',
      status: 'completed',
      usage: { inputTokens: 145_000, cachedTokens: 102_000 },
    });
  });

  it('short-circuits an exact duplicate successful read until a mutation changes the epoch', async () => {
    const listEvents = vi.fn(async () => ({ events: [{ id: 'e1', summary: 'Review' }] }));
    const readTools = ['calendar.listEvents'] as const;

    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'r1', model: 'gemini-3.8-flash' },
      { type: 'tool-call', interactionId: 'r1', index: 0, callId: 'read-1', name: 'calendar.listEvents', arguments: { calendarId: 'primary' } },
    ));
    streamToolResult
      .mockReturnValueOnce(events(
        { type: 'interaction-created', interactionId: 'r2', model: 'gemini-3.8-flash' },
        { type: 'tool-call', interactionId: 'r2', index: 0, callId: 'read-2', name: 'calendar.listEvents', arguments: { calendarId: 'primary' } },
      ))
      .mockReturnValueOnce(events(
        { type: 'interaction-created', interactionId: 'r3', model: 'gemini-3.8-flash' },
        { type: 'completed', interactionId: 'r3', status: 'completed', durationMs: 2 },
      ));

    for await (const _event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Check the same calendar twice.', tools: readTools },
      { tools: readTools, executor: { oauth, handlers: { 'calendar.listEvents': listEvents } } },
    )) {
      // Consume.
    }

    expect(listEvents).toHaveBeenCalledOnce();
    expect(streamToolResult).toHaveBeenCalledTimes(2);
    expect(streamToolResult.mock.calls[1]?.[0]).toMatchObject({
      results: [expect.objectContaining({
        callId: 'read-2',
        result: { ok: false, error: 'DUPLICATE_READ_SKIPPED' },
      })],
    });
  });

  it('returns a local synthesis fallback instead of dispatching another model call past the hard budget', async () => {
    const listEvents = vi.fn(async () => ({ events: [] }));
    const readTools = ['calendar.listEvents'] as const;

    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'h1', model: 'gemini-3.8-flash' },
      { type: 'interaction-usage', interactionId: 'h1', status: 'requires_action', source: 'provider', usage: { inputTokens: 80_000 } },
      { type: 'tool-call', interactionId: 'h1', index: 0, callId: 'hcall-1', name: 'calendar.listEvents', arguments: { calendarId: 'primary' } },
    ));
    streamToolResult.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'h2', model: 'gemini-3.8-flash' },
      { type: 'interaction-usage', interactionId: 'h2', status: 'requires_action', source: 'provider', usage: { inputTokens: 80_000 } },
      { type: 'tool-call', interactionId: 'h2', index: 0, callId: 'hcall-2', name: 'calendar.listEvents', arguments: { calendarId: 'secondary' } },
    ));

    const collected: unknown[] = [];
    for await (const event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Explore deeply.', tools: readTools },
      {
        tools: readTools,
        executor: { oauth, handlers: { 'calendar.listEvents': listEvents } },
        budgetPolicy: {
          hardGrossInputTokens: 170_000,
          compactGrossInputTokens: 160_000,
          compactAfterInteractions: 99,
          maxModelInteractions: 10,
          maxCompactions: 0,
        },
      },
    )) collected.push(event);

    expect(streamReply).toHaveBeenCalledOnce();
    expect(streamToolResult).toHaveBeenCalledOnce();
    expect(collected).toContainEqual(expect.objectContaining({ type: 'text-delta', text: expect.stringContaining('local exploration budget') as string }));
    expect(collected.at(-1)).toMatchObject({ type: 'completed', status: 'budget_exhausted' });
  });
});
