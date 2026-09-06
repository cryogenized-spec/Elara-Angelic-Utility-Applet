import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../persistence/conversation';
import { getMemory } from './store';
import { memory } from './capability';

describe('deliberate memory capability', () => {
  beforeEach(async () => { await db.memories.clear(); });

  it('stores requested prose with application-owned provenance and identity', async () => {
    const record = await memory.save(
      {
        title: 'Important preference',
        body: 'Keep durable memory explicit and useful.',
        kind: 'CONTEXTUAL',
        tags: ['preference'],
      },
      {
        conversationId: 'thread_123',
        messageId: 'message_456',
        folderId: 'folder_789',
      },
    );

    expect(record.id).toMatch(/^memory_/);
    expect(record.source).toMatchObject({
      source: 'elara',
      conversationId: 'thread_123',
      messageId: 'message_456',
    });
    expect(record.folderId).toBe('folder_789');
    expect(record.createdAt).toBeGreaterThan(0);
    expect(record.updatedAt).toBe(record.createdAt);
    expect(record.observedAt).toBe(record.createdAt);
    expect(record.confidence).toBeGreaterThanOrEqual(0);
    expect(record.importance).toBeGreaterThanOrEqual(0);
    expect(await getMemory(record.id)).toEqual(record);
  });

  it('does not expose caller control over durable identity or provenance', async () => {
    const record = await memory.save({ title: 'Boundary test', body: 'Application owns the durable fields.' });
    expect(record.id).not.toBe('caller_supplied_id');
    expect(record.source.source).toBe('elara');
  });
});
