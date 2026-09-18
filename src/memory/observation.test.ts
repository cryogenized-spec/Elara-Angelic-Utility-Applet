import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { getMemory, updateMemory } from './store';
import { consolidateObservation, recordObservation, supersedeMemory } from './observation';
import { memory } from './capability';
import { MEMORY_MAX_RELATIONSHIPS } from './normalize';

describe('memory observation and consolidation', () => {
  beforeEach(async () => { await db.memories.clear(); });

  it('records evidence as a micro-observation with application provenance', async () => {
    const observation = await recordObservation(
      { title: 'Observed preference', body: 'The user explicitly prefers dark mode.', tags: ['preference'] },
      { conversationId: 'thread-1', messageId: 'message-1' },
    );

    expect(observation.kind).toBe('MICRO_OBSERVATION');
    expect(observation.source.source).toBe('elara');
    expect(observation.source.conversationId).toBe('thread-1');
    expect(observation.reinforcementCount).toBe(0);
  });

  it('consolidates supporting evidence exactly once under replay', async () => {
    const target = await memory.save({ title: 'Dark mode preference', body: 'The user prefers dark mode.', kind: 'CONTEXTUAL' });
    const observation = await recordObservation({ title: 'Supporting observation', body: 'The user selected dark mode again.' });

    const result = await consolidateObservation(observation.id, target.id, 'support');
    const replay = await consolidateObservation(observation.id, target.id, 'support');

    expect(result.supportingMemoryIds).toContain(observation.id);
    expect(result.reinforcementCount).toBe(1);
    expect(result.confidence).toBeGreaterThan(target.confidence);
    expect(replay.reinforcementCount).toBe(1);
    expect(replay.body).toBe(target.body);
    expect((await getMemory(observation.id))?.lifecycle).toBe('dormant');
  });

  it('fails closed before changing weight when a relationship array is saturated', async () => {
    const full = Array.from({ length: MEMORY_MAX_RELATIONSHIPS }, (_, index) => `existing-${index}`);

    for (const relation of ['support', 'conflict', 'related'] as const) {
      const target = await memory.save({ title: `${relation} target`, body: `Target for ${relation}.`, confidence: 0.7 });
      const observation = await recordObservation({ title: `${relation} evidence`, body: `Fresh ${relation} evidence.` });
      const patch = relation === 'support'
        ? { supportingMemoryIds: full }
        : relation === 'conflict'
          ? { conflictingMemoryIds: full }
          : { relatedMemoryIds: full };
      await updateMemory(target.id, patch);

      await expect(consolidateObservation(observation.id, target.id, relation)).rejects.toThrow('relationship capacity reached');
      const unchanged = await getMemory(target.id);
      expect(unchanged?.reinforcementCount).toBe(0);
      expect(unchanged?.confidence).toBe(0.7);
      expect((await getMemory(observation.id))?.lifecycle).toBe('active');
    }
  });

  it('keeps an already-linked saturated support replay idempotent', async () => {
    const target = await memory.save({ title: 'Saturated target', body: 'Stable target.', confidence: 0.7 });
    const observation = await recordObservation({ title: 'Existing evidence', body: 'Already consolidated evidence.' });
    const full = [observation.id, ...Array.from({ length: MEMORY_MAX_RELATIONSHIPS - 1 }, (_, index) => `existing-${index}`)];
    await updateMemory(target.id, { supportingMemoryIds: full, reinforcementCount: 9, confidence: 0.9 });

    const replay = await consolidateObservation(observation.id, target.id, 'support');
    expect(replay.reinforcementCount).toBe(9);
    expect(replay.confidence).toBe(0.9);
    expect(replay.supportingMemoryIds).toHaveLength(MEMORY_MAX_RELATIONSHIPS);
  });

  it('rejects reclassifying already-consolidated evidence', async () => {
    const target = await memory.save({ title: 'Preference', body: 'The user prefers dark mode.' });
    const observation = await recordObservation({ title: 'Evidence', body: 'The user selected dark mode again.' });
    await consolidateObservation(observation.id, target.id, 'support');
    await expect(consolidateObservation(observation.id, target.id, 'conflict')).rejects.toThrow('different relation');
  });

  it('retains contradictory evidence without overwriting the target or promoting it', async () => {
    const target = await memory.save({ title: 'Preference', body: 'The user prefers dark mode.', kind: 'CORE' });
    const observation = await recordObservation({ title: 'Contradictory observation', body: 'The user explicitly requested light mode.' });

    const result = await consolidateObservation(observation.id, target.id, 'conflict');

    expect(result.conflictingMemoryIds).toContain(observation.id);
    expect(result.body).toBe(target.body);
    expect(result.reinforcementCount).toBe(0);
    expect((await getMemory(observation.id))?.lifecycle).toBe('active');
  });

  it('links related evidence without changing target confidence or prose', async () => {
    const target = await memory.save({ title: 'Project note', body: 'The project uses TypeScript.', confidence: 0.8 });
    const observation = await recordObservation({ title: 'Related detail', body: 'The project uses Vite.' });

    const result = await consolidateObservation(observation.id, target.id, 'related');

    expect(result.relatedMemoryIds).toContain(observation.id);
    expect(result.confidence).toBe(0.8);
    expect(result.body).toBe('The project uses TypeScript.');
    expect((await getMemory(observation.id))?.lifecycle).toBe('dormant');
  });

  it('links supersession bidirectionally, dormants the old memory, and keeps it inspectable', async () => {
    const target = await memory.save({ title: 'Old preference', body: 'The user prefers the old layout.', kind: 'CORE' });
    const result = await supersedeMemory(target.id, { title: 'New preference', body: 'The user now explicitly prefers the new layout.' });

    expect(result.replacement.kind).toBe('CONTEXTUAL');
    expect(result.replacement.supersedes).toContain(target.id);
    expect(result.target.supersededBy).toContain(result.replacement.id);
    expect(result.target.lifecycle).toBe('dormant');
    expect(await getMemory(target.id)).toMatchObject({ lifecycle: 'dormant', body: target.body });
  });

  it('fails closed before creating a replacement when supersession capacity is saturated', async () => {
    const target = await memory.save({ title: 'Old preference', body: 'Historical preference.', kind: 'CORE' });
    const full = Array.from({ length: MEMORY_MAX_RELATIONSHIPS }, (_, index) => `replacement-${index}`);
    await updateMemory(target.id, { supersededBy: full, lifecycle: 'dormant' });
    const countBefore = await db.memories.count();

    await expect(supersedeMemory(target.id, { title: 'Overflow replacement', body: 'Must not be created.' }))
      .rejects.toThrow('supersession relationship capacity reached');
    expect(await db.memories.count()).toBe(countBefore);
    expect((await getMemory(target.id))?.supersededBy).toEqual(full);
  });

  it('keeps an idempotent supersession replay valid after the first call fills the final relationship slot', async () => {
    const target = await memory.save({ title: 'Nearly saturated preference', body: 'Historical preference.', kind: 'CORE' });
    const existing = Array.from({ length: MEMORY_MAX_RELATIONSHIPS - 1 }, (_, index) => `replacement-${index}`);
    await updateMemory(target.id, { supersededBy: existing });
    const request = { title: 'Final replacement', body: 'The durable replacement that consumes the last slot.' };
    const context = {
      actor: 'model' as const,
      conversationId: 'thread-replay',
      messageId: 'message-replay',
      idempotencyKey: 'thread-replay:message-replay:generation-1:call-1',
      isMutationAllowed: () => true,
    };

    const first = await supersedeMemory(target.id, request, context);
    expect(first.target.supersededBy).toHaveLength(MEMORY_MAX_RELATIONSHIPS);
    expect(first.target.supersededBy).toContain(first.replacement.id);
    expect(first.replacement.supersedes).toContain(target.id);
    expect(await db.memories.count()).toBe(2);

    const replay = await supersedeMemory(target.id, request, context);
    expect(replay.replacement.id).toBe(first.replacement.id);
    expect(replay.target.supersededBy).toHaveLength(MEMORY_MAX_RELATIONSHIPS);
    expect(await db.memories.count()).toBe(2);

    await expect(supersedeMemory(target.id, { ...request, body: 'Changed replay payload.' }, context))
      .rejects.toThrow('replay does not match the original mutation');
    expect(await db.memories.count()).toBe(2);

    await expect(supersedeMemory(target.id, request, { ...context, idempotencyKey: 'thread-replay:message-replay:generation-1:call-2' }))
      .rejects.toThrow('supersession relationship capacity reached');
    expect(await db.memories.count()).toBe(2);
  });

  it('retains episodic kind when superseding an episodic memory', async () => {
    const target = await memory.save({ title: 'Old event', body: 'The event happened at noon.', kind: 'EPISODIC' });
    const result = await supersedeMemory(target.id, { title: 'Corrected event', body: 'The user corrected the event time to 13:00.' });
    expect(result.replacement.kind).toBe('EPISODIC');
    expect(result.target.lifecycle).toBe('dormant');
  });

  it('rejects invalid consolidation and supersession targets', async () => {
    const observation = await recordObservation({ title: 'Observation', body: 'Evidence.' });
    await expect(consolidateObservation(observation.id, observation.id, 'support')).rejects.toThrow('cannot consolidate against itself');
    await expect(consolidateObservation(observation.id, 'missing-memory', 'support')).rejects.toThrow('Target memory not found');
    await expect(supersedeMemory(observation.id, { title: 'Replacement', body: 'Replacement.' })).rejects.toThrow('Micro-observations cannot be superseded');
  });
});
