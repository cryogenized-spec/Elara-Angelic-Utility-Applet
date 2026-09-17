import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { deleteInvalidMemoryRecord, inspectMemoryStore, normalizeInvalidMemoryId } from './health';
import { listMemories, saveMemory } from './store';

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

  it('uses primary-table enumeration so missing indexed fields remain visible to health while functional reads survive', async () => {
    const healthy = await saveMemory({ title: 'Healthy record', body: 'Still recallable.' });
    await db.memories.put({ id: 'memory_missing_updated_at', title: 'Partial row' } as never);

    await expect(listMemories()).resolves.toEqual([expect.objectContaining({ id: healthy.id })]);
    await expect(inspectMemoryStore()).resolves.toMatchObject({
      total: 2,
      valid: 1,
      invalid: 1,
      invalidIds: ['memory_missing_updated_at'],
    });
  });

  it('removes only a concrete row that is still invalid at repair time', async () => {
    const healthy = await saveMemory({ title: 'Healthy record', body: 'Must never be removed by repair.' });
    await db.memories.put({ id: 'memory_corrupt', title: 'Broken record' } as never);

    await expect(deleteInvalidMemoryRecord(healthy.id)).rejects.toThrow(/valid memory records cannot be removed/i);
    await expect(deleteInvalidMemoryRecord('memory_corrupt')).resolves.toBeUndefined();
    await expect(db.memories.get(healthy.id)).resolves.toBeDefined();
    await expect(db.memories.get('memory_corrupt')).resolves.toBeUndefined();
    await expect(deleteInvalidMemoryRecord('<unknown>')).rejects.toThrow(/concrete invalid memory id/i);
  });

  it('preserves whitespace-sensitive primary keys when removing a reported corrupt row', async () => {
    const exactId = '  memory_corrupt_whitespace  ';
    await db.memories.put({ id: exactId, title: 'Broken whitespace-key record' } as never);

    await expect(inspectMemoryStore()).resolves.toMatchObject({ invalidIds: [exactId] });
    await expect(deleteInvalidMemoryRecord(exactId)).resolves.toBeUndefined();
    await expect(db.memories.get(exactId)).resolves.toBeUndefined();
  });

  it('marks malformed records without usable ids as unknown', () => {
    expect(normalizeInvalidMemoryId({ title: 'No id' })).toBe('<unknown>');
    expect(normalizeInvalidMemoryId({ id: '' })).toBe('<unknown>');
    expect(normalizeInvalidMemoryId({ id: '  ' })).toBe('<unknown>');
    expect(normalizeInvalidMemoryId({ id: 'memory_known' })).toBe('memory_known');
    expect(normalizeInvalidMemoryId(null)).toBe('<unknown>');
  });
});