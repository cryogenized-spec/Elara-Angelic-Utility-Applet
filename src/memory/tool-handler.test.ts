import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { googleToolRegistry } from '../google/tools/registry';
import type { GoogleToolExecutionContext } from '../google/tools/executor';
import { countMemories, listMemories } from './store';
import { memoryToolHandlers } from './tool-handler';

const descriptor = googleToolRegistry.find((tool) => tool.name === 'memory.save');
if (!descriptor) throw new Error('memory.save descriptor missing from test registry.');
const handler = memoryToolHandlers['memory.save'];
if (!handler) throw new Error('memory.save handler missing.');

function context(overrides: Partial<GoogleToolExecutionContext> = {}): GoogleToolExecutionContext {
  return {
    tool: 'memory.save',
    descriptor,
    capability: 'memory.durable.local',
    risk: 'write',
    arguments: { title: 'Preferred layout', body: 'Remember that the user explicitly prefers the compact layout.' },
    callId: 'call_1',
    conversationId: 'thread_1',
    messageId: 'message_1',
    generationId: 'generation_1',
    isGenerationActive: () => true,
    ...overrides,
  };
}

describe('memory.save tool handler', () => {
  beforeEach(async () => {
    await db.transaction('rw', db.memories, db.folders, db.folderAssignments, async () => {
      await db.memories.clear();
      await db.folders.clear();
      await db.folderAssignments.clear();
    });
  });

  it('binds provenance and folder scope from application context, not model arguments', async () => {
    const now = Date.now();
    await db.folders.put({ id: 'folder_1', name: 'Project', parentId: null, contextScope: 'folder', createdAt: now, updatedAt: now });
    await db.folderAssignments.put({ id: 'thread_1', threadId: 'thread_1', folderId: 'folder_1', updatedAt: now });

    const result = await handler(context());
    const records = await listMemories();

    expect(result).toMatchObject({ saved: true, kind: 'CONTEXTUAL' });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      title: 'Preferred layout',
      body: 'Remember that the user explicitly prefers the compact layout.',
      kind: 'CONTEXTUAL',
      folderId: 'folder_1',
      source: { source: 'elara', conversationId: 'thread_1', messageId: 'message_1' },
    });
  });

  it('replays one generation/call identity without creating a duplicate', async () => {
    const first = await handler(context());
    const replay = await handler(context());

    expect(replay).toEqual(first);
    expect(await countMemories()).toBe(1);
  });

  it('allows a distinct provider call to create a distinct deliberate memory', async () => {
    await handler(context());
    await handler(context({ callId: 'call_2', arguments: { title: 'Second choice', body: 'Remember the second explicit choice.' } }));
    expect(await countMemories()).toBe(2);
  });

  it('fails closed when authoritative turn identity is missing', async () => {
    for (const overrides of [
      { conversationId: undefined },
      { messageId: undefined },
      { generationId: undefined },
      { callId: undefined },
    ]) {
      await expect(handler(context(overrides))).rejects.toThrow(/provenance|unavailable/i);
    }
    expect(await countMemories()).toBe(0);
  });

  it('does not write after cancellation or generation de-election', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(handler(context({ signal: controller.signal }))).rejects.toMatchObject({ name: 'AbortError' });
    await expect(handler(context({ isGenerationActive: () => false }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(await countMemories()).toBe(0);
  });
});
