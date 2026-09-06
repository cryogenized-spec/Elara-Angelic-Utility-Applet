import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { getMemory } from './store';
import { consolidateObservation, recordObservation } from './observation';
import { memory } from './capability';

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

  it('consolidates supporting evidence by linking and reinforcing the target', async () => {
    const target = await memory.save({ title: 'Dark mode preference', body: 'The user prefers dark mode.', kind: 'CONTEXTUAL' });
    const observation = await recordObservation({ title: 'Supporting observation', body: 'The user selected dark mode again.' });

    const result = await consolidateObservation(observation.id, target.id, 'support');

    expect(result.supportingMemoryIds).toContain(observation.id);
    expect(result.reinforcementCount).toBe(1);
    expect(result.body).toBe(target.body);
  });

  it('retains contradictory evidence without overwriting the target', async () => {
    const target = await memory.save({ title: 'Preference', body: 'The user prefers dark mode.', kind: 'CORE' });
    const observation = await recordObservation({ title: 'Contradictory observation', body: 'The user explicitly requested light mode.' });

    const result = await consolidateObservation(observation.id, target.id, 'conflict');

    expect(result.conflictingMemoryIds).toContain(observation.id);
    expect(result.body).toBe(target.body);
    expect(result.reinforcementCount).toBe(0);
    expect(await getMemory(observation.id)).toEqual(observation);
  });

  it('links related evidence without changing target confidence or prose', async () => {
    const target = await memory.save({ title: 'Project note', body: 'The project uses TypeScript.', confidence: 0.8 });
    const observation = await recordObservation({ title: 'Related detail', body: 'The project uses Vite.' });

    const result = await consolidateObservation(observation.id, target.id, 'related');

    expect(result.relatedMemoryIds).toContain(observation.id);
    expect(result.confidence).toBe(0.8);
    expect(result.body).toBe('The project uses TypeScript.');
  });

  it('rejects invalid consolidation targets and duplicate self-links', async () => {
    const observation = await recordObservation({ title: 'Observation', body: 'Evidence.' });
    await expect(consolidateObservation(observation.id, observation.id, 'support')).rejects.toThrow('cannot consolidate against itself');
    await expect(consolidateObservation(observation.id, 'missing-memory', 'support')).rejects.toThrow('Target memory not found');
  });
});
