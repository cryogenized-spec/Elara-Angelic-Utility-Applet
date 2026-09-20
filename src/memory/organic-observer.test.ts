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
  rememberingStyleAllowsSalience,
  shouldInspectUserMessage,
  type OrganicMemoryCandidate,
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

function candidate(
  evidence: string,
  overrides: Partial<OrganicMemoryCandidate> = {},
): OrganicMemoryCandidate {
  return {
    domain: 'preference',
    category: 'likes_dislikes',
    salience: 'medium',
    evidence,
    ...overrides,
  };
}

describe('bounded organic memory observer', () => {
  beforeEach(resetMemoryState);

  it('stops organic formation when conversational memory is disabled', async () => {
    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, enabled: false });
    const extractor = vi.fn(async () => ({
      candidates: [candidate('I prefer the compact editor layout')],
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
      return { candidates: [candidate(evidence)] };
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
      candidates: [candidate('I prefer the compact editor layout')],
    }));

    const result = await observePersistedTurn(baseRequest(extractor));

    expect(result).toEqual({ status: 'skipped', count: 0 });
    expect(extractor).not.toHaveBeenCalled();
    expect(await listMemories()).toHaveLength(0);
  });

  it('applies remembering-style salience thresholds deterministically', () => {
    expect(rememberingStyleAllowsSalience('explicit-only', 'high')).toBe(false);
    expect(rememberingStyleAllowsSalience('selective', 'medium')).toBe(false);
    expect(rememberingStyleAllowsSalience('selective', 'high')).toBe(true);
    expect(rememberingStyleAllowsSalience('natural', 'low')).toBe(false);
    expect(rememberingStyleAllowsSalience('natural', 'medium')).toBe(true);
    expect(rememberingStyleAllowsSalience('attentive', 'low')).toBe(true);
  });

  it('uses the persisted remembering style to gate organic formation', async () => {
    const evidence = 'I prefer the compact editor layout';

    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, rememberingStyle: 'selective' });
    expect(await observePersistedTurn(baseRequest(async () => ({
      candidates: [candidate(evidence, { salience: 'medium' })],
    })))).toEqual({ status: 'empty', count: 0 });
    expect(await listMemories()).toHaveLength(0);

    expect(await observePersistedTurn({
      ...baseRequest(async () => ({ candidates: [candidate(evidence, { salience: 'high' })] })),
      messageId: 'user_message_high',
    })).toEqual({ status: 'recorded', count: 1 });

    await db.memories.clear();
    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, rememberingStyle: 'natural' });
    expect(await observePersistedTurn(baseRequest(async () => ({
      candidates: [candidate(evidence, { salience: 'low' })],
    })))).toEqual({ status: 'empty', count: 0 });

    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, rememberingStyle: 'attentive' });
    expect(await observePersistedTurn({
      ...baseRequest(async () => ({ candidates: [candidate(evidence, { salience: 'low' })] })),
      messageId: 'user_message_low',
    })).toEqual({ status: 'recorded', count: 1 });
  });

  it('enforces per-category automatic-memory permissions at commit time', async () => {
    const evidence = 'My cat is named Piesang';
    await saveMemoryBehaviorPreferences({
      ...DEFAULT_MEMORY_BEHAVIOR,
      categories: { ...DEFAULT_MEMORY_BEHAVIOR.categories, pets: false },
    });

    const blocked = await observePersistedTurn({
      ...baseRequest(async () => ({
        candidates: [candidate(evidence, { domain: 'persistent_fact', category: 'pets', salience: 'high' })],
      })),
      userMessage: evidence,
    });
    expect(blocked).toEqual({ status: 'empty', count: 0 });
    expect(await listMemories()).toHaveLength(0);

    await saveMemoryBehaviorPreferences({
      ...DEFAULT_MEMORY_BEHAVIOR,
      categories: { ...DEFAULT_MEMORY_BEHAVIOR.categories, pets: true },
    });
    const allowed = await observePersistedTurn({
      ...baseRequest(async () => ({
        candidates: [candidate(evidence, { domain: 'persistent_fact', category: 'pets', salience: 'high' })],
      })),
      messageId: 'user_message_pet_allowed',
      userMessage: evidence,
    });
    expect(allowed).toEqual({ status: 'recorded', count: 1 });
    expect((await listMemories())[0]?.tags).toContain('category:pets');
  });

  it('keeps sensitive categories default-off and rejects obvious category downgrades', async () => {
    const evidence = 'I was diagnosed with diabetes';

    const correctlyClassified = await observePersistedTurn({
      ...baseRequest(async () => ({
        candidates: [candidate(evidence, { domain: 'persistent_fact', category: 'health_wellbeing', salience: 'high' })],
      })),
      userMessage: evidence,
    });
    expect(correctlyClassified).toEqual({ status: 'empty', count: 0 });

    const downgraded = await observePersistedTurn({
      ...baseRequest(async () => ({
        candidates: [candidate(evidence, { domain: 'persistent_fact', category: 'personal_facts', salience: 'high' })],
      })),
      messageId: 'user_message_health_downgrade',
      userMessage: evidence,
    });
    expect(downgraded).toEqual({ status: 'empty', count: 0 });
    expect(await listMemories()).toHaveLength(0);

    await saveMemoryBehaviorPreferences({
      ...DEFAULT_MEMORY_BEHAVIOR,
      categories: { ...DEFAULT_MEMORY_BEHAVIOR.categories, health_wellbeing: true },
    });
    const explicitlyEnabled = await observePersistedTurn({
      ...baseRequest(async () => ({
        candidates: [candidate(evidence, { domain: 'persistent_fact', category: 'health_wellbeing', salience: 'high' })],
      })),
      messageId: 'user_message_health_enabled',
      userMessage: evidence,
    });
    expect(explicitlyEnabled).toEqual({ status: 'recorded', count: 1 });
    expect((await listMemories())[0]?.tags).toContain('category:health_wellbeing');
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
      candidates: [candidate(evidence)],
    })));
    const memories = await listMemories();

    expect(result).toEqual({ status: 'recorded', count: 1 });
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      kind: 'MICRO_OBSERVATION',
      title: 'Observed preference',
      body: evidence,
      tags: ['organic', 'domain:preference', 'category:likes_dislikes', 'salience:medium'],
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
    const extractor = async () => ({ candidates: [candidate(evidence)] });

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
    const extractor = async () => ({ candidates: [candidate(evidence)] });

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
      ...baseRequest(async () => ({ candidates: [candidate(evidence)] })),
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
    await observePersistedTurn(baseRequest(async () => ({ candidates: [candidate(firstEvidence)] })));

    const secondMessage = 'For this project, compact layouts are my preference and I want to keep them.';
    const secondEvidence = 'compact layouts are my preference';
    await observePersistedTurn({
      conversationId: 'thread_organic',
      messageId: 'user_message_2',
      userMessage: secondMessage,
      extractor: async () => ({ candidates: [candidate(secondEvidence)] }),
    });

    const memories = await listMemories();
    expect(memories).toHaveLength(2);
    expect(memories.every((item) => item.kind === 'MICRO_OBSERVATION')).toBe(true);
    expect(memories.every((item) => item.reinforcementCount === 0)).toBe(true);
  });

  it('rejects model paraphrases instead of allowing the classifier to author facts', async () => {
    const result = await observePersistedTurn(baseRequest(async () => ({
      candidates: [candidate('The user always wants a compact interface.')],
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
      extractor: async () => ({ candidates: [candidate('my API key is EXAMPLE_NOT_A_REAL_SECRET_12345', { domain: 'persistent_fact', category: 'personal_facts' })] }),
    });

    expect(result).toEqual({ status: 'empty', count: 0 });
    expect(await listMemories()).toHaveLength(0);
  });

  it('fails closed on malformed classifier output', async () => {
    const result = await observePersistedTurn(baseRequest(async () => ({
      candidates: [{ ...candidate('I prefer the compact editor layout'), extraAuthority: true }],
    })));

    expect(result).toEqual({ status: 'unavailable', count: 0 });
    expect(await listMemories()).toHaveLength(0);
  });

  it('deduplicates repeated candidates within one extraction', async () => {
    const evidence = 'I prefer the compact editor layout';
    const result = await observePersistedTurn(baseRequest(async () => ({
      candidates: [
        candidate(evidence),
        candidate(evidence),
      ],
    })));

    expect(result).toEqual({ status: 'recorded', count: 1 });
    expect(await listMemories()).toHaveLength(1);
  });

  it('converges a replay of the same durable user evidence onto one observation', async () => {
    const evidence = 'I prefer the compact editor layout';
    const request = baseRequest(async () => ({ candidates: [candidate(evidence)] }));

    const first = await observePersistedTurn(request);
    const replay = await observePersistedTurn(request);
    const memories = await listMemories();

    expect(first).toEqual({ status: 'recorded', count: 1 });
    expect(replay).toEqual({ status: 'recorded', count: 1 });
    expect(memories).toHaveLength(1);
  });

  it('skips organic formation when deliberate memory tooling already owned the turn', async () => {
    const extractor = vi.fn(async () => ({ candidates: [candidate('I prefer the compact editor layout')] }));
    const result = await observePersistedTurn({ ...baseRequest(extractor), usedMemoryTool: true });

    expect(result).toEqual({ status: 'skipped', count: 0 });
    expect(extractor).not.toHaveBeenCalled();
    expect(await listMemories()).toHaveLength(0);
  });

  it('does not re-observe regeneration variants of an already durable user turn', async () => {
    const extractor = vi.fn(async () => ({ candidates: [candidate('I prefer the compact editor layout')] }));
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
