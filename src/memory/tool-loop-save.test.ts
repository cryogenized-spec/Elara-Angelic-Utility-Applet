import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeminiToolContinuationRequest, GeminiTurnRequest } from '../gemini/contracts';

const { streamReply, streamToolResult } = vi.hoisted(() => ({
  streamReply: vi.fn(),
  streamToolResult: vi.fn(),
}));

vi.mock('../gemini/provider', () => ({
  geminiTurnPort: { streamReply, streamToolResult },
}));

import { streamGoogleToolLoop } from '../gemini/google-tool-loop';
import { db } from '../persistence/conversation';
import { getMemory, listMemories, saveMemory } from './store';

async function* events(...items: unknown[]) {
  for (const item of items) yield item as never;
}

function firstLookupRef(request: GeminiToolContinuationRequest): string {
  const result = request.results?.[0]?.result;
  const matches = (result as { matches?: unknown }).matches;
  if (!Array.isArray(matches)) throw new Error('Expected lookup matches.');
  const ref = (matches[0] as { ref?: unknown } | undefined)?.ref;
  if (typeof ref !== 'string') throw new Error('Expected lookup ref.');
  return ref;
}

const oauth = {
  authorize: async (capability: string) => ({ capability: capability as never, fetch: async () => new Response('{}', { status: 200 }) }),
  getStatus: async () => ({ state: 'connected' as const, grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
  disconnect: async () => undefined,
};

describe('memory tools through the interactive Gemini tool loop', () => {
  beforeEach(async () => {
    streamReply.mockReset();
    streamToolResult.mockReset();
    await db.transaction('rw', db.memories, db.folders, db.folderAssignments, async () => {
      await db.memories.clear();
      await db.folders.clear();
      await db.folderAssignments.clear();
    });
  });

  it('carries provider call identity and app-owned turn provenance into the canonical save handler', async () => {
    const now = Date.now();
    await db.folders.put({ id: 'folder_1', name: 'Project', parentId: null, contextScope: 'folder', createdAt: now, updatedAt: now });
    await db.folderAssignments.put({ id: 'thread_1', threadId: 'thread_1', folderId: 'folder_1', updatedAt: now });

    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction_1', model: 'gemini-3.8-flash' },
      { type: 'tool-call', interactionId: 'interaction_1', index: 0, callId: 'call_1', name: 'memory.save', arguments: { title: 'Chosen format', body: 'The user explicitly asked Elara to remember the chosen format.' } },
    ));
    streamToolResult.mockReturnValueOnce(events(
      { type: 'completed', interactionId: 'interaction_2', status: 'completed', durationMs: 4 },
    ));
    const confirm = vi.fn(async () => true);

    for await (const _event of streamGoogleToolLoop(
      {
        model: 'gemini-3.8-flash',
        input: 'Please remember this format.',
        systemInstruction: 'You are Elara.',
        tools: ['memory.save'],
        conversationId: 'thread_1',
        inputMessageId: 'message_1',
        generationId: 'generation_1',
        isGenerationActive: () => true,
      },
      { tools: ['memory.save'], readOnly: false, executor: { oauth, confirm } },
    )) {
      // Consume the complete interaction.
    }

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tool: 'memory.save', risk: 'write' }));
    const records = await listMemories();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      folderId: 'folder_1',
      source: {
        source: 'elara',
        conversationId: 'thread_1',
        messageId: 'message_1',
        note: 'idempotency:thread_1:message_1:generation_1:call_1',
      },
    });
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      previousInteractionId: 'interaction_1',
      results: expect.arrayContaining([
        expect.objectContaining({ callId: 'call_1', name: 'memory.save' }),
      ]) as unknown[],
    }), undefined);
  });

  it('performs lookup then confirmed reconciliation while freezing one memory snapshot across continuations', async () => {
    const target = await saveMemory({ title: 'Compact editor', body: 'The user prefers compact editor layout.' });
    streamReply.mockReturnValueOnce(events(
      { type: 'interaction-created', interactionId: 'interaction_lookup', model: 'gemini-3.8-flash' },
      { type: 'tool-call', interactionId: 'interaction_lookup', index: 0, callId: 'call_lookup', name: 'memory.lookup', arguments: { query: 'compact editor' } },
    ));
    streamToolResult.mockImplementationOnce((request: GeminiToolContinuationRequest) => {
      const targetRef = firstLookupRef(request);
      expect(targetRef).toMatch(/^memref_/);
      return events(
        { type: 'interaction-created', interactionId: 'interaction_reconcile', model: 'gemini-3.8-flash' },
        { type: 'tool-call', interactionId: 'interaction_reconcile', index: 1, callId: 'call_reconcile', name: 'memory.reconcile', arguments: { targetRef, relation: 'support', title: 'Repeated choice', body: 'The user explicitly selected compact editor again.' } },
      );
    });
    streamToolResult.mockReturnValueOnce(events(
      { type: 'completed', interactionId: 'interaction_done', status: 'completed', durationMs: 8 },
    ));
    const confirm = vi.fn(async () => true);

    for await (const _event of streamGoogleToolLoop(
      {
        model: 'gemini-3.8-flash',
        input: 'I still prefer the compact editor; reconcile that with what you remember.',
        systemInstruction: 'You are Elara.',
        tools: ['memory.lookup', 'memory.reconcile'],
        conversationId: 'thread_1',
        inputMessageId: 'message_2',
        generationId: 'generation_2',
        isGenerationActive: () => true,
      },
      { tools: ['memory.lookup', 'memory.reconcile'], readOnly: false, executor: { oauth, confirm } },
    )) {
      // Consume lookup, confirmed reconcile, and the closing answer.
    }

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tool: 'memory.reconcile', risk: 'write' }));
    const updated = await getMemory(target.id);
    const records = await listMemories();
    expect(updated?.reinforcementCount).toBe(1);
    expect(records.filter((record) => record.kind === 'MICRO_OBSERVATION')).toHaveLength(1);
    expect(streamToolResult).toHaveBeenCalledTimes(2);

    const initial = streamReply.mock.calls[0]?.[0] as GeminiTurnRequest | undefined;
    const firstContinuation = streamToolResult.mock.calls[0]?.[0] as GeminiToolContinuationRequest | undefined;
    const secondContinuation = streamToolResult.mock.calls[1]?.[0] as GeminiToolContinuationRequest | undefined;
    expect(initial?.memoryContext).toBe('none');
    expect(initial?.systemInstruction).toContain('The user prefers compact editor layout.');
    expect(initial?.systemInstruction).toContain('[APPLICATION CONTEXT — DURABLE MEMORY]');
    expect(firstContinuation?.systemInstruction).toBe(initial?.systemInstruction);
    expect(secondContinuation?.systemInstruction).toBe(initial?.systemInstruction);
  });
});
