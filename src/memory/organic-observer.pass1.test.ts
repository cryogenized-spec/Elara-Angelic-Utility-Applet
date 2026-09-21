import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { DEFAULT_MEMORY_BEHAVIOR } from '../domain/preferences';
import { saveMemoryBehaviorPreferences } from '../persistence/preferences';
import { listMemories } from './store';
import {
  ORGANIC_OBSERVATION_CONFIDENCE,
  ORGANIC_OBSERVATION_IMPORTANCE,
  observePersistedTurn,
  type OrganicMemoryCandidate,
} from './organic-observer';

/**
 * Companion continuity Pass 1 — opportunistic micro-observation capture.
 *
 * Attentive remembering must notice small useful details (name corrections,
 * nicknames, roles, tool/UI conventions, decision rationales, recurring
 * terminology, small habits) and retain them as low-authority
 * MICRO_OBSERVATION evidence. Capture breadth widens; authority, policy
 * gates, idempotency and style boundaries do not.
 */

async function resetMemoryState(): Promise<void> {
  await db.transaction('rw', db.memories, db.folders, db.folderAssignments, async () => {
    await db.memories.clear();
    await db.folders.clear();
    await db.folderAssignments.clear();
  });
  await saveMemoryBehaviorPreferences(DEFAULT_MEMORY_BEHAVIOR);
}

function candidate(evidence: string, overrides: Partial<OrganicMemoryCandidate> = {}): OrganicMemoryCandidate {
  return {
    domain: 'persistent_fact',
    category: 'personal_facts',
    salience: 'low',
    evidence,
    ...overrides,
  };
}

describe('Pass 1 attentive small-detail capture', () => {
  beforeEach(resetMemoryState);

  it('retains small useful details in attentive mode as low-authority micro-observation evidence', async () => {
    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, rememberingStyle: 'attentive' });

    const cases = [
      {
        evidence: 'my name is actually Danielle, not Daniela',
        domain: 'persistent_fact' as const,
        category: 'personal_facts' as const,
      },
      {
        evidence: 'everyone calls me Dex anyway',
        domain: 'persistent_fact' as const,
        category: 'personal_facts' as const,
      },
      {
        evidence: 'Jordan is my team lead',
        domain: 'persistent_fact' as const,
        category: 'people_relationships' as const,
      },
      {
        evidence: 'in this project I use Noto outline emoji, not Iconoir',
        domain: 'preference' as const,
        category: 'interests_hobbies_projects' as const,
      },
      {
        evidence: 'the icon looked cramped next to the title so I moved it',
        domain: 'project_decision' as const,
        category: 'interests_hobbies_projects' as const,
      },
    ];

    for (const [index, item] of cases.entries()) {
      const result = await observePersistedTurn({
        conversationId: 'thread-pass1',
        messageId: `user_message_pass1_${index}`,
        userMessage: item.evidence,
        extractor: async () => ({ candidates: [candidate(item.evidence, { domain: item.domain, category: item.category, salience: 'low' })] }),
      });
      expect(result).toEqual({ status: 'recorded', count: 1 });
    }

    const memories = await listMemories();
    expect(memories).toHaveLength(cases.length);
    for (const memory of memories) {
      expect(memory.kind).toBe('MICRO_OBSERVATION');
      expect(memory.lifecycle).toBe('active');
      expect(memory.confidence).toBe(ORGANIC_OBSERVATION_CONFIDENCE);
      expect(memory.importance).toBe(ORGANIC_OBSERVATION_IMPORTANCE);
      expect(memory.reinforcementCount).toBe(0);
      expect(memory.tags).toContain('salience:low');
      expect(memory.tags).toContain('organic');
    }
  });

  it('never inflates confidence or importance for attentive low-salience capture', async () => {
    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, rememberingStyle: 'attentive' });
    const evidence = 'my name is actually Danielle, not Daniela';

    await observePersistedTurn({
      conversationId: 'thread-pass1-weights',
      messageId: 'user_message_weights_low',
      userMessage: evidence,
      extractor: async () => ({ candidates: [candidate(evidence)] }),
    });
    await observePersistedTurn({
      conversationId: 'thread-pass1-weights',
      messageId: 'user_message_weights_high',
      userMessage: 'I have a big commitment on Friday.',
      extractor: async () => ({ candidates: [candidate('I have a big commitment on Friday.', { domain: 'commitment', category: 'goals_plans_commitments', salience: 'high' })] }),
    });

    const memories = await listMemories();
    const low = memories.find((memory) => memory.tags.includes('salience:low'));
    const high = memories.find((memory) => memory.tags.includes('salience:high'));
    expect(low).toBeDefined();
    expect(high).toBeDefined();
    expect(low?.confidence).toBe(ORGANIC_OBSERVATION_CONFIDENCE);
    expect(low?.importance).toBe(ORGANIC_OBSERVATION_IMPORTANCE);
    expect(high?.confidence).toBe(ORGANIC_OBSERVATION_CONFIDENCE);
    expect(high?.importance).toBe(ORGANIC_OBSERVATION_IMPORTANCE);
  });

  it('keeps low-salience details out of natural and selective capture without changing their authority', async () => {
    const evidence = 'my name is actually Danielle, not Daniela';

    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, rememberingStyle: 'natural' });
    expect(await observePersistedTurn({
      conversationId: 'thread-pass1-natural',
      messageId: 'user_message_natural',
      userMessage: evidence,
      extractor: async () => ({ candidates: [candidate(evidence)] }),
    })).toEqual({ status: 'empty', count: 0 });
    expect(await listMemories()).toHaveLength(0);

    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, rememberingStyle: 'selective' });
    expect(await observePersistedTurn({
      conversationId: 'thread-pass1-selective',
      messageId: 'user_message_selective',
      userMessage: evidence,
      extractor: async () => ({ candidates: [candidate(evidence, { salience: 'high' })] }),
    })).toEqual({ status: 'recorded', count: 1 });
    expect(await listMemories()).toHaveLength(1);
    expect((await listMemories())[0]?.confidence).toBe(ORGANIC_OBSERVATION_CONFIDENCE);
  });

  it('converges a replay of the same small detail onto one observation', async () => {
    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, rememberingStyle: 'attentive' });
    const evidence = 'my name is actually Danielle, not Daniela';
    const request = {
      conversationId: 'thread-pass1-replay',
      messageId: 'user_message_replay',
      userMessage: evidence,
      extractor: async () => ({ candidates: [candidate(evidence)] }),
    };

    const first = await observePersistedTurn(request);
    const replay = await observePersistedTurn(request);

    expect(first).toEqual({ status: 'recorded', count: 1 });
    expect(replay).toEqual({ status: 'recorded', count: 1 });
    expect(await listMemories()).toHaveLength(1);
  });

  it('does not re-capture regeneration variants of the same small detail', async () => {
    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, rememberingStyle: 'attentive' });
    const extractor = async () => ({ candidates: [candidate('my name is actually Danielle, not Daniela')] });
    const base = {
      conversationId: 'thread-pass1-variant',
      messageId: 'user_message_variant',
      userMessage: 'my name is actually Danielle, not Daniela',
      extractor,
    };

    await expect(observePersistedTurn({ ...base, responseVariant: 2 })).resolves.toEqual({ status: 'skipped', count: 0 });
    expect(await listMemories()).toHaveLength(0);
  });

  it('still rejects credential-shaped small details before persistence', async () => {
    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, rememberingStyle: 'attentive' });
    const userMessage = 'By the way, my API key is EXAMPLE_NOT_A_REAL_SECRET_98765 and it is for our project.';

    const result = await observePersistedTurn({
      conversationId: 'thread-pass1-credentials',
      messageId: 'user_message_credentials',
      userMessage,
      extractor: async () => ({ candidates: [candidate('my API key is EXAMPLE_NOT_A_REAL_SECRET_98765', { domain: 'preference', category: 'work_study_practical_life' })] }),
    });

    expect(result).toEqual({ status: 'empty', count: 0 });
    expect(await listMemories()).toHaveLength(0);
  });

  it('keeps sensitive default-off categories closed to small-detail capture', async () => {
    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, rememberingStyle: 'attentive' });
    const evidence = 'my home address is 12 Example Street';

    const result = await observePersistedTurn({
      conversationId: 'thread-pass1-sensitive',
      messageId: 'user_message_sensitive',
      userMessage: evidence,
      extractor: async () => ({ candidates: [candidate(evidence, { category: 'precise_location_home' })] }),
    });

    expect(result).toEqual({ status: 'empty', count: 0 });
    expect(await listMemories()).toHaveLength(0);
  });

  it('still skips trivial turns without invoking the classifier in attentive mode', async () => {
    await saveMemoryBehaviorPreferences({ ...DEFAULT_MEMORY_BEHAVIOR, rememberingStyle: 'attentive' });
    const extractor = async () => ({ candidates: [candidate('nothing durable here')] });

    const result = await observePersistedTurn({
      conversationId: 'thread-pass1-trivial',
      messageId: 'user_message_trivial',
      userMessage: 'Got it.',
      extractor,
    });

    expect(result).toEqual({ status: 'skipped', count: 0 });
    expect(await listMemories()).toHaveLength(0);
  });
});
