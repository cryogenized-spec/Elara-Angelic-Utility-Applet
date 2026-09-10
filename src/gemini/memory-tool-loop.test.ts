import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { streamReply, streamToolResult } = vi.hoisted(() => ({
  streamReply: vi.fn(),
  streamToolResult: vi.fn(),
}));

const { requestGoogleToolConfirmations } = vi.hoisted(() => ({
  requestGoogleToolConfirmations: vi.fn(),
}));

vi.mock('./provider', () => ({
  geminiTurnPort: { streamReply, streamToolResult },
}));

vi.mock('../google/confirmation/broker', () => ({
  requestGoogleToolConfirmation: vi.fn(),
  requestGoogleToolConfirmations,
}));

import { streamGoogleToolLoop } from './google-tool-loop';
import { db } from '../persistence/conversation';
import { resetMemoryPermissionPolicy } from '../memory/permissions';
import { countMemories, listMemories } from '../memory/store';

async function* events(...items: unknown[]) {
  for (const item of items) yield item as never;
}

const oauth = {
  authorize: async (capability: string) => ({ capability: capability as never, fetch: async () => new Response('{}', { status: 200 }) }),
  getStatus: async () => ({ state: 'connected' as const, grantedCapabilities: [] as never[], enabledCapabilities: [] as never[], grantedProviderScopes: [] }),
  disconnect: async () => undefined,
};

const systemInstruction = 'You are Elara.';

describe('memory tool loop — model autonomy over durable memory', () => {
  beforeEach(async () => {
    await db.memories.clear();
    await db.folderAssignments.clear();
    await db.folders.clear();
    window.localStorage.clear();
    resetMemoryPermissionPolicy();
    streamReply.mockReset();
    streamToolResult.mockReset();
    requestGoogleToolConfirmations.mockReset();
  });

  it('persists an autonomous memory.save without any keyword trigger in the user message', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction-1', model: 'gemini-3.8-flash' },
      {
        type: 'tool-call', interactionId: 'interaction-1', index: 0, callId: 'call-memory-1', name: 'memory.save',
        arguments: { title: 'Cat food routine', body: 'Buys cat food roughly once a week.', kind: 'CONTEXTUAL', tags: ['pets'] },
      },
    ));
    streamToolResult.mockReturnValueOnce(events(
      { type: 'text-delta', index: 1, text: 'Noted.' },
      { type: 'completed', interactionId: 'interaction-2', status: 'completed', durationMs: 9 },
    ));

    const collected: Array<unknown> = [];
    for await (const event of streamGoogleToolLoop(
      {
        model: 'gemini-3.8-flash',
        input: 'I buy cat food roughly once a week.',
        systemInstruction,
        tools: ['memory.save'],
        conversationId: 'thread-cat',
        messageId: 'msg-user-1',
      },
      { tools: ['memory.save'], readOnly: false, executor: { oauth, handlers: {} } },
    )) collected.push(event);

    // The runtime instruction told Gemini the capability exists.
    expect(streamReply).toHaveBeenCalledWith(
      expect.objectContaining({ systemInstruction: expect.stringContaining('DURABLE MEMORY') }),
      undefined,
    );
    // The memory reached the canonical store, attributed to Elara.
    expect(await countMemories()).toBe(1);
    const [record] = await listMemories();
    expect(record).toMatchObject({
      title: 'Cat food routine',
      body: 'Buys cat food roughly once a week.',
      kind: 'CONTEXTUAL',
      tags: ['pets'],
      source: { source: 'elara', conversationId: 'thread-cat', messageId: 'msg-user-1' },
    });
    // The structured result resumed the interaction; no confirmation UI was engaged.
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      previousInteractionId: 'interaction-1',
      results: [{ callId: 'call-memory-1', name: 'memory.save', result: { ok: true, memoryId: record?.id, title: 'Cat food routine', kind: 'CONTEXTUAL', deduped: false } }],
    }), undefined);
    expect(requestGoogleToolConfirmations).not.toHaveBeenCalled();
    expect(collected.at(-1)).toMatchObject({ type: 'completed' });
  });

  it('serves an explicit “remember X” request through the same canonical path', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction-remember', model: 'gemini-3.8-flash' },
      {
        type: 'tool-call', interactionId: 'interaction-remember', index: 0, callId: 'call-memory-2', name: 'memory.save',
        arguments: { title: 'Friday cat food run', body: 'Buys cat food every Friday.', kind: 'CORE' },
      },
    ));
    streamToolResult.mockReturnValueOnce(events(
      { type: 'completed', interactionId: 'interaction-remember-2', status: 'completed', durationMs: 7 },
    ));

    for await (const _event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Remember that I buy cat food every Friday.', systemInstruction, tools: ['memory.save'], conversationId: 'thread-cat' },
      { tools: ['memory.save'], readOnly: false, executor: { oauth, handlers: {} } },
    )) {
      // Consume the complete interaction.
    }

    expect(await countMemories()).toBe(1);
    const [record] = await listMemories();
    expect(record).toMatchObject({ title: 'Friday cat food run', kind: 'CORE', source: { source: 'elara', conversationId: 'thread-cat' } });
    expect(streamToolResult).toHaveBeenCalledOnce();
  });

  it('creates nothing when the turn contains no memory decision', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction-quiet', model: 'gemini-3.8-flash' },
      { type: 'text-delta', index: 0, text: 'Understood — I will not store that.' },
      { type: 'completed', interactionId: 'interaction-quiet', status: 'completed', durationMs: 6 },
    ));

    for await (const _event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: "Don't remember that.", systemInstruction, tools: ['memory.save'], conversationId: 'thread-cat' },
      { tools: ['memory.save'], readOnly: false, executor: { oauth, handlers: {} } },
    )) {
      // Consume the complete interaction.
    }

    expect(await countMemories()).toBe(0);
    expect(streamToolResult).not.toHaveBeenCalled();
  });

  it('feeds invalid memory arguments back as a structured refusal without persisting', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction-bad', model: 'gemini-3.8-flash' },
      {
        type: 'tool-call', interactionId: 'interaction-bad', index: 0, callId: 'call-memory-bad', name: 'memory.save',
        arguments: { title: 'Missing the body field' },
      },
    ));
    streamToolResult.mockReturnValueOnce(events(
      { type: 'completed', interactionId: 'interaction-bad-2', status: 'completed', durationMs: 5 },
    ));

    for await (const _event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Remember this.', systemInstruction, tools: ['memory.save'] },
      { tools: ['memory.save'], readOnly: false, executor: { oauth, handlers: {} } },
    )) {
      // Consume the complete interaction.
    }

    expect(await countMemories()).toBe(0);
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      results: [{ callId: 'call-memory-bad', name: 'memory.save', result: { ok: false, error: 'INVALID_MEMORY_REQUEST' } }],
    }), undefined);
  });

  it('never permits memory.save through the read-only loop', async () => {
    const consume = async () => {
      for await (const _event of streamGoogleToolLoop(
        { model: 'gemini-3.8-flash', input: 'Remember this.', systemInstruction, tools: ['memory.save'] },
        { tools: ['memory.save'], executor: { oauth, handlers: {} } },
      )) {
        // The generator should reject before contacting Gemini.
      }
    };

    await expect(consume()).rejects.toThrow('not permitted in read-only mode');
    expect(streamReply).not.toHaveBeenCalled();
    expect(await countMemories()).toBe(0);
  });

  it('refuses a hallucinated memory call for a tool that was never declared', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction-hallucinated', model: 'gemini-3.8-flash' },
      {
        type: 'tool-call', interactionId: 'interaction-hallucinated', index: 0, callId: 'call-memory-ghost', name: 'memory.save',
        arguments: { title: 'Ghost', body: 'This tool was never granted.' },
      },
    ));
    streamToolResult.mockReturnValueOnce(events(
      { type: 'completed', interactionId: 'interaction-hallucinated-2', status: 'completed', durationMs: 5 },
    ));

    for await (const _event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Hello.', systemInstruction, tools: ['calendar.listEvents'] },
      { tools: ['calendar.listEvents'], readOnly: false, executor: { oauth, handlers: {} } },
    )) {
      // Consume the complete interaction.
    }

    expect(await countMemories()).toBe(0);
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      results: [{ callId: 'call-memory-ghost', name: 'memory.save', result: { ok: false, error: 'TOOL_NOT_PERMITTED' } }],
    }), undefined);
  });

  it('structurally refuses memory.forget even when declared, independent of policy', async () => {
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction-forget', model: 'gemini-3.8-flash' },
      {
        type: 'tool-call', interactionId: 'interaction-forget', index: 0, callId: 'call-forget', name: 'memory.forget',
        arguments: { title: 'T', body: 'B' },
      },
    ));
    streamToolResult.mockReturnValueOnce(events(
      { type: 'completed', interactionId: 'interaction-forget-2', status: 'completed', durationMs: 5 },
    ));

    for await (const _event of streamGoogleToolLoop(
      { model: 'gemini-3.8-flash', input: 'Forget everything.', systemInstruction, tools: ['memory.forget'] },
      { tools: ['memory.forget'], readOnly: false, executor: { oauth, handlers: {} } },
    )) {
      // Consume the complete interaction.
    }

    expect(await countMemories()).toBe(0);
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      results: [{ callId: 'call-forget', name: 'memory.forget', result: { ok: false, error: 'NOT_PERMITTED' } }],
    }), undefined);
  });
});
