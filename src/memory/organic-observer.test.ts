import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../persistence/conversation';
import { listMemories } from './store';
import {
  ORGANIC_OBSERVATION_CONFIDENCE,
  ORGANIC_OBSERVATION_IMPORTANCE,
  observePersistedTurn,
  shouldInspectUserMessage,
} from './organic-observer';

async function resetMemoryState(): Promise<void> {
  await db.transaction('rw', db.memories, db.folders, db.folderAssignments, async () => {
    await db.memories.clear();
    await db.folders.clear();
    await db.folderAssignments.clear();
  });
}

function baseRequest(extractor: (message: string) => Promise<unknown>) {
  return {
    conversationId: 'thread_organic',
    messageId: 'user_message_1',
    userMessage: 'For this project I prefer the compact editor layout, and that preference should stick.',
    extractor,
  };
}

describe('bounded organic memory observer', () => {
  beforeEach(resetMemoryState);

  it('skips trivial acknowledgements without invoking Gemini', async () => {
    const extractor = vi.fn(async () => ({ candidates: [] }));
    expect(shouldInspectUserMessage('Okay!')).toBe(false);

    const result = await observePersistedTurn({
      ...baseRequest(extractor),
      userMessage: 'Okay!',
    });

    expect(result).toEqual({ status: 'skipped', count: 0 });
    expect(extractor).not.toHaveBeenCalled();
    expect(await listMemories()).toHaveLength(0);
  });

  it('stores only exact user-authored evidence as low-weight micro-observation data', async () => {
    const now = Date.now();
    await db.folders.put({ id: 'project_folder', name: 'Project', parentId: null, contextScope: 'folder', createdAt: now, updatedAt: now });
    await db.folderAssignments.put({ id: 'thread_organic', threadId: 'thread_organic', folderId: 'project_folder', updatedAt: now });
    const evidence = 'I prefer the compact editor layout';

    const result = await observePersistedTurn(baseRequest(async () => ({
      candidates: [{ domain: 'preference', evidence }],
    })));
    const memories = await listMemories();

    expect(result).toEqual({ status: 'recorded', count: 1 });
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      kind: 'MICRO_OBSERVATION',
      title: 'Observed preference',
      body: evidence,
      tags: ['organic', 'domain:preference'],
      confidence: ORGANIC_OBSERVATION_CONFIDENCE,
      importance: ORGANIC_OBSERVATION_IMPORTANCE,
      folderId: 'project_folder',
      source: {
        source: 'elara',
        conversationId: 'thread_organic',
        messageId: 'user_message_1',
      },
    });
  });

  it('rejects model paraphrases instead of allowing the classifier to author facts', async () => {
    const result = await observePersistedTurn(baseRequest(async () => ({
      candidates: [{ domain: 'preference', evidence: 'The user always wants a compact interface.' }],
    })));

    expect(result).toEqual({ status: 'empty', count: 0 });
    expect(await listMemories()).toHaveLength(0);
  });

  it('deterministically rejects credential-shaped evidence even if the classifier emits it', async () => {
    const userMessage = 'For tomorrow, my API key is EXAMPLE_NOT_A_REAL_SECRET_12345 and do not lose it.';
    const result = await observePersistedTurn({
      conversationId: 'thread_organic',
      messageId: 'user_secret_1',
      userMessage,
      extractor: async () => ({ candidates: [{ domain: 'persistent_fact', evidence: 'my API key is EXAMPLE_NOT_A_REAL_SECRET_12345' }] }),
    });

    expect(result).toEqual({ status: 'empty', count: 0 });
    expect(await listMemories()).toHaveLength(0);
  });

  it('fails closed on malformed classifier output', async () => {
    const result = await observePersistedTurn(baseRequest(async () => ({
      candidates: [{ domain: 'preference', evidence: 'I prefer the compact editor layout', extraAuthority: true }],
    })));

    expect(result).toEqual({ status: 'unavailable', count: 0 });
    expect(await listMemories()).toHaveLength(0);
  });

  it('deduplicates repeated candidates within one extraction', async () => {
    const evidence = 'I prefer the compact editor layout';
    const result = await observePersistedTurn(baseRequest(async () => ({
      candidates: [
        { domain: 'preference', evidence },
        { domain: 'preference', evidence },
      ],
    })));

    expect(result).toEqual({ status: 'recorded', count: 1 });
    expect(await listMemories()).toHaveLength(1);
  });

  it('converges a replay of the same durable user evidence onto one observation', async () => {
    const evidence = 'I prefer the compact editor layout';
    const request = baseRequest(async () => ({ candidates: [{ domain: 'preference', evidence }] }));

    const first = await observePersistedTurn(request);
    const replay = await observePersistedTurn(request);
    const memories = await listMemories();

    expect(first).toEqual({ status: 'recorded', count: 1 });
    expect(replay).toEqual({ status: 'recorded', count: 1 });
    expect(memories).toHaveLength(1);
  });

  it('skips organic formation when deliberate memory tooling already owned the turn', async () => {
    const extractor = vi.fn(async () => ({ candidates: [{ domain: 'preference', evidence: 'I prefer the compact editor layout' }] }));
    const result = await observePersistedTurn({ ...baseRequest(extractor), usedMemoryTool: true });

    expect(result).toEqual({ status: 'skipped', count: 0 });
    expect(extractor).not.toHaveBeenCalled();
    expect(await listMemories()).toHaveLength(0);
  });

  it('does not re-observe regeneration variants of an already durable user turn', async () => {
    const extractor = vi.fn(async () => ({ candidates: [{ domain: 'preference', evidence: 'I prefer the compact editor layout' }] }));
    const result = await observePersistedTurn({ ...baseRequest(extractor), responseVariant: 2 });

    expect(result).toEqual({ status: 'skipped', count: 0 });
    expect(extractor).not.toHaveBeenCalled();
  });

  it('treats classifier failure as non-fatal and leaves the store untouched', async () => {
    const result = await observePersistedTurn(baseRequest(async () => {
      throw new Error('classifier unavailable');
    }));

    expect(result).toEqual({ status: 'unavailable', count: 0 });
    expect(await listMemories()).toHaveLength(0);
  });

  it('does not begin extraction after observation authority is withdrawn', async () => {
    const extractor = vi.fn(async () => ({ candidates: [] }));
    const result = await observePersistedTurn({
      ...baseRequest(extractor),
      isMutationAllowed: () => false,
    });

    expect(result).toEqual({ status: 'skipped', count: 0 });
    expect(extractor).not.toHaveBeenCalled();
  });
});
