import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  getStatus: async () => ({
    state: 'connected' as const,
    grantedCapabilities: ['tasks.write' as const],
    enabledCapabilities: ['tasks.write' as const],
    grantedProviderScopes: [],
  }),
  disconnect: async () => undefined,
};

function arrangeWriteTurn() {
  streamReply.mockReturnValueOnce(events(
    { type: 'interaction-created', interactionId: 'interaction-1', model: 'gemini-3.8-flash' },
    {
      type: 'tool-call',
      interactionId: 'interaction-1',
      index: 0,
      callId: 'call-write',
      name: 'tasks.createTask',
      arguments: { taskListId: 'primary', title: 'Buy milk' },
    },
  ));
  streamToolResult.mockReturnValueOnce(events(
    { type: 'completed', interactionId: 'interaction-2', status: 'completed', durationMs: 4 },
  ));
}

async function consumeWriteTurn(now: () => Date, writeHandler = vi.fn(async () => ({ id: 'task-1' }))) {
  for await (const _event of streamGoogleToolLoop(
    {
      model: 'gemini-3.8-flash',
      input: 'Create the task.',
      tools: ['tasks.createTask'],
    },
    {
      tools: ['tasks.createTask'],
      readOnly: false,
      executor: { oauth, handlers: { 'tasks.createTask': writeHandler }, now },
    },
  )) {
    // consume
  }
  return writeHandler;
}

async function consumeUndeclaredMemoryCall(name: 'memory.lookup' | 'memory.reconcile') {
  streamReply.mockReturnValueOnce(events(
    { type: 'interaction-created', interactionId: 'interaction-memory', model: 'gemini-3.8-flash' },
    {
      type: 'tool-call', interactionId: 'interaction-memory', index: 0, callId: 'call-memory', name,
      arguments: name === 'memory.lookup'
        ? { query: 'private memory' }
        : { targetRef: 'memref_forged', relation: 'support', title: 'Injected', body: 'Injected evidence.' },
    },
  ));
  streamToolResult.mockReturnValueOnce(events(
    { type: 'completed', interactionId: 'interaction-done', status: 'completed', durationMs: 4 },
  ));
  const confirm = vi.fn(async () => true);

  for await (const _event of streamGoogleToolLoop(
    {
      model: 'gemini-3.8-flash',
      input: 'Only save the explicit memory.',
      tools: ['memory.save'],
      conversationId: 'thread_1',
      inputMessageId: 'message_1',
      generationId: 'generation_1',
      isGenerationActive: () => true,
    },
    { tools: ['memory.save'], readOnly: false, executor: { oauth, confirm } },
  )) {
    // consume
  }

  return confirm;
}

describe('Google tool loop adversarial confirmation lifecycle', () => {
  beforeEach(() => {
    streamReply.mockReset();
    streamToolResult.mockReset();
    executeGoogleTool.mockReset();
    requestGoogleToolConfirmations.mockReset();
    requestGoogleCapabilityGrant.mockReset();
  });

  it('rejects an undeclared memory read even when the turn is write-enabled', async () => {
    const confirm = await consumeUndeclaredMemoryCall('memory.lookup');
    expect(executeGoogleTool).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(requestGoogleToolConfirmations).not.toHaveBeenCalled();
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      results: [expect.objectContaining({ callId: 'call-memory', result: { ok: false, error: 'TOOL_NOT_PERMITTED' } })],
    }), undefined);
  });

  it('rejects an undeclared memory mutation before confirmation or execution', async () => {
    const confirm = await consumeUndeclaredMemoryCall('memory.reconcile');
    expect(executeGoogleTool).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(requestGoogleToolConfirmations).not.toHaveBeenCalled();
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      results: [expect.objectContaining({ callId: 'call-memory', result: { ok: false, error: 'TOOL_NOT_PERMITTED' } })],
    }), undefined);
  });

  it('does not execute a grouped mutation after the confirmation the user saw has expired', async () => {
    let now = new Date('2026-09-15T12:00:00.000Z');
    arrangeWriteTurn();
    executeGoogleTool.mockResolvedValue({ ok: true, result: { id: 'task-1' } });
    requestGoogleToolConfirmations.mockImplementationOnce(async () => {
      now = new Date('2026-09-15T12:06:00.000Z');
      return [true];
    });

    const writeHandler = await consumeWriteTurn(() => now);

    expect(requestGoogleToolConfirmations).toHaveBeenCalledOnce();
    expect(executeGoogleTool).not.toHaveBeenCalled();
    expect(writeHandler).not.toHaveBeenCalled();
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      results: [expect.objectContaining({
        callId: 'call-write',
        result: { ok: false, error: 'USER_DECLINED' },
      })],
    }), undefined);
  });

  it('never grants missing OAuth after a mutation approval has already been collected', async () => {
    const now = new Date('2026-09-15T12:00:00.000Z');
    arrangeWriteTurn();
    requestGoogleToolConfirmations.mockResolvedValueOnce([true]);
    // Simulate authority disappearing between the loop's pre-admission probe
    // and executor admission. The loop must not open OAuth and reuse approval.
    executeGoogleTool.mockResolvedValueOnce({ ok: false, code: 'AUTHORIZATION_REQUIRED', requiredCapability: 'tasks.write' });

    await consumeWriteTurn(() => now);

    expect(requestGoogleToolConfirmations).toHaveBeenCalledOnce();
    expect(requestGoogleCapabilityGrant).not.toHaveBeenCalled();
    expect(executeGoogleTool).toHaveBeenCalledTimes(1);
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      results: [expect.objectContaining({
        callId: 'call-write',
        result: { ok: false, error: 'AUTHORIZATION_REQUIRED' },
      })],
    }), undefined);
  });
});
