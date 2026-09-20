import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../persistence/conversation';
import { DEFAULT_MEMORY_BEHAVIOR } from '../domain/preferences';
import { saveMemoryBehaviorPreferences } from '../persistence/preferences';
import { listMemories, updateMemory } from './store';
import { memory } from './capability';
import { MEMORY_MAX_RELATIONSHIPS } from './normalize';
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
  await saveMemoryBehaviorPreferences(DEFAULT_MEMORY_BEHAVIOR);
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

  it('stops organic formation when conversational memory is disabled', async () => {
    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, enabled: false });
    const extractor = vi.fn(async () => ({
      candidates: [{ domain: 'preference', evidence: 'I prefer the compact editor layout' }],
    }));

    const result = await observePersistedTurn(baseRequest(extractor));

    expect(result).toEqual({ status: 'skipped', count: 0 });
    expect(extractor).not.toHaveBeenCalled();
    expect(await listMemories()).toHaveLength(0);
  });

  it('rechecks memory policy after async extraction before committing', async () => {
    const evidence = 'I prefer the compact editor layout';
    const extractor = vi.fn(async () => {
      await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, enabled: false });
      return { candidates: [{ domain: 'preference', evidence }] };
    });

    const result = await observePersistedTurn({
      ...baseRequest(extractor),
      userMessage: `For this project ${evidence}, and that preference should stick.`,
    });

    expect(extractor).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'skipped', count: 0 });
    expect(await listMemories()).toHaveLength(0);
  });

  it('keeps explicit-only remembering truly explicit by skipping the organic observer', async () => {
    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, rememberingStyle: 'explicit-only' });
    const extractor = vi.fn(async () => ({
      candidates: [{ domain: 'preference', evidence: 'I prefer the compact editor layout' }],
    }));

    const result = await observePersistedTurn(baseRequest(extractor));

    expect(result).toEqual({ status: 'skipped', count: 0 });
    expect(extractor).not.toHaveBeenCalled();
    expect(await listMemories()).toHaveLength(0);
  });

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
    expect(memories[0].source.note).toMatch(/^idempotency:organic:thread_organic:user_message_1:preference:sha256:[a-f0-9]{64}$/);
    expect(memories[0].source.note).not.toContain(evidence);
  });

  it('reinforces literal repeated evidence and promotes the original observation after a second occurrence', async () => {
    const evidence = 'I prefer the compact editor layout';
    const extractor = async () => ({ candidates: [{ domain: 'preference', evidence }] });

    await observePersistedTurn(baseRequest(extractor));
    await observePersistedTurn({ ...baseRequest(extractor), messageId: 'user_message_2' });

    const memories = await listMemories();
    expect(memories).toHaveLength(2);
    const target = memories.find((item) => item.kind === 'EPISODIC');
    expect(target).toMatchObject({
      body: evidence,
      reinforcementCount: 1,
      confidence: 0.68,
      importance: 0.39,
      lifecycle: 'active',
    });
    expect(target?.supportingMemoryIds).toHaveLength(1);
    const supporting = memories.find((item) => item.id === target?.supportingMemoryIds[0]);
    expect(supporting?.lifecycle).toBe('dormant');
  });

  it('matures repeatedly supported organic evidence to contextual but not CORE', async () => {
    const evidence = 'I prefer the compact editor layout';
    const extractor = async () => ({ candidates: [{ domain: 'preference', evidence }] });

    for (let index = 1; index <= 4; index += 1) {
      await observePersistedTurn({ ...baseRequest(extractor), messageId: `user_message_${index}` });
    }

    const memories = await listMemories();
    const target = memories.find((item) => item.kind === 'CONTEXTUAL');
    expect(target).toMatchObject({ reinforcementCount: 3, confidence: 0.84, importance: 0.47, lifecycle: 'active' });
    expect(memories.some((item) => item.kind === 'CORE')).toBe(false);
  });

  it('rolls back a new organic observation when its support target is saturated', async () => {
    const evidence = 'I prefer the compact editor layout';
    const target = await memory.save({
      title: 'Established preference',
      body: evidence,
      kind: 'CONTEXTUAL',
      confidence: 0.88,
      importance: 0.6,
      tags: ['organic', 'domain:preference'],
    });
    const full = Array.from({ length: MEMORY_MAX_RELATIONSHIPS }, (_, index) => `existing-${index}`);
    await updateMemory(target.id, { supportingMemoryIds: full, reinforcementCount: 64 });

    const result = await observePersistedTurn({
      ...baseRequest(async () => ({ candidates: [{ domain: 'preference', evidence }] })),
      messageId: 'user_message_overflow',
    });
    const memories = await listMemories();

    expect(result).toEqual({ status: 'unavailable', count: 0 });
    expect(memories).toHaveLength(1);
    expect(memories[0].id).toBe(target.id);
    expect(memories[0].supportingMemoryIds).toEqual(full);
    expect(memories[0].reinforcementCount).toBe(64);
    expect(memories[0].confidence).toBe(0.88);
  });

  it('does not infer semantic support from differently worded evidence', async () => {
    const firstEvidence = 'I prefer the compact editor layout';
    await observePersistedTurn(baseRequest(async () => ({ candidates: [{ domain: 'preference', evidence: firstEvidence }] })));

    const secondMessage = 'For this project, compact layouts are my preference and I want to keep them.';
    const secondEvidence = 'compact layouts are my preference';
    await observePersistedTurn({
      conversationId: 'thread_organic',
      messageId: 'user_message_2',
      userMessage: secondMessage,
      extractor: async () => ({ candidates: [{ domain: 'preference', evidence: secondEvidence }] }),
    });

    const memories = await listMemories();
    expect(memories).toHaveLength(2);
    expect(memories.every((item) => item.kind === 'MICRO_OBSERVATION')).toBe(true);
    expect(memories.every((item) => item.reinforcementCount === 0)).toBe(true);
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
  it('deterministically rejects common bare credential formats without relying on labels', async () => {
    const samples = [
      ['AK', 'IA1234567890ABCDEF'].join(''),
      ['AI', 'zaSyA1234567890bcdefghijklmnopqrstuv'].join(''),
      ['gh', 'p_1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcd'].join(''),
      ['xo', 'xb-123456789012-123456789012-abcdefghijklmnopqrstuv'].join(''),
      ['ey', 'Jabcdefghijk.abcdefghijklmnop.abcdefghijklmnop'].join(''),
    ];

    for (let index = 0; index < samples.length; index += 1) {
      const evidence = samples[index];
      const result = await observePersistedTurn({
        conversationId: 'thread_organic',
        messageId: `bare_secret_${index}`,
        userMessage: `Keep this recurring project value: ${evidence}`,
        extractor: async () => ({ candidates: [{ domain: 'persistent_fact', evidence }] }),
      });
      expect(result).toEqual({ status: 'empty', count: 0 });
    }

    expect(await listMemories()).toHaveLength(0);
  });


  it('rejects Luhn-valid payment-card-like evidence from automatic memory', async () => {
    const evidence = '4111 1111 1111 1111';
    const result = await observePersistedTurn({
      conversationId: 'thread_organic',
      messageId: 'card_secret_1',
      userMessage: `My recurring payment reference is ${evidence}`,
      extractor: async () => ({ candidates: [{ domain: 'persistent_fact', evidence }] }),
    });

    expect(result).toEqual({ status: 'empty', count: 0 });
    expect(await listMemories()).toHaveLength(0);
  });


});
