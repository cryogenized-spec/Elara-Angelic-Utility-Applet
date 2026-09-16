import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { streamReply, streamToolResult } = vi.hoisted(() => ({
  streamReply: vi.fn(),
  streamToolResult: vi.fn(),
}));

vi.mock('../gemini/provider', () => ({
  geminiTurnPort: { streamReply, streamToolResult },
}));

import { streamGoogleToolLoop } from '../gemini/google-tool-loop';
import { db } from '../persistence/conversation';
import { listMemories } from './store';

async function* events(...items: unknown[]) {
  for (const item of items) yield item as never;
}

const oauth = {
  authorize: async (capability: string) => ({ capability: capability as never, fetch: async () => new Response('{}', { status: 200 }) }),
  getStatus: async () => ({ state: 'connected' as const, grantedCapabilities: [], enabledCapabilities: [], grantedProviderScopes: [] }),
  disconnect: async () => undefined,
};

describe('memory.save through the interactive Gemini tool loop', () => {
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
        note: 'idempotency:generation_1:call_1',
      },
    });
    expect(streamToolResult).toHaveBeenCalledWith(expect.objectContaining({
      previousInteractionId: 'interaction_1',
      results: [expect.objectContaining({ callId: 'call_1', name: 'memory.save', result: expect.objectContaining({ saved: true, kind: 'CONTEXTUAL' }) })],
    }), undefined);
  });
});
