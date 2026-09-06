import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { getMemory } from './store';
import {
  DEFAULT_MEMORY_PERMISSION_POLICY,
  getMemoryPermissionPolicy,
  resetMemoryPermissionPolicy,
  setMemoryPermissionPolicy,
} from './permissions';
import { memory } from './capability';
import { recordObservation, consolidateObservation } from './observation';

describe('memory permission boundary', () => {
  beforeEach(async () => {
    await db.memories.clear();
    resetMemoryPermissionPolicy();
  });

  it('denies model-forget and model-delete by default', async () => {
    const record = await memory.save({ title: 'Protected', body: 'Keep this memory.' });

    await expect(memory.forget(record.id)).rejects.toThrow('Memory permission denied: forget');
    await expect(memory.delete(record.id)).rejects.toThrow('Memory permission denied: delete');
    expect(await getMemory(record.id)).toEqual(record);
  });

  it('allows explicit user forget and archives the record without destroying it', async () => {
    const record = await memory.save({ title: 'Forgettable', body: 'Archive me.' });

    const forgotten = await memory.forget(record.id, { actor: 'user' });
    expect(forgotten.lifecycle).toBe('archived');
    expect(await getMemory(record.id)).toEqual(forgotten);
  });

  it('allows explicit user delete and removes the record', async () => {
    const record = await memory.save({ title: 'Disposable', body: 'Delete me.' });

    await memory.delete(record.id, { actor: 'user' });
    expect(await getMemory(record.id)).toBeUndefined();
  });

  it('supports granular policy changes without weakening unrelated permissions', async () => {
    setMemoryPermissionPolicy({ model: { forget: true } });
    const policy = getMemoryPermissionPolicy();

    expect(policy.model).toEqual({
      ...DEFAULT_MEMORY_PERMISSION_POLICY.model,
      forget: true,
    });
    expect(policy.model.delete).toBe(false);
  });

  it('checks policy before observation consolidation', async () => {
    const target = await memory.save({ title: 'Established', body: 'Original claim.' });
    const observation = await recordObservation({ title: 'Evidence', body: 'Evidence supports it.' });

    setMemoryPermissionPolicy({ model: { consolidate: false } });
    await expect(consolidateObservation(observation.id, target.id, 'support')).rejects.toThrow(
      'Memory permission denied: consolidate',
    );

    const unchanged = await getMemory(target.id);
    expect(unchanged?.reinforcementCount).toBe(0);
    expect(unchanged?.body).toBe('Original claim.');
  });
});
