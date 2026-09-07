import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { inspectMemoryStore, normalizeInvalidMemoryId } from './health';
import { saveMemory } from './store';

describe('durable memory health scan', () => {
  beforeEach(async () => { await db.memories.clear(); });

  it('reports a clean store without mutating records', async () => {
    const memory = await saveMemory({ title: 'Healthy record', body: 'A valid durable memory.' });
    const before = await db.memories.get(memory.id);

    await expect(inspectMemoryStore()).resolves.toEqual({
      total: 1,
      valid: 1,
      invalid: 0,
      invalidIds: [],
    });

    await expect(db.memories.get(memory.id)).resolves.toEqual(before);
  });

  it('surfaces malformed records without deleting or rewriting them', async () => {
    await saveMemory({ title: 'Healthy record', body: 'A valid durable memory.' });
    await db.memories.put({ id: 'memory_corrupt', title: 'Broken record' } as never);

    const health = await inspectMemoryStore();
    expect(health.total).toBe(2);
    expect(health.valid).toBe(1);
    expect(health.invalid).toBe(1);
    expect(health.invalidIds).toEqual(['memory_corrupt']);
    await expect(db.memories.get('memory_corrupt')).resolves.toEqual({ id: 'memory_corrupt', title: 'Broken record' });
  });

  it('marks malformed records without usable ids as unknown', () => {
    expect(normalizeInvalidMemoryId({ title: 'No id' })).toBe('<unknown>');
    expect(normalizeInvalidMemoryId({ id: '' })).toBe('<unknown>');
    expect(normalizeInvalidMemoryId({ id: '  ' })).toBe('<unknown>');
    expect(normalizeInvalidMemoryId({ id: 'memory_known' })).toBe('memory_known');
    expect(normalizeInvalidMemoryId(null)).toBe('<unknown>');
  });
});
