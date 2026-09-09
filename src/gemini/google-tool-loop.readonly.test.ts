import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hardening regressions for autonomous (read-only, headless) tool loops:
// a model calling a tool it was never given must be refused structurally,
// and a headless caller must never park on interactive authorization UI.

const { streamReply, streamToolResult } = vi.hoisted(() => ({
  streamReply: vi.fn(),
  streamToolResult: vi.fn(),
}));

const { executeGoogleTool, requestGoogleToolConfirmations, requestGoogleCapabilityGrant } = vi.hoisted(() => ({
  executeGoogleTool: vi.fn(),
  requestGoogleToolConfirmations: vi.fn(),
  requestGoogleCapabilityGrant: vi.fn(),
}));

vi.mock('./provider', () => ({
  geminiTurnPort: { streamReply, streamToolResult },
}));

vi.mock('../google/tools/executor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../google/tools/executor')>()),
  executeGoogleTool,
}));

vi.mock('../google/confirmation/broker', () => ({
  requestGoogleToolConfirmations,
}));

vi.mock('../google/oauth/request-broker', () => ({
  requestGoogleCapabilityGrant,
}));

import { streamGoogleToolLoop } from './google-tool-loop';

async function* events(...items: unknown[]) {
  for (const item of items) yield item as never;
}

const oauth = {
  authorize: async (capability: string) => ({ capability: capability as never, fetch: async () => new Response('{}', { status: 200 }) }),
  getStatus: async () => ({ state: 'connected' as const, grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
  disconnect: async () => undefined,
};

describe('read-only tool loop — call-time enforcement', () => {
  beforeEach(() => {
    streamReply.mockReset();
    streamToolResult.mockReset();
    executeGoogleTool.mockReset();
    requestGoogleToolConfirmations.mockReset();
    requestGoogleCapabilityGrant.mockReset();
  });

  it('refuses a hallucinated write tool call under readOnly even though write handlers exist', async () => {
    const writeHandler = vi.fn(async () => ({ id: 'task-1' }));
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction-1', model: 'gemini-3.8-flash' },
      // Only the read tool was declared, but the model calls a write tool anyway.
      { type: 'tool-call', interactionId: 'interaction-1', index: 0, callId: 'call-write', name: 'tasks.createTask', arguments: { taskListId: 'primary', task: { title: 'Buy milk' } } },
      { type: 'tool-call', interactionId: 'interaction-1', index: 1, callId: 'call-read', name: 'tasks.listTasks', arguments: { taskListId: 'primary' } },
    ));
    streamToolResult.mockReturnValueOnce(events(
      { type: 'text-delta', index: 1, text: 'Here is your list.' },
      { type: 'completed', interactionId: 'interaction-2', status: 'completed', durationMs: 9 },
    ));
    executeGoogleTool.mockResolvedValueOnce({ ok: true, result: { tasks: [] } });

    const collected: Array<unknown> = [];
    for await (const event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Run the routine.', systemInstruction: 'Routine instruction.', tools: ['tasks.listTasks'] },
      { tools: ['tasks.listTasks'], readOnly: true, executor: { oauth, handlers: { 'tasks.listTasks': async () => ({ tasks: [] }), 'tasks.createTask': writeHandler } } },
    )) collected.push(event);

    expect(collected.at(-1)).toMatchObject({ type: 'completed' });
    // The write handler never ran and no confirmation broker was engaged.
    expect(writeHandler).not.toHaveBeenCalled();
    expect(requestGoogleToolConfirmations).not.toHaveBeenCalled();
    expect(executeGoogleTool).toHaveBeenCalledTimes(1);
    // The refusal is a structured tool result, so the loop continued and completed.
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      results: expect.arrayContaining([
        expect.objectContaining({ callId: 'call-write', result: { ok: false, error: 'TOOL_NOT_PERMITTED' } }),
        expect.objectContaining({ callId: 'call-read' }),
      ]),
    }), undefined);
  });

  it('a headless caller never parks on the capability-grant broker when authorization is missing', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction-1', model: 'gemini-3.8-flash' },
      { type: 'tool-call', interactionId: 'interaction-1', index: 0, callId: 'call-1', name: 'tasks.listTasks', arguments: { taskListId: 'primary' } },
    ));
    streamToolResult.mockReturnValueOnce(events(
      { type: 'text-delta', index: 1, text: '{"outcome":"noop","reason":"tasks unavailable"}' },
      { type: 'completed', interactionId: 'interaction-2', status: 'completed', durationMs: 9 },
    ));
    executeGoogleTool.mockResolvedValueOnce({ ok: false, code: 'AUTHORIZATION_REQUIRED', requiredCapability: 'tasks.read' });

    const collected: Array<unknown> = [];
    for await (const event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Run the routine.', systemInstruction: 'Routine instruction.', tools: ['tasks.listTasks'] },
      { tools: ['tasks.listTasks'], readOnly: true, headless: true, executor: { oauth, handlers: { 'tasks.listTasks': async () => ({ tasks: [] }) } } },
    )) collected.push(event);

    expect(collected.at(-1)).toMatchObject({ type: 'completed' });
    expect(requestGoogleCapabilityGrant).not.toHaveBeenCalled();
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      results: [expect.objectContaining({ callId: 'call-1', result: { ok: false, error: 'AUTHORIZATION_REQUIRED' } })],
    }), undefined);
  });

  it('refuses every roleplay write/destructive tool call in read-only mode — no namespace exceptions', async () => {
    for (const roleplayWrite of ['roleplay_setting.create', 'roleplay_setting.update', 'roleplay_setting.move', 'roleplay_setting.delete'] as const) {
      streamReply.mockClear();
      streamToolResult.mockClear();
      const writeHandler = vi.fn(async () => ({ ok: true }));
      streamReply.mockReturnValueOnce(events(
        { type: 'interaction-created', interactionId: 'interaction-rp', model: 'gemini-3.8-flash' },
        { type: 'tool-call', interactionId: 'interaction-rp', index: 0, callId: `call-${roleplayWrite}`, name: roleplayWrite, arguments: { name: 'Evil entity' } },
      ));
      streamToolResult.mockReturnValueOnce(events(
        { type: 'completed', interactionId: 'interaction-rp-2', status: 'completed', durationMs: 4 },
      ));

      const collected: Array<unknown> = [];
      for await (const event of streamGoogleToolLoop(
        { model: 'gemini-3.8-flash', input: 'Run the routine.', systemInstruction: 'Routine instruction.', tools: ['tasks.listTasks'] },
        { tools: ['tasks.listTasks'], readOnly: true, headless: true, executor: { oauth, handlers: { 'tasks.listTasks': async () => ({ tasks: [] }), [roleplayWrite]: writeHandler } as never } },
      )) collected.push(event);

      expect(writeHandler, `${roleplayWrite} handler must never run`).not.toHaveBeenCalled();
      expect(collected.at(-1)).toMatchObject({ type: 'completed' });
      expect(streamToolResult, `${roleplayWrite} must be refused structurally`).toHaveBeenCalledWith(expect.objectContaining({
        results: expect.arrayContaining([expect.objectContaining({ callId: `call-${roleplayWrite}`, result: { ok: false, error: 'TOOL_NOT_PERMITTED' } })]),
      }), undefined);
    }
  });

  it('refuses a hallucinated read tool that was never declared (roleplay_setting.list)', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction-rp', model: 'gemini-3.8-flash' },
      { type: 'tool-call', interactionId: 'interaction-rp', index: 0, callId: 'call-rp-list', name: 'roleplay_setting.list', arguments: {} },
    ));
    streamToolResult.mockReturnValueOnce(events(
      { type: 'completed', interactionId: 'interaction-rp-2', status: 'completed', durationMs: 4 },
    ));
    const spyHandler = vi.fn(async () => ({ entities: [] }));

    for await (const _event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Run the routine.', systemInstruction: 'Routine instruction.', tools: ['tasks.listTasks'] },
      { tools: ['tasks.listTasks'], readOnly: true, headless: true, executor: { oauth, handlers: { 'tasks.listTasks': async () => ({ tasks: [] }), 'roleplay_setting.list': spyHandler } as never } },
    )) {
      // consume
    }

    expect(spyHandler).not.toHaveBeenCalled();
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      results: expect.arrayContaining([expect.objectContaining({ callId: 'call-rp-list', result: { ok: false, error: 'TOOL_NOT_PERMITTED' } })]),
    }), undefined);
  });

  it('refuses an undeclared send-class tool (gmail.sendMessage) structurally', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction-send', model: 'gemini-3.8-flash' },
      { type: 'tool-call', interactionId: 'interaction-send', index: 0, callId: 'call-send', name: 'gmail.sendMessage', arguments: { to: ['someone@example.com'], subject: 'hi' } },
    ));
    streamToolResult.mockReturnValueOnce(events(
      { type: 'completed', interactionId: 'interaction-send-2', status: 'completed', durationMs: 4 },
    ));
    const sendHandler = vi.fn(async () => ({ id: 'msg-1' }));

    for await (const _event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Run the routine.', systemInstruction: 'Routine instruction.', tools: ['gmail.listMessages'] },
      { tools: ['gmail.listMessages'], readOnly: true, headless: true, executor: { oauth, handlers: { 'gmail.listMessages': async () => ({ messages: [] }), 'gmail.sendMessage': sendHandler } as never } },
    )) {
      // consume
    }

    expect(sendHandler).not.toHaveBeenCalled();
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      results: expect.arrayContaining([expect.objectContaining({ callId: 'call-send', result: { ok: false, error: 'TOOL_NOT_PERMITTED' } })]),
    }), undefined);
  });

  it('terminates as cancelled when the signal aborts during tool execution', async () => {
    const controller = new AbortController();
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction-abort', model: 'gemini-3.8-flash' },
      { type: 'tool-call', interactionId: 'interaction-abort', index: 0, callId: 'call-abort', name: 'tasks.listTasks', arguments: { taskListId: 'primary' } },
    ));
    // Abort DURING tool execution — the loop must yield a terminal 'cancelled'
    // event, never return silently (which the runner would misclassify as
    // failed / NO_TERMINAL_EVENT).
    executeGoogleTool.mockImplementationOnce(async () => {
      controller.abort();
      return { ok: true, result: { tasks: [] } };
    });
    streamToolResult.mockReturnValueOnce(events(
      { type: 'completed', interactionId: 'never-reached', status: 'completed', durationMs: 1 },
    ));

    const collected: Array<unknown> = [];
    for await (const event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Run the routine.', systemInstruction: 'Routine instruction.', tools: ['tasks.listTasks'] },
      { tools: ['tasks.listTasks'], readOnly: true, headless: true, executor: { oauth, handlers: { 'tasks.listTasks': async () => ({ tasks: [] }) } } },
      controller.signal,
    )) collected.push(event);

    expect(collected.at(-1)).toMatchObject({ type: 'cancelled', interactionId: 'interaction-abort' });
    expect(streamToolResult).not.toHaveBeenCalled();
  });

  it('the grant broker remains available to interactive (non-headless) callers', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction-1', model: 'gemini-3.8-flash' },
      { type: 'tool-call', interactionId: 'interaction-1', index: 0, callId: 'call-1', name: 'tasks.listTasks', arguments: { taskListId: 'primary' } },
    ));
    streamToolResult.mockReturnValueOnce(events(
      { type: 'completed', interactionId: 'interaction-2', status: 'completed', durationMs: 9 },
    ));
    executeGoogleTool.mockResolvedValueOnce({ ok: false, code: 'AUTHORIZATION_REQUIRED', requiredCapability: 'tasks.read' });
    requestGoogleCapabilityGrant.mockResolvedValueOnce(false);

    for await (const _event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Show my tasks.', systemInstruction: 'Chat instruction.', tools: ['tasks.listTasks'] },
      { tools: ['tasks.listTasks'], executor: { oauth, handlers: { 'tasks.listTasks': async () => ({ tasks: [] }) } } },
    )) {
      // consume
    }

    expect(requestGoogleCapabilityGrant).toHaveBeenCalledWith('tasks.read', undefined);
  });
});
